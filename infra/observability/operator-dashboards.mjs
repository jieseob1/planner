// Provisioned alongside the existing overview; no user-created dashboards are overwritten.
const prometheus = {type: 'prometheus', uid: 'nowline-prometheus'};
const loki = {type: 'loki', uid: 'nowline-loki'};
const backend = 'job="nowline-backend",uri!~"/actuator/.*"';
function panel(title, expr, unit = 'short', description = '', legendFormat = '{{pod}}') {
  return {type: 'timeseries', title, description, datasource: prometheus,
    fieldConfig: {defaults: {unit, min: 0}, overrides: []},
    targets: [{refId: 'A', expr, legendFormat}],
    options: {legend: {displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max']}, tooltip: {mode: 'multi'}}};
}
const links = [
  ['nowline-operations', '운영 요약'], ['nowline-api', 'API · 저장 오류'],
  ['nowline-resources', '서버 · JVM · DB'], ['nowline-logs', '중앙 로그'],
].map(([uid, title]) => ({title, type: 'link', url: `/ops/grafana/d/${uid}`, keepTime: true}));
function dashboard(uid, title, panels) {
  return {uid, title, schemaVersion: 41, version: 1, editable: false, refresh: '30s',
    description: '실제 수집한 지표입니다. No data는 0이 아닙니다. 시간 범위를 넓혀 보고 수집 상태를 확인하세요. 개인정보·계획 본문은 수집하지 않습니다.',
    timezone: 'browser', time: {from: 'now-3h', to: 'now'}, tags: ['nowline', 'operations'], links,
    templating: {list: []}, panels: panels.map((item, index) => ({...item, id: index + 1,
      gridPos: {x: index % 2 * 12, y: Math.floor(index / 2) * 9, w: 12, h: 9}}))};
}
export const operatorDashboards = [
  dashboard('nowline-api', 'Goals to Today · API와 저장 오류', [
    panel('API 요청량 · 상태 코드별', `sum by (status) (rate(http_server_requests_seconds_count{${backend}}[5m]))`, 'reqps', 'Actuator 요청 제외. 사용자 수가 아닌 HTTP 요청 수입니다.', '{{status}}'),
    panel('API 평균 응답 시간', `sum(rate(http_server_requests_seconds_sum{${backend}}[5m])) / sum(rate(http_server_requests_seconds_count{${backend}}[5m]))`, 's', '요청이 없으면 값이 없거나 NaN입니다. 정상 0ms로 처리하지 않습니다.', '전체 API 평균'),
    panel('API P95 응답 시간 · 경로별', `histogram_quantile(0.95, sum by (le, uri) (rate(http_server_requests_seconds_bucket{${backend}}[5m])))`, 's', '히스토그램 기반 추정치. 요청이 적으면 해석에 주의하세요.', '{{uri}}'),
    panel('저장·인증 문제 · 최근 15분 400/401/403/409/412/429', `sum by (status, uri) (increase(http_server_requests_seconds_count{${backend},status=~"400|401|403|409|412|429"}[15m]))`, 'short', '400 원인을 단정하지 않습니다. 시간·경로와 브라우저 오류 코드를 함께 확인하세요. increase는 외삽값입니다.', '{{status}} {{uri}}'),
    panel('서버 오류 5xx · 최근 15분', `sum by (uri, status) (increase(http_server_requests_seconds_count{${backend},status=~"5.."}[15m]))`, 'short', '시계열이 없으면 오류 카운터가 아직 생성되지 않았을 수 있습니다.', '{{status}} {{uri}}'),
    panel('백엔드 지표 수집 상태 · Pod별', 'up{job="nowline-backend"}', 'short', '1=수집 성공, 0=실패. 외부 로그인 성공을 보장하는 지표는 아닙니다.'),
  ]),
  dashboard('nowline-resources', 'Goals to Today · 서버 JVM DB', [
    panel('컨테이너 CPU · 코어', 'sum by (namespace, pod, container) (rate(container_cpu_usage_seconds_total{job="kind-kubelet",namespace=~"nowline-(local|observability)",container!="",container!="POD"}[5m]))', 'cores', 'macOS 전체가 아닌 Linux kind 컨테이너입니다.', '{{pod}} / {{container}}'),
    panel('컨테이너 메모리 · Working set', 'sum by (namespace, pod, container) (container_memory_working_set_bytes{job="kind-kubelet",namespace=~"nowline-(local|observability)",container!="",container!="POD"})', 'bytes', 'MySQL, Keycloak, 애플리케이션 및 모니터링 컨테이너 포함.', '{{pod}} / {{container}}'),
    panel('JVM Heap 사용 비율', 'sum by (pod) (jvm_memory_used_bytes{job="nowline-backend",area="heap"}) / sum by (pod) (jvm_memory_max_bytes{job="nowline-backend",area="heap"} > 0)', 'percentunit'),
    panel('GC 일시정지 · 초/초', 'sum by (pod) (rate(jvm_gc_pause_seconds_sum{job="nowline-backend"}[5m]))', 's'),
    panel('DB 연결 풀 사용 비율', 'hikaricp_connections_active{job="nowline-backend"} / hikaricp_connections_max{job="nowline-backend"}', 'percentunit', '애플리케이션 Hikari 풀입니다. MySQL 전체 연결·slow query 지표는 아닙니다.'),
    panel('DB 연결 대기 수', 'hikaricp_connections_pending{job="nowline-backend"}', 'short', '대기가 지속되면 풀 포화 또는 DB 지연을 점검하세요.'),
    panel('DB 연결 획득 타임아웃 · 최근 15분', 'sum by (pod) (increase(hikaricp_connections_timeout_total{job="nowline-backend"}[15m]))'),
    panel('JVM 실행 시간 · 재시작 시 감소', 'process_uptime_seconds{job="nowline-backend"}', 's', '재시작 횟수 지표가 아닙니다.'),
    panel('컨테이너 메모리 한도 사용률 · 모니터링 포함', 'container_memory_working_set_bytes{job="kind-kubelet",namespace=~"nowline-(local|observability)",container!="",container!="POD"} / on(namespace,pod,container,instance) (container_spec_memory_limit_bytes{job="kind-kubelet",namespace=~"nowline-(local|observability)",container!="",container!="POD"} > 0)', 'percentunit', '80%부터 여유를 확인하고 90% 경보를 조사합니다. Grafana 자체도 포함됩니다. 제한이 없는 컨테이너는 비율을 만들지 않습니다.', '{{pod}} / {{container}}'),
    panel('컨테이너 실행 시간 · 재시작 시 감소', 'time() - container_start_time_seconds{job="kind-kubelet",namespace=~"nowline-(local|observability)",container!="",container!="POD"}', 's', 'OOM 원인이나 재시작 횟수 자체는 아닙니다. kubectl lastState·이벤트와 함께 확인하세요.', '{{pod}} / {{container}}'),
  ]),
  dashboard('nowline-logs', 'Goals to Today · 중앙 로그', [
    {...panel('로그 유입량 · 레벨별', 'sum by (level) (count_over_time({namespace="nowline-local"}[5m]))', 'short', '최근 5분 로그 수. 원본 로그는 민감 정보 필터를 통과한 것만 수집합니다.', '{{level}}'), datasource: loki},
    panel('수집기 상태 · Prometheus 타깃', 'up{job=~"loki|prometheus|kind-kubelet|kind-node"}', 'short', '로그가 없을 때 먼저 수집 상태를 확인하세요.', '{{job}}'),
    {type: 'logs', title: '경고 · 오류 로그', datasource: loki, description: '오류가 없으면 비어 있을 수 있습니다. 아래 전체 로그로 수집 여부를 확인하세요.', targets: [{refId: 'A', expr: '{namespace="nowline-local",level=~"error|warn"}'}], options: {showTime: true, showLabels: true, wrapLogMessage: true, sortOrder: 'Descending', enableLogDetails: true}},
    {type: 'logs', title: '전체 서버 로그 · 최신순', datasource: loki, description: '시간을 좁히고 Explore에서 pod·level을 선택해 조사하세요. 보관 기간 72시간.', targets: [{refId: 'A', expr: '{namespace="nowline-local"}'}], options: {showTime: true, showLabels: true, wrapLogMessage: true, sortOrder: 'Descending', enableLogDetails: true}},
  ]),
];
export const operatorDashboardFiles = Object.fromEntries(operatorDashboards.map(item => [`${item.uid}.json`, JSON.stringify(item)]));
