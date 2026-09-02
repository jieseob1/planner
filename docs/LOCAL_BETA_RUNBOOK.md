# Local multi-user beta runbook

이 문서는 한 대의 Mac mini에서 실제 계정별 데이터를 분리해 공개 베타를 운영하는 절차입니다. Kubernetes Service는 서버의 `localhost`에만 바인딩하고 Cloudflare Tunnel이 `https://goalstotoday.com`으로 전달합니다.

## 현재 제공 범위

- Keycloak 자체 회원가입과 OIDC Authorization Code + PKCE
- 사용자별 JWT tenant 분리와 필수 약관·개인정보 동의
- MySQL 8.4 영속 저장과 가입 시 무료 BETA 권한 자동 부여
- React 웹/PWA, Spring Java 25 virtual threads, backend 2 replicas
- 실행 중 `mysqldump --single-transaction`, gzip, SHA-256 checksum
- 선택적 S3 업로드와 `DEEP_ARCHIVE` storage class

결제는 아직 연결하지 않습니다. 신규 계정은 무료 BETA이며 자동 청구되지 않습니다. `account_entitlement`에는 향후 PRO와 결제 provider/customer/subscription 상태를 저장할 경계만 준비되어 있습니다.

## Kubernetes로 오늘 기동

현재 `kubectl` context가 테스트할 로컬 클러스터인지 먼저 확인합니다. 스크립트는 context를 만들거나 변경하지 않습니다.

```bash
kubectl config current-context
npm run verify:beta:k8s
npm run k8s:serve:status
```

성공 후 앱은 [http://localhost:4189](http://localhost:4189)에서 계속 실행됩니다. 검증은 서로 다른 두 계정을 실제 등록해 각자의 계획 저장, 교차 노출 부재, 로그아웃 후 재로그인 영속성, 무료 베타 권한을 확인합니다.

공개 origin으로 다시 빌드·배포할 때는 기존 사용자의 issuer를 먼저 백업·이전한 뒤 stack을 올립니다.

```bash
NOWLINE_PUBLIC_ORIGIN=https://goalstotoday.com \
  NOWLINE_KUBE_CONTEXT=kind-nowline-local \
  scripts/migrate-k8s-oidc-issuer.sh
NOWLINE_PUBLIC_ORIGIN=https://goalstotoday.com \
  NOWLINE_KUBE_CONTEXT=kind-nowline-local \
  scripts/k8s-local.sh up
```

Cloudflare의 `goalstotoday` 전용 터널에서 apex와 `www` CNAME은 모두 `http://127.0.0.1:4189` origin으로 전달합니다. 기존 `mac-mini-server` 터널과 SSH route는 분리되어 있습니다. `www` 요청은 앱 Nginx가 `https://goalstotoday.com`으로 308 리다이렉트합니다.

전용 tunnel UUID credential은 `$HOME/.cloudflared`에 owner-only 권한으로 보관하며 Git에 넣지 않습니다.

```bash
kubectl --namespace nowline-local get pods
npm run k8s:serve:status
```

### Mac mini 부팅 후 로그인 없는 자동 복구

`brew services`와 `~/Library/LaunchAgents`는 GUI 로그인 전에는 실행되지 않으므로 무인 서버의 재부팅 복구 수단으로 사용하지 않습니다. 설치 스크립트는 기존 로그인 전용 Colima·포트포워드·전용 터널 LaunchAgent를 삭제하지 않고 `~/Library/LaunchAgents.disabled`로 옮긴 뒤, 동일한 사용자 권한으로 실행되는 두 개의 시스템 LaunchDaemon을 설치합니다. 첫 번째는 Colima를 기동하고 Kubernetes 서비스가 준비될 때까지 기다려 `127.0.0.1:4189` 포트포워드를 유지하며, 두 번째는 전용 Cloudflare Tunnel을 유지합니다.

```bash
sudo scripts/install-mac-mini-headless-services.sh
```

상태는 `launchctl print system/com.nowline.local-beta`, `launchctl print system/com.goalstotoday.tunnel`, `curl --fail http://127.0.0.1:4189/healthz`로 확인합니다. 설치 스크립트는 실행 중인 저장소 위치와 `sudo`를 호출한 사용자의 홈 디렉터리를 plist에 렌더링합니다. 설치 후에는 `brew services start colima`를 다시 실행하지 않습니다.

sudo 인증을 사용할 수 없는 원격 복구에서는 macOS가 기본 제공하는 system cron의 `@reboot` fallback을 설치할 수 있습니다. 이 방식도 GUI 로그인 전에 사용자 권한으로 실행되며, supervisor가 Colima·포트포워드·전용 tunnel을 감시하고 종료된 자식 프로세스를 재시작합니다. 1분 watchdog은 supervisor 자체도 다시 시작합니다. 기존 crontab의 다른 항목은 보존하고 Goals to Today marker 구간만 갱신합니다.

```bash
scripts/install-mac-mini-user-reboot-services.sh
crontab -l
```

운영 우선순위는 system LaunchDaemon, cron `@reboot` fallback 순서입니다. 둘 중 하나만 사용하며 `npm run verify:goalstotoday:mac-mini`가 실제 실행 방식과 공개 사용자 흐름을 함께 확인합니다.

종료 시 포트포워드와 workload만 내립니다. MySQL PVC는 유지됩니다.

```bash
npm run k8s:serve:stop
npm run k8s:down
```

기존 MySQL Secret과 PVC가 있으면 비밀번호를 임의 교체하지 않고 재사용합니다. 과거 PostgreSQL PVC도 자동 삭제하지 않습니다.

## Compose 대안과 백업

```bash
npm run beta:prepare
npm run beta:up
npm run verify:beta:runtime
npm run beta:backup
```

- 앱: [http://localhost:8088](http://localhost:8088)
- Keycloak 관리자: 이 컴퓨터에서만 `http://localhost:9090/idp/admin/`
- 설정·비밀번호: Git에서 제외된 `.env.local-beta`
- 백업: Git에서 제외된 `.local-backups/`

백업을 S3 archive로도 보낼 때만 AWS CLI 자격 증명과 목적지를 환경 변수로 제공합니다.

```bash
NOWLINE_BACKUP_S3_URI=s3://<bucket>/nowline npm run beta:backup
```

기본 storage class는 `DEEP_ARCHIVE`입니다. Glacier 계열은 복원에 시간이 필요한 보관소이며 실행 중인 애플리케이션 DB로 사용할 수 없습니다.

## AWS DB 이전 경계

온라인 DB는 Amazon RDS for MySQL 또는 Aurora MySQL 같은 MySQL 호환 서비스가 필요합니다. JDBC URL·사용자·비밀번호를 외부 Secret으로 주입하고 TLS, Multi-AZ, 자동 backup, PITR을 켭니다. S3 Glacier/Deep Archive에는 암호화한 DB backup과 checksum만 보관합니다.

이전 순서는 다음과 같습니다.

1. 로컬 backup을 생성하고 gzip·SHA-256을 확인합니다.
2. 대상 MySQL의 문자셋 `utf8mb4`, UTC, TLS 연결을 확인합니다.
3. 점검 시간에 write를 중지하고 최종 dump를 복원합니다.
4. Flyway가 V1–V8 checksum을 그대로 인식하는지 확인합니다.
5. 사용자 수, 활성 계획 수, planner fingerprint를 비교한 뒤 JDBC Secret을 전환합니다.
6. 전환 실패 시 로컬 JDBC 설정으로 되돌리고 원본 PVC와 dump를 보존합니다.

## 유료 전환 전에 남은 필수 작업

- Keycloak 운영 admin 계정 복구 절차와 정기 realm/database backup
- 관리형 MySQL HA, 자동 backup/PITR와 별도 복구 연습
- 실제 Google OAuth client·동의 화면·검증 도메인
- 이메일 인증/비밀번호 복구 메일 공급자와 abuse 대응
- 약관·개인정보 처리방침의 운영 주체 정보와 법률 검토
- 유료 전환 전 가격, 세금, 환불, webhook 검증을 포함한 결제 공급자 연결

이 항목이 끝나기 전에는 `0.0.0.0` 포트포워드나 라우터 포트 개방으로 인터넷에 직접 노출하지 않습니다.
