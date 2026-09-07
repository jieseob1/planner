# Nowline observability

The deployment is a small, single-node ARM64 stack for `kind-nowline-local` on the Mac mini's 4 CPU / 8 GiB Linux VM. It monitors application namespace `nowline-local`, stores observability data in `nowline-observability`, and serves Grafana at [goalstotoday.com/ops/grafana/](https://goalstotoday.com/ops/grafana/). Repository validation alone does not establish that the server stack is installed or ingesting data.

## Components and budget

Images are version-and-manifest-digest pinned in `infra/observability/stack.mjs`. The installer checks for exactly one ARM64 node and `standard` storage class; it refuses a different context or an expanded cluster until the budget is revisited.

| Component | Version | CPU request / limit | Memory request / limit | Data |
| --- | --- | --- | --- | --- |
| Prometheus | 3.14.0 | 150m / 1 | 256 / 768 MiB | 4 GiB PVC; 5 days or 2 GB TSDB blocks, whichever first |
| Grafana | 13.2.1 | 100m / 500m | 128 / 384 MiB | 1 GiB PVC |
| Loki single binary | 3.7.7 | 100m / 1 | 256 / 768 MiB | 4 GiB PVC; 72 hours, compactor deletion enabled |
| Fluent Bit DaemonSet | 5.1.2 | 25m / 250m | 48 / 128 MiB | 64 MiB ephemeral state, 32 MiB retry spool |
| Total, one node | | 375m / 2750m | 688 / 2048 MiB | 9 GiB PVC requests |

Loki accepts at most 0.01 MiB/s sustained, roughly 2.5 GiB across 72 hours before compression, with a 2 MiB burst. Queries have concurrency, time range, line length and row limits. A sustained burst can lose logs; inspect ingestion/retry errors before assuming complete history. Prometheus has a 30-second scrape interval, sample limits and a bounded metric allowlist. OOM restarts mean the limit needs reassessment, not that the VM has spare capacity.

Kind's local-path PVC size is a capacity request, **not a physical filesystem quota**. Retention is asynchronous; the Loki compactor has a two-hour deletion delay, and Prometheus WAL/head data also consume space outside its block-size limit. Keep several GiB free in the VM and measure actual filesystem use during runtime QA. A PVC statistic may be unavailable from the local-path provider; an empty dashboard is not a zero measurement. PVC data survives Pod replacement, but deleting the kind cluster loses the data. No high availability, off-host backup, external alert delivery or macOS hardware exporter is included. Alerts are visible in Grafana/Prometheus only.

## Authentication and permissions

Grafana accepts only Keycloak OIDC client `nowline-grafana`, with PKCE and strict role mapping: `nowline-admin` in signed realm roles maps to Grafana organization Admin; every other identity is denied. Anonymous and basic login are disabled, and no initial local administrator is created. This does not grant Grafana server-administrator privileges. Session activity is bounded to 15 minutes idle / 1 hour maximum; refresh tokens revalidate the identity. Role revocation can take effect on refresh/session renewal rather than immediately on an already established session.

Prometheus obtains short-lived OAuth client-credentials tokens for `nowline-prometheus`, explicitly requests `metrics.read`, and includes `nowline-api` through its dedicated audience mapper. Spring must continue requiring `SCOPE_metrics.read` on `/actuator/prometheus`; do not make the endpoint anonymous. No long-lived bearer token is stored in a ConfigMap. Client secrets are projected from Kubernetes Secrets, and the Grafana session key is a separate random secret. Kubernetes Secret values are base64, not encrypted by this repository.

Prometheus has namespace-scoped read/list/watch of application Pods, read/list/watch of nodes, and GET `nodes/metrics`. Kubelet scrapes use HTTPS with the public serving certificate obtained from the local kind node, plus the cluster CA. **There is no `nodes/proxy` permission**: even GET on that resource can execute commands in containers. TLS verification stays enabled. The installer refreshes the trust ConfigMap and deployment checksum; rerun it after a kubelet certificate rotation. It only reads `/var/lib/kubelet/pki/kubelet.crt`, never the private key.

When the certificate has an IP SAN matching the discovered InternalIP, ordinary IP verification is used. Kind can instead issue a certificate with only `DNS:nowline-local-control-plane`; the installer accepts this only when `checkHost(nodeName, {subject: 'never', wildcards: false})` verifies the exact node SAN. It then injects `tls_config.server_name` into both kubelet scrape jobs while keeping the discovered IP/port for the connection. CN-only, wildcard and unrelated SANs fail closed. The committed Prometheus template contains no fixed node name. The rendered config, rules and complete trust bundle are included in a deterministic deployment checksum.

Fluent Bit has no API credentials or RBAC. It reads `/var/log/pods` through a read-only host mount and only tails `nowline-local_nowline-{backend,frontend,keycloak,mysql}-*` paths. Root UID is needed for kubelet-created log-file permissions; all Linux capabilities and privilege escalation are disabled, and its root filesystem is read-only. It has no Docker socket, host PID namespace, writable host mount or pod exec permission.

All Services are ClusterIP; only Grafana has an nginx route. Namespace ingress policies allow Grafana from the application frontend, Prometheus from Grafana, and Loki from Grafana/collector/Prometheus. **Kind's default CNI may not enforce NetworkPolicy**; the policy objects alone are not proof of packet filtering. These unauthenticated internal Prometheus/Loki services trust cluster workloads. Do not expose 9090/3100 with a host port, NodePort, LoadBalancer, tunnel or public ingress. Cluster administrators can use Kubernetes service proxy access for diagnostics.

## Log handling

The same `sanitize.lua` tested by the container check runs before Loki output. It drops complete lines containing authorization/cookie/password/token/secret fields, redacts URL query strings and free JWTs, removes arbitrary extra structured fields, and bounds messages to 3,000 characters. Useful ordinary messages and Java exception/stack lines are preserved. Loki labels are fixed cluster/namespace and bounded component/severity values. No user identifiers, tokens or full URL query strings become labels.

Source applications must still avoid logging request bodies and credentials: a text filter cannot identify an arbitrary unlabeled secret or reliably reconstruct multiline secret values. CRI partial fragments are dropped; this is intentionally lossy for very long lines. The collector retry spool is ephemeral local state and can contain the already-existing raw source logs before processing; it is never a public mount. Collector Pod recreation loses positions and pending spool; `Read_from_Head false` prevents bulk backfill, so brief restart gaps are possible. This is operational debugging, not a complete audit log.

Curated queries in Grafana Explore:

```logql
{namespace="nowline-local"} | json | line_format "{{.message}}"
{namespace="nowline-local",component="backend",level=~"error|warn"} | json
{namespace="nowline-local",component="frontend"} | json | message =~ ".* 5[0-9][0-9] .*"
{namespace="nowline-local",component="keycloak",level="error"} | json
```

The provisioned `Nowline · Operations` dashboard includes actual container CPU cores, working-set memory, JVM heap/CPU/GC, DB pool pressure, kubelet counts, scrape health, observability overhead and sanitized warning/error logs. Linux kind-node/container readings do **not** describe macOS hardware. Initial CPU rates need at least two scrapes; sparse counters and unexported PVC statistics remain empty rather than displaying invented zeroes.

## Install and release integration

Run from the server repository after normal application/Keycloak rollout. The commands require the operator's existing `kubectl` context, Docker access and Keycloak bootstrap admin environment inside its existing Pod. They never request a new admin password or print client credentials. The identity helper creates/updates only its clients, scope/mappers and observability Secrets; existing client secrets are read and retained, and user role assignments are left to the application's admin provisioning. It creates `nowline-admin` if absent but never grants it to users.

```sh
rtk node scripts/verify-observability.mjs
rtk node scripts/install-observability.mjs --render
rtk node scripts/provision-observability-identity.mjs --apply --context kind-nowline-local
rtk node scripts/install-observability.mjs --apply --context kind-nowline-local
rtk node scripts/verify-observability.mjs --runtime --context kind-nowline-local
```

No arguments means a read-only explanation; `--render` emits a Kubernetes List without any secrets. Namespace, ConfigMaps and workloads are applied with server-side apply and stable field managers; no `--force-conflicts`, prune or delete is used. The installer performs server-side dry-run first and waits for every rollout. PVCs use Recreate Deployments to avoid one-node RWO volume conflicts. Config-file hashes trigger workload rollouts on changes. On secret rotation, explicitly restart the matching workload because mounted/loaded credentials can be cached. An unchanged install leaves deployment templates and existing credentials stable.

Wire CI in this order: application backend/Keycloak ready → provision observability identity → install stack → frontend/nginx route ready → runtime verification. Client provisioning can be omitted from routine deployments once a reviewed identity change is not needed. A failed monitoring rollout must fail its check and be reported; do not mark data ingestion successful based on Ready status alone. The root deployment orchestrator owns release rollback policy. To pause safely, scale the three observability Deployments to zero and remove or suspend the collector separately; preserve PVCs. Do not delete the namespace as a routine rollback.

The root nginx configuration must:

- Proxy `/ops/grafana/` with its prefix preserved to `nowline-grafana.nowline-observability.svc.cluster.local:3000`, and redirect `/ops/grafana` to its trailing slash.
- Forward canonical `Host` / `X-Forwarded-Host: goalstotoday.com`, `X-Forwarded-Proto: https`, plus WebSocket Upgrade/Connection headers. Use runtime DNS resolution so an application frontend can start before the observability Service exists.
- Disable access logs for Grafana OAuth/callback traffic and Keycloak proxy paths. For other access logs, log `$uri` rather than `$request` or `$request_uri`; authorization-code query strings must not reach source logs.

## Verification and evidence boundaries

```sh
# Offline configuration/ownership/security checks and unsafe positive controls.
rtk node scripts/verify-observability.mjs
# Exact ARM64 images: promtool, Loki verify-config, Fluent Bit dry-run,
# actual Lua sanitizer records, Grafana startup + anonymous denial.
# Pull the pinned images first if absent from the local Docker cache.
rtk node scripts/verify-observability.mjs --containers
# Read-only running-cluster data checks after installing and creating traffic.
rtk node scripts/verify-observability.mjs --runtime --context kind-nowline-local
```

Runtime mode checks all controllers Ready and PVCs Bound; every Ready backend Pod has an authenticated target `up=1`; actual JVM/container CPU/memory series exist; Loki has real recent application rows with the expected sanitized schema; and anonymous Grafana search is denied. It prints counts/outcomes without log bodies or token values. On a quiet server, generate a normal page/API request before checking Loki. Actual operator OIDC login and a separate ordinary-user denial must additionally be tested in the browser. Likewise confirm anonymous Spring metrics is denied (401), a normal user's token lacks metrics permission (403), and the service client's token succeeds. Never infer these authorization outcomes from the static configuration check.

For installation/startup, runtime mode retries the same complete checks every two seconds for at most 150 seconds. Each Kubernetes/public HTTP operation has a five-second cap within that shared deadline. Empty first-scrape or first-ingestion results stay failures until real data arrives; timeout exits nonzero with the last concise failure. CI should give this command at least 180 seconds including process startup. Static mode performs no runtime wait.

The isolated Grafana container test uses the same 384 MiB / 0.5 CPU limits as deployment. First-start migrations have a bounded 75-second readiness budget because other integration suites can share the Docker VM. A terminated/OOM container fails immediately; a failure includes its state and up to 30 sanitized log lines before that exact temporary container is removed. Increasing the readiness budget does not bypass the healthy-database or anonymous-401 checks. Identity provisioning re-reads full client representations (without `--fields`) and verifies existing client secrets remain equal without printing them.

## Primary sources checked 2026-09-07

- [Prometheus download/version](https://prometheus.io/download/) and [OAuth2 / discovery configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/).
- [Grafana 13.2.1 release](https://github.com/grafana/grafana/releases/tag/v13.2.1) and [Generic OAuth strict role mapping / PKCE](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/).
- [Loki 3.7.7 release](https://github.com/grafana/loki/releases/tag/v3.7.7) and [compactor retention](https://grafana.com/docs/loki/latest/operations/storage/retention/).
- [Fluent Bit 5.1.2 release](https://fluentbit.io/announcements/) and [native Loki output](https://docs.fluentbit.io/manual/4.1/data-pipeline/outputs/loki).
- [Kubernetes kubelet authorization](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/) and [API server bypass risks](https://kubernetes.io/docs/concepts/security/api-server-bypass-risks/).
- [Keycloak Admin CLI](https://www.keycloak.org/docs/latest/server_admin/index.html#admin-cli) and [Admin REST resource contracts](https://www.keycloak.org/docs-api/latest/rest-api/index.html).
