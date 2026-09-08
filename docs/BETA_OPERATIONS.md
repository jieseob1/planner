# 베타 운영 체크

코드 배포 완료와 공개 운영 준비 완료는 다릅니다. 이 문서와 `scripts/beta-operations.mjs`는 미설정/미검증을 성공으로 숨기지 않습니다. CLI는 읽기 전용이며 기본 실행에는 네트워크·클러스터 호출도 없습니다. 사용자 계획/로그 본문, 이메일, 비밀값, S3 경로는 출력하지 않습니다.

## 바로 접속하는 곳

- [서비스](https://goalstotoday.com/today)
- [백오피스](https://goalstotoday.com/admin): 검증된 `nowline-admin` 계정만 접근합니다. 계정/캘린더/작업 오류/감사 기록 확인용입니다.
- [Grafana](https://goalstotoday.com/ops/grafana/): 같은 관리자 로그인 → Dashboards → Nowline. 운영 요약, API·저장 오류, 서버·JVM·DB, 중앙 로그 4개 보드는 저장소에서 영속적으로 등록됩니다.

일반 사용자에게 관리자 권한을 부여해서 접근 오류를 우회하지 마세요.

## 코드로 준비한 것과 아직 필요한 것

| 항목 | 코드/도구 | 운영에서 남은 증거 |
| --- | --- | --- |
| Grafana 안정성 | 384 → 768 MiB limit, 1 CPU, 자원 합계 검증, 실제 설정 비교 | 새 Pod의 자원 일치·실제 보드 렌더링·재발 관찰 |
| 메모리·API·로그 | 4개 저장 대시보드, Grafana 포함 메모리 경보, 누락 수집/디스크 지표 경보 | Grafana와 외부 수신처까지 장애·복구 알림 도착 |
| 일일·배포 전 백업 | 기존 배포 스크립트와 새 host LaunchAgent가 MySQL `nowline`+`keycloak` 압축 덤프 생성 | LaunchAgent 설치/첫 실행, 별도 호스트 보관, 최신본 복원 시험 |
| 외부 백업 무결성 | 최신 gzip/원격 크기·암호화·전체 SHA-256 비교 CLI | 사용자 지정 S3 버킷·권한·최신 업로드 객체 |
| 외부 가용성 | 공개 health/version/OIDC/Grafana 비인증 조회 CLI | Mac mini 밖의 실행 지점, 주기 실행, 실제 수신자 확인 |
| 복구 훈련 | 기존 fixture 검사 + `scripts/verify-backup-restore.mjs`로 선택한 최신 백업을 격리 MySQL에 복원 | **실제 최신 외부 백업** 검증 실행 결과와 동일 스냅샷 원본 건수 비교 |

단일 Mac mini가 정전·절전·네트워크 장애로 멈추면 같은 서버의 Grafana도 멈춥니다. 따라서 서버 내부 알람만으로 “운영 중 감지 가능”이라고 판단하지 않습니다. Prometheus 공식 지침도 내부 지표에 외부 black-box 감시를 보완하도록 권장합니다. [Prometheus 알림 운영 원칙](https://prometheus.io/docs/practices/alerting/)

## 점검 명령

저장소 루트에서 실행합니다. 기본 결과의 `ready: false`는 정상적인 미설정 보고일 수 있습니다.

```sh
rtk proxy node scripts/beta-operations.mjs
rtk proxy node scripts/beta-operations.mjs --public

# mac-mini 저장소에서만: Pod 상태와 최근 OOM을 읽습니다.
rtk proxy node scripts/beta-operations.mjs --public --runtime --context kind-nowline-local

# 외부 운영 요건이 미설정/미검증이면 exit 2. 배포 자체의 성공 판정과 구분합니다.
rtk proxy node scripts/beta-operations.mjs --require-ready

# 정적 보안/자원 검사, 실제 컨테이너, 배포 후 수집 검사
rtk proxy node scripts/verify-observability.mjs
rtk proxy node scripts/verify-observability.mjs --containers
rtk proxy node scripts/verify-observability.mjs --runtime --context kind-nowline-local
```

공개 점검은 응답 코드뿐 아니라 health 본문·버전 SHA 형식·OIDC issuer를 확인해 SPA fallback의 가짜 200을 거릅니다. 다만 실제 로그인 성공, 사용자가 쓴 내용의 저장, 실기기 알림은 별도 사용자 흐름 QA 대상입니다. 버전 조회 통과는 **특정 배포 SHA 일치**를 뜻하지 않으므로 배포 담당자는 기대 SHA와도 비교해야 합니다.

기본 실행 exit 0은 “읽기 전용 진단 실행 성공”이지 운영 준비 완료가 아닙니다. 선택한 실측 검사 실패는 exit 1, `--require-ready` 미충족은 exit 2입니다. 외부 모니터·알림·실제 복원은 이 CLI만으로 인증할 수 없어서 `unverified`로 남습니다. 수동 증거로 운영 승인을 별도 기록하고 이를 무조건 통과시키는 환경변수는 만들지 않습니다.

## 외부 백업 확인

현재 `scripts/backup-local-mysql.sh`는 **Compose 전용**입니다. k8s 배포 서버에서 이를 실행해 백업됐다고 착각하지 마세요. k8s의 기존 배포 전 덤프는 `scripts/deploy-mac-mini.mjs`가 생성하며, 배포 없는 날은 아래 host 일일 백업을 이용합니다. `beta-operations.mjs` 자체는 진단만 수행합니다.

### Mac mini 일일 백업 설치

`scripts/scheduled-beta-backup.mjs`는 기본 실행이 읽기 전용 도움말입니다. 아래 **install/run은 상태를 변경**하므로 배포 담당자가 Mac mini 저장소에서 명시적으로 실행합니다. 설치 시 `RunAtLoad`로 첫 백업이 즉시 시작될 수 있습니다. 현재 로그인한 사용자의 LaunchAgent이며 root 작업이 아닙니다.

```sh
rtk proxy node scripts/scheduled-beta-backup.mjs --install --context kind-nowline-local --repository /Users/jieseobpark/develop/planner
rtk proxy node scripts/scheduled-beta-backup.mjs --verify

# 최근 정상본이 있어도 추가 생성: MySQL 읽기, 로컬 압축 파일 쓰기
rtk proxy node scripts/scheduled-beta-backup.mjs --run --context kind-nowline-local --force

# 외부 보관 검증까지 필수로 요구할 때만 사용
rtk proxy node scripts/scheduled-beta-backup.mjs --verify --require-offhost
```

- LaunchAgent 이름: `com.goalstotoday.backup`. 절대 Node/저장소 경로와 Homebrew 포함 PATH를 저장하여 비로그인 셸에서도 실행합니다. 로컬 03:15 트리거 + 1시간마다 재시도하며, 24시간 이내 정상 백업이 있으면 건너뜁니다. 성공 주기는 최초 실행 시간에 따라 달라질 수 있습니다.
- **재부팅 후 사용자 로그인이 필요합니다.** LaunchAgent가 살아 있어도 k8s/MySQL이 꺼져 있으면 덤프가 실패하고 다음 기회에 재시도합니다. root LaunchDaemon/로그인 전 FileVault 해제/자동 로그인은 자동 설정하지 않습니다.
- 보관 위치: 로그인 사용자 `.local/state/goalstotoday-backup`. 디렉터리 700, 파일 600. SQL을 디스크에 평문 중간 파일로 쓰지 않고 gzip으로 스트리밍하지만 **로컬 gzip은 암호화가 아닙니다**. 파일시스템/기기 암호화·오프사이트 사본이 추가로 필요합니다.
- 2 GiB 여유 공간 확인, 압축 1 GiB/해제 8 GiB 제한, 10분 dump timeout. 범위를 넘는다면 실패를 무시하지 말고 DB 규모에 맞게 용량·백업 방식을 조정합니다.
- 앱 DB와 Keycloak 로그인 DB를 함께 `--single-transaction` 덤프합니다. 배포 lock 발견 시 실패하며 스키마 변경과 백업을 동시에 계획하지 않습니다.
- 자동 정리는 자기 소유 manifest가 있는 정상 파일만 대상으로 합니다. 최신 7개를 무조건 남기고, 그 밖의 **14일 초과** 로컬 artifact만 삭제합니다. 알 수 없는 파일/심볼릭 링크/사용자 디렉터리/원격 객체는 삭제하지 않습니다. 삭제 수는 결과의 `removedLocalArtifacts`에 표시되며 외부 사본이 없다면 삭제본 복구를 보장하지 않습니다.
- 실패 시 `last-run.json`의 단계와 종료 코드만 기록하고 이전 `last-success.json`과 정상본은 보존합니다. SQL/자격 증명은 scheduler 로그에 출력하지 않습니다. stale lock은 자동 제거하지 않으며 PID를 확인한 운영자만 정확한 lock 파일을 처리합니다.
- `--verify`는 최신 파일의 gzip·크기·SHA와 26시간 신선도, 마지막 실패/lock 상태를 검사합니다. 실패/지연/미설치 exit 2. `beta-operations.mjs --runtime`도 이 상태를 함께 보여 줍니다. 이것은 외부 알림을 발송하는 스케줄러가 아닙니다.

### 선택한 외부 저장소로 자동 업로드

운영자가 실제 버킷/최소 권한 AWS profile을 마련한 뒤 `NOWLINE_BACKUP_S3_PREFIX`를 명시하여 설치하면, 이후 run은 그 목적지로 업로드합니다. **이 변수 없이 외부 전송은 없습니다.** 루트/전체 S3 권한 대신 지정 prefix의 PutObject/GetObject만 허용하고 버킷 공개 접근을 차단하세요. 키 자체는 plist/설정 파일/저장소에 저장하지 않습니다. 예시는 그대로 실행하지 않습니다.

```sh
rtk proxy env NOWLINE_BACKUP_S3_PREFIX=s3://operator-selected-bucket/mysql AWS_PROFILE=beta-backup \
  node scripts/scheduled-beta-backup.mjs --install --context kind-nowline-local --repository /Users/jieseobpark/develop/planner
```

새 고유 객체를 `STANDARD`, SSE-S3 `AES256`, 전체 SHA-256, `If-None-Match: *` 조건으로 업로드하고 HEAD 결과를 다시 비교합니다. 원격 검증이 실패하면 전체 run은 실패하며 로컬 사본은 남깁니다. 최신 AWS CLI가 필요하며 지원하지 않는 S3 호환 공급자는 확인 없이 성공 처리하지 않습니다. 원격 보존 기간/버전 관리/수명주기는 별도 버킷 정책입니다. 재설치에서 변수가 없으면 기존 외부 설정을 보존하므로 비활성화는 운영자가 해당 600 권한 `config.json`을 검토해야 합니다. [AWS PutObject 조건·체크섬](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html), [HEAD 체크섬 조회](https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html)

운영자가 별도 저장소에 업로드한 최신 `.sql.gz` 객체와 그 로컬 원본을 명시합니다. AWS CLI는 로컬 자격 증명 체인을 이용합니다. 키는 채팅/저장소에 넣지 마세요.

```sh
# 버킷/객체는 예시입니다. 실제 선택한 저장소와 덤프 파일로 바꿉니다.
rtk proxy env NOWLINE_BACKUP_S3_OBJECT=s3://operator-selected-bucket/mysql/latest.sql.gz \
  node scripts/beta-operations.mjs --verify-offhost --backup-file /absolute/path/to/latest.sql.gz
```

검사 기준:

- 최근 26시간 이내 파일/객체, 정상 gzip, 비어 있지 않은 SQL payload. 파일 수정 시각만으로 DB 데이터의 생성 시점을 입증하지는 않습니다.
- 원격 크기 일치, 서버 측 암호화, 실제 S3 전체 객체 SHA-256 일치. ETag/사용자 지정 metadata는 무결성 증거로 쓰지 않습니다. 전체 체크섬이 없으면 `unverified`입니다.
- 최신 복구용은 즉시 조회 가능한 storage class. `GLACIER`/`DEEP_ARCHIVE`/아카이브 상태 최신본만 있으면 실패합니다. 장기 아카이브는 추가 사본/수명주기 정책으로 분리하세요.
- S3의 `head-object --checksum-mode ENABLED`만 호출하며 업로드/삭제/내용 다운로드를 하지 않습니다. KMS 체크섬 조회는 추가 KMS 권한이 필요할 수 있습니다.

이 체크가 통과해도 SQL 복원 성공은 아닙니다. 외부 최신본을 내려받아 **새 격리 MySQL**로 복원하고 사용자 수·계획·하위 할 일·기간 목표·회고·인증 DB를 비교해야 합니다. 운영 DB로 복원 테스트를 수행하지 마세요. 복구 시간(RTO)과 허용 손실(RPO)은 첫 베타 전에 합의하세요. 권장 초기 목표는 일일 백업 + 최대 24시간 RPO이며, 유료 전환 전에는 더 짧은 RPO를 재검토합니다.

### 실제 최신 백업의 안전한 복원 리허설

`verify-backup-restore.mjs`의 기본 실행은 읽기 전용 도움말이며 **`--run`만** 임시 컨테이너를 생성합니다. `kubectl`, 운영 DB 접속 주소/포트, 기존 컨테이너를 대상으로 하는 옵션은 없습니다. 선택한 gzip 원본은 읽기만 하며 import 중 SHA-256도 재검사해 원본 교체를 놓치지 않습니다. CLI는 SQL 원문·사용자 행·비밀번호·컨테이너 로그를 출력하지 않고 스키마/테이블별 **건수**와 무결성 결과만 출력합니다.

Mac mini 저장소에서 여유 메모리를 확인한 뒤 한 번에 하나씩 실행합니다. `--latest`는 일일 백업의 `last-success.json`과 gzip 체크섬을 검증해 그 파일을 사용합니다. 배포 전 덤프 또는 내려받은 외부 덤프는 절대 경로로 지정합니다. 실행 스크립트는 이미지를 임의로 pull하지 않습니다.

```sh
# 지정한 검증 이미지가 없을 때 한 번만 준비합니다.
rtk proxy docker pull mysql:8.4.10@sha256:8dbcf531a03aade657e181b9cf2f1d1803ce621a1d55610cb44cb531ab7d7db6

rtk proxy node scripts/verify-backup-restore.mjs --run --latest
# 또는
rtk proxy node scripts/verify-backup-restore.mjs --run --backup-file /absolute/path/to/downloaded-latest.sql.gz

# 동일 백업 스냅샷을 기준으로 만든 모든 테이블의 건수 JSON이 있을 때만 추가합니다.
rtk proxy node scripts/verify-backup-restore.mjs --run --latest --expected-counts /absolute/path/to/same-snapshot-counts.json

# 운영 백업을 사용하지 않는 자체 양성/음성 대조군
rtk proxy node --test scripts/verify-backup-restore.test.mjs
rtk proxy node scripts/verify-backup-restore.mjs --self-test
```

안전 제한과 판정 기준:

- 매번 UUID와 소유 토큰으로 이름을 정한 **새** MySQL만 생성합니다. 네트워크 없음, 공개 포트/호스트 볼륨 없음, root filesystem 읽기 전용, capability 제거, 비-root UID, 데이터는 tmpfs입니다. 최신 이미지 코드 실행을 위해 운영 DB나 Docker socket을 컨테이너에 마운트하지 않습니다.
- CPU 1, 메모리 1 GiB, 데이터 tmpfs 768 MiB. 입력은 압축 128 MiB/해제 SQL 256 MiB 이하로 제한합니다. 큰 데이터셋은 임의로 제한을 풀지 말고 별도 복구 호스트 용량을 먼저 검토합니다.
- MySQL startup 최대 90초, import 최대 180초, 전체 검사 8분, 각 명령 최대 30초입니다. 정리에는 별도 최대 30초 제한을 적용합니다. OOM·timeout·불완전 스키마·체크섬 변경·건수 불일치는 실패입니다.
- `nowline`의 사용자/할 일/하위 할 일/기간 문서/Flyway와 `keycloak`의 realm/사용자/migration 테이블을 요구합니다. 실패한 Flyway migration, 누락된 `nowline` realm을 거부합니다. 두 DB의 모든 base table을 `COUNT(*)`로 세고, 모든 외래 키의 고아 행(복합 키·nullable 포함)과 `CHECK TABLE` 결과도 확인합니다.
- `--expected-counts`는 `{"nowline.app_user": 12, "keycloak.USER_ENTITY": 14, ...}`처럼 **같은 스냅샷의 모든 테이블** 건수입니다. 현재 운영 DB 건수는 백업 뒤 바뀔 수 있으므로 이 baseline으로 오인하지 마세요. baseline이 없으면 `sourceCountComparison: not-supplied`이며 원본 대비 행 손실 0을 주장하지 않습니다.
- 성공/실패 후 같은 소유 토큰·이름·ID를 재확인한 임시 컨테이너만 제거합니다. Kubernetes 리소스/기존 컨테이너/이미지/호스트 디렉터리 삭제나 `prune`은 하지 않습니다. 정리 확인이 불가능하면 성공을 반환하지 않습니다. Docker 장애로 남은 fixture는 운영자가 소유 레이블을 확인한 뒤 해당 ID만 처리합니다.
- 로컬 최신본 복원 성공은 외부 보관 내구성이나 로그인 기능 전체 복구의 증거가 아닙니다. `offhostDurabilityVerified: false`가 기본입니다. 외부에서 실제 내려받은 사본의 체크섬 일치와 복원 결과, 애플리케이션·인증 smoke test를 별도 기록하세요.

## 외부 모니터와 실제 장애 대응

`NOWLINE_EXTERNAL_MONITOR_URL`, `NOWLINE_ALERT_CHANNEL`은 진단에서 **설정 유무만** 나타냅니다. URL/수신처 입력만으로 성공 상태로 바꾸거나 알림을 발송하지 않습니다. 독립 서비스/호스트에서 1~5분 간격으로 공개 health와 OIDC discovery를 확인하고, 일부러 만든 모니터 테스트 장애와 복구 모두 수신되는지 검증하세요. 실서비스를 끄거나 사용자의 실행 중인 타이머를 조작해 시험하지 않습니다.

Mac mini에서는 절전 방지·정전 후 자동 기동·로그인 전 컨테이너/터널 기동을 운영자가 확인해야 합니다. FileVault 해제 등 보안 완화 없이 재부팅과 복구 절차를 검증하고, 서버·VM 실제 디스크 공간은 `df`로 별도 확인합니다. kind local-path PVC 용량 요청은 물리 용량 제한이 아니며 지표가 없으면 안전하다는 뜻이 아닙니다.

사고 대응 순서: 장애 시각/사용자 영향 기록 → 공개 health/OIDC 확인 → 백오피스 오류와 Grafana 동일 시각 조회 → Pod `lastState`/이벤트 및 실제 디스크 확인 → 원인 범위에 한정한 복구 → 저장 데이터/로그인 재검증. 계정/본문/토큰이 포함된 로그를 외부 이슈에 그대로 붙이지 마세요.

## 작은 베타를 운영하는 순서

1. 내부 계정으로 가입·로그인·할 일/하위 할 일·날짜 이동·수정/삭제·동시 탭·재로그인 보존을 검증합니다.
2. Google 연결/해제/토큰 갱신, 15분 전 알림·일정 변경/취소·자정·실기기를 별도 검증합니다. Mock 테스트는 실계정 결과가 아닙니다.
3. 제한된 테스터와 운영 시간·지원 창구·데이터 보존/삭제 정책을 공유합니다. 실제 초대/외부 게시/유료 광고는 운영자가 대상과 문구를 승인한 뒤 진행합니다.
4. 매일 저장 오류·로그인 실패·알림 실패·메모리 여유와 피드백을 확인합니다. 원문 수집 대신 성공/실패/소요 시간 같은 최소 집계만 사용합니다.
5. 매주 재방문·주요 흐름 성공·지원 요청을 보고 가장 빈번한 불편 1~2개를 수정합니다. 유료 결제/약관/세금/스토어 심사는 별도 출시 관문입니다.

이 문서는 베타의 기술 운영 절차이며 법률·세무 적합성 검토를 대체하지 않습니다.
