# Operations runbook

## 운영 목표

| 항목 | 목표 |
| --- | --- |
| API 가용성 | 월 99.9% |
| API 지연 | p95 2초 이하 |
| 캘린더 동기화 | 정상 공급자 상태에서 99%가 5분 내 수렴 |
| 알림 | 예약 시각 이후 5분 내 95% 공급자 인계 |
| 데이터 RPO/RTO | 관리형 MySQL PITR RPO 5분, 서비스 RTO 60분 |

로컬 `npm run verify:recovery`는 모든 Flyway migration을 적용한 MySQL 8.4를 `mysqldump --single-transaction --routines --triggers`로 백업하고 새 DB에 복구한 뒤 식별 지문을 비교합니다. 이는 복구 도구와 schema 호환성 증거이며, 관리형 DB의 실제 PITR 증거를 대신하지 않습니다.

## 배포와 롤백

릴리스 workflow는 migration Job 성공 후 digest로 고정된 Deployment를 rollout합니다. 실패하면 새 쓰기를 중단할 필요가 있는지 먼저 판단하고 다음을 수행합니다.

1. `kubectl -n nowline-production rollout status deployment/nowline-backend`
2. 애플리케이션만 실패하고 schema가 하위 호환이면 직전 digest로 `kubectl set image` 후 rollout
3. destructive migration은 금지하고 expand → deploy → contract 순서를 사용
4. 하위 호환이 아닌 schema 문제는 애플리케이션 롤백만 하지 말고, 트래픽을 maintenance로 전환한 뒤 PITR clone에서 검증
5. incident 시간, digest, Flyway version, 판단 근거를 기록

## Mac mini 전원·재부팅 장애

공개 OIDC가 Cloudflare 530을 반환하면 DNS부터 바꾸지 말고 `SSH → Colima → kind node → workload → 127.0.0.1:4189 → 전용 tunnel` 순서로 확인합니다. `pmset -g custom`의 `sleep 0`, `autorestart 1`은 절전 방지와 AC 복구 뒤 재기동 설정일 뿐, GUI 로그인 전 LaunchAgent 실행을 보장하지 않습니다. 무인 복구는 [Local beta runbook](./LOCAL_BETA_RUNBOOK.md)의 시스템 LaunchDaemon을 우선 사용하고, sudo 인증을 사용할 수 없는 경우 system cron `@reboot` fallback을 사용합니다.

2026-09-02 장애의 확인 범위는 다음과 같습니다.

- `pmset`에는 09:31:45까지 awake/assertion 이벤트가 있었고 sleep 진입 기록은 없었습니다.
- 다음 기록은 10:16:49의 새 `powerd` 시작이며 `kern.boottime`은 10:16:41이었습니다.
- 정상 shutdown 이력과 해당 시각 kernel panic report가 없었습니다.
- 따라서 09:31:45~10:16:41 사이의 비정상 전원 단절 또는 전원 버튼 강제 종료로 한정할 수 있습니다. macOS 로그만으로 AC·멀티탭·플러그 단절과 물리 버튼 강제 종료를 구분할 수는 없습니다.
- 기존 SSH tunnel은 system daemon이라 복구됐지만, Colima·포트포워드·Goals to Today tunnel은 GUI LaunchAgent라 로그인 전 복구되지 않았습니다. 이것이 530이 계속된 직접 원인이었습니다.

같은 장애를 구분하려면 UPS/스마트 플러그의 전원 이벤트와 Cloudflare tunnel down 알림을 별도로 보존합니다. 복구 후 `npm run verify:goalstotoday:mac-mini`와 `npm run verify:goalstotoday:public`을 모두 통과시킵니다.

## Backup and restore

매일 다음 항목을 자동 확인합니다.

- 연속 WAL 보관/PITR가 켜져 있고 최근 restore point가 5분 이내
- 일일 full snapshot이 다른 장애 도메인에 암호화 보관
- 백업 서비스 계정은 운영 애플리케이션 계정과 분리
- 분기마다 격리된 새 인스턴스에 복구하고 사용자·planner·audit·연동 테이블 수와 표본 지문 비교

복구는 운영 DB를 덮지 않습니다. 요청 시각 직전으로 새 인스턴스를 만들고 read-only 검증, 누락 범위 산정, 애플리케이션 중지, 연결 전환, 쓰기 smoke test 순서로 진행합니다.

## API or worker incident

1. `NowlineBackendUnavailable`, 5xx ratio, p95, pod restart, Hikari active/pending을 같은 시간축으로 확인
2. trace ID로 요청 로그와 DB 구간을 연결하되 JWT·OAuth token·planner 본문은 로그에 남기지 않음
3. DB connection saturation이면 replica 수를 먼저 늘리지 말고 전체 DB connection budget을 확인
4. 새 릴리스 직후면 직전 digest로 rollback
5. 공급자 장애이면 사용자 데이터 쓰기 경로와 외부 연동 경로를 분리하고 재시도 폭주 여부 확인

## Calendar or notification incident

- `nowline_integration_jobs_total{result="error|retry"}`와 job duration을 확인
- 401/403은 자동 반복하지 않고 연결 상태를 `REAUTHORIZE`로 전환
- 410 sync token은 전체 재동기화로 수렴하는지 확인
- 429/5xx는 DB job의 next attempt와 exponential backoff를 확인
- webhook message number 중복과 channel token hash 검증 실패는 버리되 비율 급증 시 공격/설정 오류 조사
- push permanent failure는 device를 비활성화하고, retryable failure만 제한적으로 재시도

## Secret and encryption-key rotation

OIDC/Google/VAPID/push adapter secret은 새 값을 Secret Manager에 등록하고 canary 연결을 확인한 뒤 rollout합니다. AES-GCM 키는 현재 단일 키 형식이므로 무중단 임의 교체를 하면 기존 token을 복호화할 수 없습니다. 다음 통제 절차를 사용합니다.

1. 영향 사용자에게 외부 연동 재연결 시간을 공지
2. Google token revoke와 알림 device 비활성화를 실행
3. 연동 credential row가 제거된 것을 확인
4. 새 32바이트 키를 적용하고 rollout
5. 사용자가 Google Calendar와 device push를 다시 연결

무중단 키링·온라인 재암호화가 필요한 조직 규모에서는 KMS envelope encryption으로 교체한 뒤 회전합니다. 현재 방식의 이 제한은 공개 전 운영 승인 항목입니다.

## Privacy incident

의심 시 integration worker와 export를 우선 차단하고, 영향 user/시간/필드/외부 전송 여부를 보존합니다. 로그에 민감 본문을 새로 복사하지 않습니다. 법적 통지 시한과 연락 체계는 실제 운영 주체가 별도 확정해야 합니다.

## Retention

하루 한 번 MySQL `maintenance_lock` 행을 `FOR UPDATE SKIP LOCKED`로 획득한 replica 하나가 rate-limit 2시간, 만료 OAuth state 1일, idempotency 30일, 성공 integration job 30일, dead job 90일, notification delivery 365일 기준으로 운영 row를 정리합니다. Planner와 plan audit은 계정이 유지되는 동안 보관하고 계정 삭제 시 cascade 삭제합니다. 실제 법적 보관기간이 이 기준과 다르면 공개 전에 정책·문서·SQL을 함께 변경합니다.
