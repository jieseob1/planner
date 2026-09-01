# Production setup

이 문서는 저장소에 이미 구현된 운영 경계를 실제 공개 환경에 연결할 때 필요한 값과 순서를 정리합니다. 현재 공식 웹 origin은 `https://goalstotoday.com`이며 `www.goalstotoday.com`은 apex로 리다이렉트합니다.

## 1. 외부 인프라

필수 구성은 다음과 같습니다.

- Kubernetes 1.30 이상, Ingress NGINX, metrics-server
- Prometheus Operator CRD(`ServiceMonitor`, `PrometheusRule`)와 OTLP collector
- TLS 인증서를 발급하는 cert-manager 또는 동일 역할의 인증서 운영 체계
- 다중 AZ 관리형 MySQL 8.4, 자동 백업과 PITR(point-in-time recovery)
- Kubernetes Secret을 공급하는 외부 Secret Manager
- OIDC 공급자, Google Cloud OAuth 앱, VAPID 키
- 앱 알림을 사용할 경우 APNs·FCM을 호출하는 내부 push adapter

프로덕션 overlay는 단일 MySQL을 포함하지 않습니다. `nowline-production-secrets`가 먼저 만들어져 있어야 하며 Git에 실제 Secret을 넣으면 안 됩니다.

| Secret key | 의미 |
| --- | --- |
| `db-url`, `db-username`, `db-password` | TLS와 UTC를 강제한 외부 MySQL 8.4 접속 정보 |
| `oidc-issuer`, `oidc-audience` | JWT 발급자 URL과 Goals to Today API audience |
| `integration-encryption-key-base64` | 32바이트 난수를 Base64로 인코딩한 AES-256-GCM 키 |
| `google-client-id`, `google-client-secret` | Google OAuth 웹 애플리케이션 자격 증명 |
| `vapid-public-key`, `vapid-private-key`, `vapid-subject` | Web Push VAPID 설정 |
| `native-push-delivery-uri`, `native-push-bearer-token` | APNs·FCM adapter의 HTTPS 주소와 서비스 토큰 |

`db-url`은 공급자의 CA 검증과 UTC를 강제해야 합니다. 예시는 다음과 같으며 `<host>`와 인증서는 실제 공급자 값으로 교체합니다.

```text
jdbc:mysql://<host>:3306/nowline?sslMode=VERIFY_IDENTITY&serverTimezone=UTC&preserveInstants=true&useUnicode=true&characterEncoding=utf8&connectionCollation=utf8mb4_0900_as_ci
```

Secret Manager 연동은 `nowline-production` namespace에 정확히 `nowline-production-secrets`라는 Secret을 생성해야 합니다. 배포 workflow는 이 Secret을 만들거나 실제 값을 Git에 기록하지 않습니다.

## 2. OIDC

공급자에 Authorization Code + PKCE public client를 만들고 아래 값을 정확히 등록합니다.

- Web callback: `https://goalstotoday.com/auth/callback`
- Web logout: `https://goalstotoday.com`
- Silent callback: `https://goalstotoday.com/auth/silent-callback`
- Native callback: `com.jieseob.planner://auth/callback`
- Native logout: `com.jieseob.planner://auth/logout`
- Scope: `openid profile email offline_access`
- Access token audience: 운영 Secret의 `oidc-audience`와 동일

운영 빌드는 `VITE_AUTH_MODE=oidc`가 필수입니다. 웹 상태는 session storage, 네이티브 OIDC 상태·nonce·PKCE verifier는 Keychain/Keystore에 저장합니다. 계정 삭제는 `auth_time`이 15분 이내인 토큰만 허용하므로 삭제 직전 재로그인이 가능해야 합니다.

## 3. Google Calendar

Google Cloud Console에서 Calendar API를 켜고 OAuth 동의 화면, 개인정보 처리방침, 이용약관, 검증된 도메인을 등록합니다.

- Callback: `https://goalstotoday.com/api/v1/integrations/google-calendar/oauth/callback`
- Webhook: `https://goalstotoday.com/api/v1/calendar/google/webhook`
- 요청 scope:
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

테스트 단계에서는 지정된 테스트 계정만 연결할 수 있습니다. 공개 전에 Google의 요구 수준에 따라 앱 게시 또는 검증을 마치고, 실제 계정으로 연결 → offline refresh → 양방향 증분 동기화 → webhook → 해제 → 재연결을 확인합니다.

## 4. 도메인과 manifest

다음 위치는 모두 `https://goalstotoday.com`으로 고정되어 있으며 `npm run verify:goalstotoday:contracts`가 회귀를 막습니다.

- `infra/k8s/overlays/production/ingress.yaml`
- `infra/k8s/overlays/production/backend-patch.yaml`
- `.github/workflows/release.yml`
- `.github/workflows/mobile-release.yml`
- `.env.example`

`kubectl kustomize infra/k8s/overlays/production` 출력에 로컬 MySQL, 개발 JWT secret, `latest` 이미지가 없어야 합니다.

## 5. CI/CD 등록값

GitHub repository의 `Settings → Environments`에서 다음 이름을 그대로 등록합니다.

### `production` environment

| 종류 | 정확한 이름 | 값 형식·권한 |
| --- | --- | --- |
| Variable | `VITE_OIDC_AUTHORITY` | 운영 issuer HTTPS URL. OIDC discovery 문서에 접근 가능해야 함 |
| Variable | `VITE_OIDC_CLIENT_ID` | Authorization Code + PKCE public client ID |
| Secret | `KUBE_CONFIG_DATA` | 대상 cluster kubeconfig 전체를 Base64로 인코딩한 값. `nowline-production`에서 apply, Job 삭제·조회, rollout 조회 권한 필요 |

Kubernetes/Secret Manager에는 위 1절의 `nowline-production-secrets` 13개 key를 정확히 생성합니다. 운영 workflow의 GitHub token은 GHCR package write와 GitHub OIDC keyless signing에만 사용됩니다.

### `mobile-production` environment

| 종류 | 정확한 이름 | 값 형식·발급 위치 |
| --- | --- | --- |
| Variable | `VITE_OIDC_AUTHORITY` | 네이티브 redirect URI가 등록된 운영 issuer URL |
| Variable | `VITE_OIDC_CLIENT_ID` | 네이티브 callback을 허용하는 public client ID |
| Secret | `ANDROID_KEYSTORE_BASE64` | Android upload keystore 전체 Base64 |
| Secret | `ANDROID_KEYSTORE_PASSWORD` | upload keystore 비밀번호 |
| Secret | `ANDROID_KEY_ALIAS` | 서명 key alias |
| Secret | `ANDROID_KEY_PASSWORD` | alias key 비밀번호 |
| Secret | `GOOGLE_SERVICES_JSON_BASE64` | Firebase Console의 Android `google-services.json` 전체 Base64 |
| Secret | `APP_STORE_CONNECT_API_KEY_BASE64` | App Store Connect API `.p8` 파일 전체 Base64 |
| Secret | `APP_STORE_CONNECT_KEY_ID` | App Store Connect API key ID |
| Secret | `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect issuer ID |
| Secret | `APPLE_TEAM_ID` | Apple Developer Team ID |

### 발급 주체와 최소 권한

| 자산 | 발급 위치 | 필요한 최소 권한 |
| --- | --- | --- |
| domain/DNS/TLS | 도메인 등록기관·DNS provider·cert-manager issuer | DNS record 변경과 인증서 challenge 수행 |
| Kubernetes | 대상 cloud/cluster IAM | `nowline-production` namespace 배포·Job·rollout 관리; cluster 전체 관리자 권한은 불필요 |
| 관리형 MySQL | DB provider | DB·전용 사용자 생성, TLS CA 조회, 자동 backup/PITR 설정과 별도 복구 instance 생성 |
| OIDC | 선택한 IdP의 app/client 관리 화면 | public client·redirect URI·audience·테스트 사용자 관리 |
| Google Calendar | Google Cloud Console·OAuth consent screen·Search Console | Calendar API 활성화, OAuth client/동의 화면 편집, 도메인 소유권 검증 |
| Android | Google Play Console·Firebase Console | App signing/upload key 관리, 내부 테스트 release, FCM 앱 설정 |
| iOS | Apple Developer·App Store Connect | App ID/provisioning/APNs 관리와 API key 기반 build upload |

릴리스 태그 또는 수동 실행은 다음 순서를 강제합니다.

1. 프론트·백엔드·DB 통합 검증
2. SBOM·provenance를 포함한 두 이미지 빌드
3. 두 이미지 Trivy HIGH/CRITICAL 스캔
4. GitHub OIDC 기반 keyless cosign 서명
5. 전용 migration Job 완료
6. 이미지 digest 고정 배포와 rollout 확인

### 사용자가 제공할 최소 작업

1. `goalstotoday.com` Cloudflare DNS/Tunnel과 사용할 Kubernetes·관리형 MySQL·OIDC 공급자를 관리합니다.
2. 위 두 GitHub environment에 정확한 variable/secret 이름으로 값을 등록합니다.
3. `nowline-production-secrets`를 Secret Manager에서 동기화합니다.
4. Google OAuth 테스트 계정과 Apple/Play 내부 테스트 계정을 지정합니다.
5. 값 자체를 채팅이나 Git에 붙이지 말고 등록 완료 여부와 staging URL만 전달합니다. 이후 smoke, 실계정 Calendar, PITR, alert, 실기기 검증을 이어서 수행합니다.

## 6. 공개 전 승인표

저장소 안에서는 `npm run verify:production`으로 웹·백엔드·마이그레이션·복구·K8s 계약·의존성을 검증합니다. 실제 외부 자산은 아래 승인표를 모두 통과한 뒤에만 공개합니다.

- [x] `goalstotoday.com` domain 계약과 정확한 CORS origin
- [ ] OIDC wrong issuer/audience/expiry와 두 사용자 격리 실증
- [ ] Google OAuth 게시·검증 상태와 실계정 전체 연동 실증
- [ ] 관리형 MySQL 자동 백업/PITR 복구 리허설
- [ ] Prometheus alerts가 실제 온콜 채널로 전달됨
- [ ] iOS·Android 서명, 실기기 deep link·push·계정 삭제
- [ ] 개인정보 처리방침의 사업자·담당자·보관기간을 실제 운영 주체 기준으로 법률 검토
