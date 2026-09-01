# Production setup

이 문서는 저장소에 이미 구현된 운영 경계를 실제 공개 환경에 연결할 때 필요한 값과 순서를 정리합니다. 예시 도메인 `app.nowline.example`은 배포 전 전부 실제 도메인으로 바꿔야 합니다.

## 1. 외부 인프라

필수 구성은 다음과 같습니다.

- Kubernetes 1.30 이상, Ingress NGINX, metrics-server
- Prometheus Operator CRD(`ServiceMonitor`, `PrometheusRule`)와 OTLP collector
- TLS 인증서를 발급하는 cert-manager 또는 동일 역할의 인증서 운영 체계
- 다중 AZ 관리형 PostgreSQL 17, 자동 백업과 PITR(point-in-time recovery)
- Kubernetes Secret을 공급하는 외부 Secret Manager
- OIDC 공급자, Google Cloud OAuth 앱, VAPID 키
- 앱 알림을 사용할 경우 APNs·FCM을 호출하는 내부 push adapter

프로덕션 overlay는 단일 PostgreSQL을 포함하지 않습니다. `nowline-production-secrets`가 먼저 만들어져 있어야 하며 Git에 실제 Secret을 넣으면 안 됩니다.

| Secret key | 의미 |
| --- | --- |
| `db-url`, `db-username`, `db-password` | TLS를 강제한 외부 PostgreSQL 접속 정보 |
| `oidc-issuer`, `oidc-audience` | JWT 발급자 URL과 Nowline API audience |
| `integration-encryption-key-base64` | 32바이트 난수를 Base64로 인코딩한 AES-256-GCM 키 |
| `google-client-id`, `google-client-secret` | Google OAuth 웹 애플리케이션 자격 증명 |
| `vapid-public-key`, `vapid-private-key`, `vapid-subject` | Web Push VAPID 설정 |
| `native-push-delivery-uri`, `native-push-bearer-token` | APNs·FCM adapter의 HTTPS 주소와 서비스 토큰 |

## 2. OIDC

공급자에 Authorization Code + PKCE public client를 만들고 아래 값을 정확히 등록합니다.

- Web callback: `https://<domain>/auth/callback`
- Web logout: `https://<domain>`
- Silent callback: `https://<domain>/auth/silent-callback`
- Native callback: `com.jieseob.planner://auth/callback`
- Native logout: `com.jieseob.planner://auth/logout`
- Scope: `openid profile email offline_access`
- Access token audience: 운영 Secret의 `oidc-audience`와 동일

운영 빌드는 `VITE_AUTH_MODE=oidc`가 필수입니다. 웹 상태는 session storage, 네이티브 OIDC 상태·nonce·PKCE verifier는 Keychain/Keystore에 저장합니다. 계정 삭제는 `auth_time`이 15분 이내인 토큰만 허용하므로 삭제 직전 재로그인이 가능해야 합니다.

## 3. Google Calendar

Google Cloud Console에서 Calendar API를 켜고 OAuth 동의 화면, 개인정보 처리방침, 이용약관, 검증된 도메인을 등록합니다.

- Callback: `https://<domain>/api/v1/integrations/google-calendar/oauth/callback`
- Webhook: `https://<domain>/api/v1/calendar/google/webhook`
- 요청 scope:
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

테스트 단계에서는 지정된 테스트 계정만 연결할 수 있습니다. 공개 전에 Google의 요구 수준에 따라 앱 게시 또는 검증을 마치고, 실제 계정으로 연결 → offline refresh → 양방향 증분 동기화 → webhook → 해제 → 재연결을 확인합니다.

## 4. 도메인과 manifest

다음 위치의 `app.nowline.example`을 한 번에 실제 HTTPS origin으로 교체합니다.

- `infra/k8s/overlays/production/ingress.yaml`
- `infra/k8s/overlays/production/backend-patch.yaml`
- `.github/workflows/release.yml`
- `.github/workflows/mobile-release.yml`
- `.env.example`

`kubectl kustomize infra/k8s/overlays/production` 출력에 로컬 PostgreSQL, 개발 JWT secret, `latest` 이미지가 없어야 합니다.

## 5. CI/CD 등록값

GitHub `production` environment에는 `KUBE_CONFIG_DATA` Secret과 `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID` variables를 등록합니다. `mobile-production` environment에는 Android keystore/FCM과 App Store Connect API key/Team ID를 등록합니다.

릴리스 태그 또는 수동 실행은 다음 순서를 강제합니다.

1. 프론트·백엔드·DB 통합 검증
2. SBOM·provenance를 포함한 두 이미지 빌드
3. 두 이미지 Trivy HIGH/CRITICAL 스캔
4. GitHub OIDC 기반 keyless cosign 서명
5. 전용 migration Job 완료
6. 이미지 digest 고정 배포와 rollout 확인

## 6. 공개 전 승인표

저장소 안에서는 `npm run verify:production`으로 웹·백엔드·마이그레이션·복구·K8s 계약·의존성을 검증합니다. 실제 외부 자산은 아래 승인표를 모두 통과한 뒤에만 공개합니다.

- [ ] 실제 domain/DNS/TLS와 정확한 CORS origin
- [ ] OIDC wrong issuer/audience/expiry와 두 사용자 격리 실증
- [ ] Google OAuth 게시·검증 상태와 실계정 전체 연동 실증
- [ ] 관리형 PostgreSQL 자동 백업/PITR 복구 리허설
- [ ] Prometheus alerts가 실제 온콜 채널로 전달됨
- [ ] iOS·Android 서명, 실기기 deep link·push·계정 삭제
- [ ] 개인정보 처리방침의 사업자·담당자·보관기간을 실제 운영 주체 기준으로 법률 검토
