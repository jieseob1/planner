# Nowline backend

Java 25 / Spring Boot 4.1.1 기반의 stateless API입니다. MySQL 8.4 InnoDB가 planner, revision, plan lifecycle, audit, OAuth, job lease, notification과 rate-limit 상태의 단일 기준입니다.

## 런타임 경계

- Spring MVC + Java virtual threads
- OAuth2 Resource Server JWT 검증: issuer, signature, expiry, audience
- issuer+subject에서 안정적인 user UUID를 만들고 모든 query에 user_id 적용
- Hikari 기본 10 connections/Pod; virtual thread 수와 DB pool은 별도 제한
- Flyway V1~V7, RFC Problem Details, graceful shutdown
- Actuator liveness/readiness/Prometheus, Micrometer OTel traces
- 1MiB request limit, DB 공유 fixed-window rate limit, CSP/HSTS/frame/referrer/permissions headers

운영은 `NOWLINE_OIDC_ISSUER`와 `NOWLINE_OIDC_AUDIENCE`가 필수입니다. `local-auth` profile만 로컬 dev token endpoint와 HMAC JWT를 만들며 production manifest에는 이 secret이 없습니다.

## 로컬 실행

저장소 루트의 Compose 사용을 권장합니다.

```bash
cd ..
make compose-up
```

백엔드만 실행하려면 MySQL 8.4를 준비하고 local-auth profile을 명시합니다.

```bash
export SPRING_DATASOURCE_URL='jdbc:mysql://localhost:3306/nowline?useUnicode=true&characterEncoding=utf8&connectionCollation=utf8mb4_0900_as_ci&serverTimezone=UTC&preserveInstants=true'
export SPRING_DATASOURCE_USERNAME=nowline
export SPRING_DATASOURCE_PASSWORD=nowline
export SPRING_PROFILES_ACTIVE=local-auth
export NOWLINE_OIDC_ISSUER=https://identity.local.nowline.invalid
export NOWLINE_OIDC_AUDIENCE=nowline-api
export NOWLINE_DEV_JWT_SECRET=nowline-local-development-jwt-secret-change-before-production
./mvnw spring-boot:run
```

`GET /api/v1/auth/dev-token`에서 받은 bearer token을 local API에 사용합니다.

## API groups

| 경로 | 용도 |
| --- | --- |
| `/api/v1/planner` | 현재 활성 planner 조회/조건부 저장/삭제 |
| `/api/v1/plans` | 연간·분기 plan 생성, 활성화, 종료, 보관, 복원, audit |
| `/api/v1/integrations/google-calendar` | OAuth, 캘린더 선택, sync, disconnect |
| `/api/v1/calendar/google/webhook` | token/resource/message number 검증 push callback |
| `/api/v1/notifications` | push configuration와 device registration |
| `/api/v1/account/preferences` | timezone, reminder, quiet hours |
| `/api/v1/account/export` | 사용자 데이터 JSON export |
| `/api/v1/account/consent` | 현재 정책 버전 동의 조회/저장 |
| `/api/v1/account` | fresh-auth 확인 후 cascade account deletion |

Planner PUT/DELETE에는 `Idempotency-Key`와 `If-None-Match: *` 또는 현재 strong `If-Match`가 필요합니다. stale write는 412이며 클라이언트가 3-way 비교를 엽니다.

## Google Calendar

OAuth state와 PKCE verifier는 10분 만료되는 일회성 DB row입니다. refresh token은 AES-256-GCM으로 암호화하며 access token은 저장하지 않습니다. worker는 MySQL `FOR UPDATE SKIP LOCKED` lease로 여러 replica에서 job 하나를 한 번만 소유합니다. 쓰기 transaction은 transient lock/deadlock일 때 새 transaction으로 최대 3회 bounded retry합니다.

Sync는 pagination, sync token, 410 full resync, tombstone, RFC3339 timezone, recurrence-safe external block, extended property identity, ETag conditional update, quota backoff를 처리합니다. webhook은 channel token hash와 증가 message number를 검증하며 scheduled reconciliation이 push 누락을 보완합니다.

## 데이터 보호

계정 삭제는 JWT `auth_time`이 15분 이내이고 request body가 `{"confirmation":"DELETE"}`일 때만 수행합니다. Google revoke 실패가 privacy deletion을 막지는 않으며 로컬 token/device/planner/audit row는 FK cascade로 삭제합니다.

정책 버전은 `NOWLINE_POLICY_VERSION`, 필수 여부는 `NOWLINE_POLICY_CONSENT_REQUIRED`로 설정합니다. 정책이 바뀌면 기존 timestamp가 있어도 버전이 다르면 API가 403을 반환합니다.

## 테스트

```bash
./mvnw verify
```

Testcontainers MySQL 8.4에서 migration, auth failure, tenant 격리, lifecycle/audit, concurrency/idempotency, `SKIP LOCKED` 단일 claim, transient deadlock retry, calendar sync, preferences/export/deletion, health/metrics를 확인합니다. 루트의 `npm run verify:e2e`는 실제 Compose HTTP 경로, `npm run verify:k8s:runtime`은 두 Pod의 concurrent ETag 경로를 검증합니다.

운영 migration은 애플리케이션 Pod보다 먼저 `migration-job.yaml`이 실행되고, 성공 뒤 Pod는 Flyway가 꺼진 상태로 rollout됩니다. schema 변경은 expand → deploy → contract와 forward-fix를 기본으로 합니다.
