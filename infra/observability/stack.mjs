import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const namespace = 'nowline-observability';
export const context = 'kind-nowline-local';
export const images = Object.freeze({
  prometheus: 'prom/prometheus:v3.14.0@sha256:5ce7540c3c00ef4ab0c9d2c995c6a5b9c421f44b4a115d97a2c7af3b1c21cbb0',
  grafana: 'grafana/grafana:13.2.1@sha256:f772d434e8fab0049deb2b1b30abd43342bcfca1537614aa8d36080232cf4283',
  loki: 'grafana/loki:3.7.7@sha256:d70e4659623f3e109af669cae76fe2a5dd5be54e2298fe8aed380d982fbc2500',
  'fluent-bit': 'cr.fluentbit.io/fluent/fluent-bit:5.1.2@sha256:d792375ca8e53be72fc25716c28f291f32c6fc6f4f31d12d0d14bc78cefe9226',
});
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const labels = (name) => ({'app.kubernetes.io/part-of': 'nowline-observability', 'app.kubernetes.io/name': name});
const metadata = (name, extra = {}) => ({ name, namespace, labels: labels(name), ...extra });
const configMap = (name, data) => ({ apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(name), data });
const secretVolume = (name) => ({name: 'credentials', secret: {secretName: name, defaultMode: 0o440}});
const configVolume = (name) => ({name: 'config', configMap: {name}});
const mount = (name, mountPath, readOnly = false) => ({name, mountPath, readOnly});
const resources = (cpu, memory, maxCpu, maxMemory) => ({ requests: {cpu, memory}, limits: {cpu: maxCpu, memory: maxMemory} });
const containerSecurity = {allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: {drop: ['ALL']}};
const dataVolume = (name) => ({name: 'data', persistentVolumeClaim: {claimName: name}});
const probe = (port, path) => ({ httpGet: {port, path}, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 6 });

function workload(component, {uid, port, args, mounts, volumes, resource, probePath, env = [], serviceAccountName, daemon = false}) {
  const name = `nowline-${component}`;
  const files = component === 'prometheus' ? ['prometheus.yml', 'rules.yml'] : component === 'grafana' ? ['grafana.ini', 'dashboard.json', 'datasources.yml', 'dashboards.yml'] : component === 'loki' ? ['loki.yml'] : ['fluent-bit.conf', 'parsers.conf', 'sanitize.lua'];
  const checksum = createHash('sha256').update(files.map(read).join('\n')).digest('hex');
  const container = {name: component, image: images[component], imagePullPolicy: 'IfNotPresent', ...(args ? {args} : {}),
    resources: resource, securityContext: containerSecurity,
    volumeMounts: [...mounts, mount('tmp', '/tmp')], ...(env.length ? {env} : {}),
    ...(port ? {ports: [{name: 'http', containerPort: port}], startupProbe: {...probe(port, probePath), failureThreshold: 60}, readinessProbe: probe(port, probePath), livenessProbe: {...probe(port, probePath), failureThreshold: 12}} : {})};
  return {apiVersion: 'apps/v1', kind: daemon ? 'DaemonSet' : 'Deployment', metadata: metadata(name), spec: {
    ...(daemon ? {updateStrategy: {type: 'RollingUpdate', rollingUpdate: {maxUnavailable: 1}}} : {replicas: 1, strategy: {type: 'Recreate'}}),
    revisionHistoryLimit: 2, selector: {matchLabels: labels(name)}, template: {
      metadata: {labels: labels(name), annotations: {'nowline.dev/config-sha256': checksum}},
      spec: {nodeSelector: {'kubernetes.io/arch': 'arm64', 'kubernetes.io/os': 'linux'},
        automountServiceAccountToken: Boolean(serviceAccountName), ...(serviceAccountName ? {serviceAccountName} : {}),
        securityContext: {runAsUser: uid, runAsGroup: uid, runAsNonRoot: uid !== 0, fsGroup: uid, seccompProfile: {type: 'RuntimeDefault'}},
        terminationGracePeriodSeconds: 30, containers: [container],
        ...(daemon ? {tolerations: [{key: 'node-role.kubernetes.io/control-plane', operator: 'Exists', effect: 'NoSchedule'}]} : {}),
        volumes: [...volumes, {name: 'tmp', emptyDir: {sizeLimit: '32Mi'}}]}}}};
}

export function buildStack() {
  const items = [{apiVersion: 'v1', kind: 'Namespace', metadata: {name: namespace, labels: {'app.kubernetes.io/part-of': namespace}}},
    ...['prometheus', 'grafana', 'loki'].map((component) => ({apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(`nowline-${component}`),
      spec: {accessModes: ['ReadWriteOnce'], storageClassName: 'standard', resources: {requests: {storage: component === 'grafana' ? '1Gi' : '4Gi'}}}})),
    {apiVersion: 'v1', kind: 'ResourceQuota', metadata: metadata('nowline-observability'), spec: {hard: {'requests.cpu': '1', 'requests.memory': '1Gi', 'limits.cpu': '4', 'limits.memory': '3Gi', 'requests.storage': '9Gi', pods: '8', persistentvolumeclaims: '3'}}},
    {apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata('nowline-prometheus'), automountServiceAccountToken: true},
    {apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: {...metadata('nowline-prometheus-discovery'), namespace: 'nowline-local'}, rules: [{apiGroups: [''], resources: ['pods'], verbs: ['get', 'list', 'watch']}]},
    {apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: {...metadata('nowline-prometheus-discovery'), namespace: 'nowline-local'}, roleRef: {apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'nowline-prometheus-discovery'}, subjects: [{kind: 'ServiceAccount', name: 'nowline-prometheus', namespace}]},
    {apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', metadata: {name: 'nowline-observability-kubelet', labels: labels('nowline-prometheus')}, rules: [{apiGroups: [''], resources: ['nodes'], verbs: ['get', 'list', 'watch']}, {apiGroups: [''], resources: ['nodes/metrics'], verbs: ['get']}]},
    {apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding', metadata: {name: 'nowline-observability-kubelet', labels: labels('nowline-prometheus')}, roleRef: {apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'nowline-observability-kubelet'}, subjects: [{kind: 'ServiceAccount', name: 'nowline-prometheus', namespace}]},
    configMap('nowline-prometheus', {'prometheus.yml': read('prometheus.yml'), 'rules.yml': read('rules.yml')}),
    configMap('nowline-loki', {'loki.yml': read('loki.yml')}),
    configMap('nowline-grafana', {'grafana.ini': read('grafana.ini')}),
    configMap('nowline-grafana-provisioning', {'datasources.yml': read('datasources.yml'), 'dashboards.yml': read('dashboards.yml')}),
    configMap('nowline-grafana-dashboard', {'dashboard.json': read('dashboard.json')}),
    configMap('nowline-fluent-bit', {'fluent-bit.conf': read('fluent-bit.conf'), 'parsers.conf': read('parsers.conf'), 'sanitize.lua': read('sanitize.lua')})];
  items.push(workload('prometheus', {uid: 65534, port: 9090, probePath: '/-/ready', serviceAccountName: 'nowline-prometheus',
    args: ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--storage.tsdb.retention.time=5d', '--storage.tsdb.retention.size=2GB', '--query.max-concurrency=4', '--query.timeout=20s', '--web.enable-admin-api=false'],
    resource: resources('150m', '256Mi', '1', '768Mi'),
    mounts: [mount('config', '/etc/prometheus', true), mount('data', '/prometheus'), mount('credentials', '/etc/metrics-secret', true), mount('kubelet-ca', '/etc/kubelet-ca', true)],
    volumes: [configVolume('nowline-prometheus'), dataVolume('nowline-prometheus'), secretVolume('nowline-prometheus-oauth'), {name: 'kubelet-ca', configMap: {name: 'nowline-kubelet-ca'}}]}));
  items.push(workload('loki', {uid: 10001, port: 3100, probePath: '/ready', args: ['-config.file=/etc/loki/loki.yml', '-target=all'],
    resource: resources('100m', '256Mi', '1', '768Mi'),
    mounts: [mount('config', '/etc/loki', true), mount('data', '/loki')], volumes: [configVolume('nowline-loki'), dataVolume('nowline-loki')]}));
  items.push(workload('grafana', {uid: 472, port: 3000, probePath: '/ops/grafana/api/health',
    resource: resources('100m', '128Mi', '500m', '384Mi'),
    env: [{name: 'GF_PATHS_CONFIG', value: '/etc/nowline-grafana/grafana.ini'}, {name: 'GF_SECURITY_SECRET_KEY', valueFrom: {secretKeyRef: {name: 'nowline-grafana-oauth', key: 'session-secret'}}}],
    mounts: [mount('config', '/etc/nowline-grafana', true), mount('data', '/var/lib/grafana'), mount('credentials', '/etc/grafana-secret', true),
      {...mount('provisioning', '/etc/grafana/provisioning/datasources/nowline.yml', true), subPath: 'datasources.yml'}, {...mount('provisioning', '/etc/grafana/provisioning/dashboards/nowline.yml', true), subPath: 'dashboards.yml'}, mount('dashboard', '/var/lib/grafana/dashboards', true)],
    volumes: [configVolume('nowline-grafana'), dataVolume('nowline-grafana'), secretVolume('nowline-grafana-oauth'), {name: 'provisioning', configMap: {name: 'nowline-grafana-provisioning'}}, {name: 'dashboard', configMap: {name: 'nowline-grafana-dashboard'}}]}));
  items.push(workload('fluent-bit', {uid: 0, daemon: true, args: ['-c', '/fluent-bit/etc/nowline/fluent-bit.conf'],
    resource: resources('25m', '48Mi', '250m', '128Mi'),
    mounts: [mount('config', '/fluent-bit/etc/nowline', true), mount('logs', '/var/log/pods', true), mount('state', '/state')],
    volumes: [configVolume('nowline-fluent-bit'), {name: 'logs', hostPath: {path: '/var/log/pods', type: 'Directory'}}, {name: 'state', emptyDir: {sizeLimit: '64Mi'}}]}));
  for (const [component, port] of [['prometheus', 9090], ['grafana', 3000], ['loki', 3100]]) items.push({apiVersion: 'v1', kind: 'Service', metadata: metadata(`nowline-${component}`), spec: {type: 'ClusterIP', selector: labels(`nowline-${component}`), ports: [{name: 'http', port, targetPort: 'http'}]}});
  const nsSelector = (ns) => ({matchLabels: {'kubernetes.io/metadata.name': ns}});
  const peer = (name) => ({podSelector: {matchLabels: labels(`nowline-${name}`)}});
  items.push({apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata('deny-ingress'), spec: {podSelector: {}, policyTypes: ['Ingress'], ingress: []}});
  for (const [component, port, sources] of [['prometheus', 9090, [peer('grafana')]], ['loki', 3100, [peer('grafana'), peer('fluent-bit'), peer('prometheus')]], ['grafana', 3000, [{namespaceSelector: nsSelector('nowline-local'), podSelector: {matchLabels: {'app.kubernetes.io/component': 'frontend'}}}]]]) {
    items.push({apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(`allow-${component}`), spec: {podSelector: {matchLabels: labels(`nowline-${component}`)}, policyTypes: ['Ingress'], ingress: [{from: sources, ports: [{port, protocol: 'TCP'}]}]}});
  }
  return items;
}

export function renderStack() { return JSON.stringify({apiVersion: 'v1', kind: 'List', items: buildStack()}, null, 2); }
