# Nowline local runtime

This directory contains the local Kubernetes package. Docker Compose lives at
the repository root so both flows build the same `nowline-frontend:local` and
`nowline-backend:local` images.

## Docker Compose

```bash
make compose-up
make compose-verify
make compose-down
```

The frontend is available at `http://localhost:8088` and the backend at
`http://localhost:8080` by default. Set `NOWLINE_FRONTEND_PORT` or
`NOWLINE_BACKEND_PORT` to avoid a local port collision. `compose-down` keeps the
named MySQL volume; it does not erase planner data.

The password in `compose.yaml` is intentionally a local-only default. Override
`NOWLINE_MYSQL_PASSWORD` and `NOWLINE_MYSQL_ROOT_PASSWORD` when the local machine is shared.

## Existing local Kubernetes cluster

The helper uses the current `kubectl` context and never creates or switches a
cluster:

```bash
./scripts/k8s-local.sh up
./scripts/k8s-local.sh verify
./scripts/k8s-local.sh down
```

`up` runs the host-side Vite build and Maven package, builds both runtime-only container images,
loads them when the context is kind, applies the overlay, and waits for all
rollouts. Because the local images use stable `:local` tags, `up` also restarts
the frontend and backend Deployments so every newly loaded image is consumed.
`build` is also available separately when only the images need to be refreshed.

Set `NOWLINE_KUBE_CONTEXT` to pin an explicit context and
`NOWLINE_K8S_WAIT_SECONDS` (10 through 900) to change the bounded rollout timeout. On a `kind-*`
context, `build` and `up` load both local images into that exact kind cluster. Other
cluster runtimes must make the two image names available themselves.

`down` deletes only the named Nowline workloads, services, HPA, PDB, and local
Secret. It deliberately keeps the `nowline-local` namespace and the StatefulSet
PVC (`data-nowline-mysql-0`) so planner data survives. Delete that PVC only
when permanent local data loss is intended.

The checked-in Secret is a local-development credential, not a production
secret-management design.

## Production overlay

`overlays/production` deliberately removes the local MySQL StatefulSet. It expects an externally managed HA MySQL 8.4 service and a pre-provisioned `nowline-production-secrets` Secret. It adds TLS Ingress, exact-origin configuration, dedicated tokenless ServiceAccounts, default-deny NetworkPolicy, frontend/backend PDBs, ServiceMonitor and PrometheusRule resources.

```bash
kubectl kustomize infra/k8s/overlays/production
npm run verify:k8s
```

Do not apply the example until every `app.nowline.example` value is replaced. The release workflow applies `migration-job.yaml` first, waits for Flyway completion, then applies application resources and pins both Deployments to signed image digests. Application Pods run with Flyway disabled so replicas do not race schema rollout.

The cluster must already have Ingress NGINX, metrics-server, Prometheus Operator CRDs, an OTLP collector, trusted TLS certificate automation, external Secret delivery, and network-policy enforcement. See [production setup](../docs/PRODUCTION_SETUP.md) and [operations runbook](../docs/OPERATIONS_RUNBOOK.md).

## HPA dependency

The `autoscaling/v2` HPA requires [Kubernetes Metrics Server](https://github.com/kubernetes-sigs/metrics-server)
to receive CPU and memory utilization. The stack still starts without Metrics
Server and retains its two configured backend replicas, but the HPA reports
unknown metrics and cannot scale until the `metrics.k8s.io` API is available.
