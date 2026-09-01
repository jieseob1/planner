# Nowline 기능·QA 매트릭스

기준일: 2026-09-01  
대상 브랜치: `codex/production-service`

## 판정 기준

| 상태 | 의미 |
| --- | --- |
| 구현 완료 | production 경로가 실제 API·MySQL 또는 플랫폼 기능에 연결됨 |
| 부분 구현 | 저장소 내부 구현 또는 자동 검증이 일부만 존재함 |
| 미구현 | production 경로가 없거나 동작하지 않음 |
| 외부 자격 증명 필요 | 저장소에서 준비 가능한 구현·가짜 공급자 검증은 끝났지만 실제 운영 자산 없이는 최종 실증 불가 |
| QA 완료 | 명시된 자동 또는 로컬 실제 실행 검증이 통과함 |

`QA 완료`는 저장소와 로컬 격리 환경의 판정입니다. 가짜 Google 공급자, local-auth JWT, debug 앱을 실제 운영 OIDC·Google·APNs/FCM·스토어 승인으로 표현하지 않습니다.

## 사용자 기능

| 영역 | 기능 | 구현 상태 | QA 상태 | 근거 |
| --- | --- | --- | --- | --- |
| 인증 | OIDC Authorization Code + PKCE, state/nonce, 세션 복구·갱신·로그아웃 | 구현 완료 | QA 완료 | frontend auth 테스트, production contract, local-auth 브라우저 E2E |
| 인증 | 운영 OIDC tenant에서 실제 로그인·만료·재인증 | 외부 자격 증명 필요 | 외부 자격 증명 필요 | 운영 issuer, client, audience, 테스트 계정 필요 |
| 동의 | 이용약관·개인정보 필수 동의와 정책 버전 저장 | 구현 완료 | QA 완료 | `PlannerApiIT`, 최초 브라우저 동의 흐름 |
| 신규 계정 | 샘플 데이터 없는 onboarding과 최초 계획 생성 | 구현 완료 | QA 완료 | 신규 404 → onboarding → 실제 PUT, frontend 회귀 테스트와 E2E |
| 계획 | 연간·분기 계획 생성·수정·활성화·종료·보관·복원 | 구현 완료 | QA 완료 | Plans/Goals 브라우저 E2E, lifecycle MySQL 통합 테스트 |
| 계획 | immutable 계획 변경 이력과 감사 로그 | 구현 완료 | QA 완료 | plan audit API·DB 통합 테스트와 Plans 이력 E2E |
| 목표 | 성과지표, 목표/현재값, 필요/가용 시간, 근거, 의사결정 | 구현 완료 | QA 완료 | Goals 편집·결정 frontend/E2E |
| Today | 빠른 수집, 우선순위, Top 3, 이월, 완료·근거 | 구현 완료 | QA 완료 | desktop/mobile 브라우저 E2E |
| Planner | 주 이동, 시간 블록 생성·수정·삭제, 내부/외부 일정 충돌 방지 | 구현 완료 | QA 완료 | frontend tests, desktop/mobile E2E, MySQL trigger overlap guard |
| 실행 | 타이머 시작·중지와 실제/수동 시간, 실행 취소 | 구현 완료 | QA 완료 | frontend tests, desktop timer E2E |
| Review | 지표 갱신, 방해 요인, 다음 주 Top 3와 Planner 연결 | 구현 완료 | QA 완료 | frontend tests, 4단계 desktop E2E |
| 동기화 | local-first, 오프라인 편집, 재연결 저장 상태 | 구현 완료 | QA 완료 | offline browser E2E, 304 handshake 중 로컬 변경 회귀 시나리오와 provider tests |
| 충돌 | ETag/If-Match, 3-way 비교, local/server/선택 병합 | 구현 완료 | QA 완료 | API 412, frontend conflict tests, browser merge E2E |
| 계정 | 다중 사용자·tenant 격리 | 구현 완료 | QA 완료 | wrong issuer/audience/expiry와 cross-tenant MySQL 통합·reliability 검사 |
| 개인정보 | JSON export, 연동 해제, fresh-login 영구 삭제 | 구현 완료 | QA 완료 | export download와 계정 삭제 E2E; 미래/오래된 `auth_time` 거부 통합 테스트 |
| 초기화 | 현재 계획 서버 삭제 후 onboarding 복귀, 실패 시 로컬 보존 | 구현 완료 | QA 완료 | frontend reset 회귀 테스트 |

## Google Calendar와 알림

| 영역 | 기능 | 구현 상태 | QA 상태 | 근거 |
| --- | --- | --- | --- | --- |
| Calendar OAuth | 최소 scope, PKCE/state, offline refresh, revoke·재연결·해제 | 구현 완료 | QA 완료 | Spring tests와 격리된 fake-provider E2E |
| Calendar sync | 캘린더 선택, import/export, pagination, sync token, tombstone | 구현 완료 | QA 완료 | gateway/service tests와 fake-provider E2E |
| Calendar edge | recurrence-safe import, time zone, ETag 412, 410 full resync | 구현 완료 | QA 완료 | sync service tests, quota/retry reliability 검사 |
| Calendar worker | webhook 인증, channel 갱신, 중복 제거, DB lease, reconciliation | 구현 완료 | QA 완료 | worker/API tests와 replica-safe job 계약 |
| 실제 Google | 게시/검증된 OAuth 앱의 실제 계정·webhook·offline refresh | 외부 자격 증명 필요 | 외부 자격 증명 필요 | Google Cloud 프로젝트, 검증 도메인, client와 테스트 계정 필요 |
| 알림 | IANA time zone, quiet hours, Web Push·native 설정, 중복 방지 | 구현 완료 | QA 완료 | notification service 단위 테스트와 설정 E2E |
| 알림 실패 | 일시 오류 재시도, 영구 오류 device 비활성화, 성공 중복 방지 | 구현 완료 | QA 완료 | `NotificationServiceTest` 4개 시나리오 |
| 실제 전달 | VAPID, APNs/FCM foreground/background·tap route | 외부 자격 증명 필요 | 외부 자격 증명 필요 | VAPID/APNs/FCM credential, push adapter와 실기기 필요 |

## 웹·앱·접근성

| 영역 | 기능 | 구현 상태 | QA 상태 | 근거 |
| --- | --- | --- | --- | --- |
| Web/PWA | production build, manifest, service worker, 오프라인 shell | 구현 완료 | QA 완료 | TypeScript/Vite/PWA release 검사 |
| 반응형 | 1440×900 desktop, 390×844 mobile 주요 여정 | 구현 완료 | QA 완료 | 6개 route overflow와 사용자 흐름 E2E |
| 접근성 | skip link, 키보드 전체 주요 여정, modal focus trap·복귀, 오류 alert focus, label/focus, 44px touch target | 구현 완료 | QA 완료 | keyboard/모바일 자동 브라우저와 local K8s 네트워크 실패·복구 검사 |
| 확대·선호 | 200% browser zoom 등가 6개 route·핵심 modal, light-only OS 색상, reduced motion | 구현 완료 | QA 완료 | 720×450 modal/layout 및 browser preference E2E |
| Android | Capacitor sync, secure storage/deep link/push wiring, debug APK | 구현 완료 | QA 완료 | `cap sync`, `assembleDebug` |
| iOS | Capacitor sync, Keychain/deep link/push/privacy manifest wiring | 구현 완료 | QA 완료 | `cap sync`, 프로젝트·release workflow contract |
| 서명 앱 | Android AAB·iOS IPA 서명, 실기기·스토어 preflight | 외부 자격 증명 필요 | 외부 자격 증명 필요 | Apple/Play 계정, signing key, bundle/application ID와 실기기 필요 |
| 보조 기술 | VoiceOver/TalkBack 전체 여정 | 외부 자격 증명 필요 | 외부 자격 증명 필요 | iOS/Android 실기기와 수동 보조기술 점검 필요 |

## API·데이터·운영

| 영역 | 기능 | 구현 상태 | QA 상태 | 근거 |
| --- | --- | --- | --- | --- |
| Backend | Java 25, Spring MVC virtual threads, bounded Hikari pool | 구현 완료 | QA 완료 | Maven/Testcontainers와 reliability pool 측정 |
| API 보호 | JWT tenant, CORS, rate/body limit, security headers, safe Problem Details | 구현 완료 | QA 완료 | `PlannerApiIT`, HTTP E2E, production contracts |
| MySQL 8.4 | InnoDB 정규화 schema, Flyway V1–V8, revision/idempotency/audit | 구현 완료 | QA 완료 | Testcontainers, migration restart/checksum, HTTP E2E |
| DB 의존성 계약 | production 코드·설정·Docker·Kubernetes·테스트·CI의 PostgreSQL runtime 의존성 부재 | 구현 완료 | QA 완료 | `npm run verify:mysql-contract`이 MySQL driver/UTC/utf8mb4/InnoDB/lock/retry/backup 계약과 금지 패턴 검사 |
| 복구·이관 | mysqldump/restore drill, PostgreSQL one-time import와 runbook | 구현 완료 | QA 완료 | 0-row-loss restore, table count와 planner fingerprint 대조 |
| 보존 | operational row retention과 사용자 cascade deletion | 구현 완료 | QA 완료 | scheduler contract와 account integration test |
| Compose | frontend → nginx → API → MySQL 저장·재조회 | 구현 완료 | QA 완료 | 격리 Compose browser/API E2E |
| Kubernetes | 2 replicas, probes, HPA, PDB, topology spread, NetworkPolicy | 구현 완료 | QA 완료 | manifest 검사와 local Kubernetes runtime 동시성 |
| Scale-out | stateless API, DB lease, same-ETag 경쟁, failover | 구현 완료 | QA 완료 | local K8s 두 Pod와 reliability 검사 |
| Observability | structured logs, trace correlation, RED/business metrics, alerts | 구현 완료 | QA 완료 | production K8s/contract 검사 |
| 공급망 | dependency audit, CodeQL/Trivy workflow, SBOM, cosign 계약 | 구현 완료 | QA 완료 | production contracts와 `npm audit` |
| secret scan | 추적 파일의 private key와 주요 provider token signature 검사 | 구현 완료 | QA 완료 | `npm run verify:secrets` |
| 실제 staging | 공개 domain/TLS, HA DB/PITR, alert delivery, rollback | 외부 자격 증명 필요 | 외부 자격 증명 필요 | cloud·DNS·Secret Manager·on-call channel 필요 |

## 이번 결함 수정

| 결함 | 사용자 위험 | 수정·회귀 방지 |
| --- | --- | --- |
| 신규 계정에 샘플 목표·기록을 생성하고 서버에 저장할 수 있었음 | 허위 개인 데이터와 잘못된 분석 | 빈 snapshot + onboarding 전용 route, 신규 사용자 테스트·E2E |
| 계획 초기화가 샘플 데이터로 되돌아가고 서버 삭제와 분리됨 | 삭제했다고 믿은 데이터가 서버에 남음 | revision 조건부 API DELETE, 412 1회 재시도, 성공 전 로컬 보존 |
| 미래 `auth_time`이 절댓값 계산으로 fresh-login 검사를 통과함 | 조작된 토큰의 계정 삭제 허용 가능성 | 미래 30초 초과와 15분 경과를 각각 거부하는 통합 테스트 |
| 알림 gateway 실패 분류의 회귀 테스트가 없음 | 일시 장애에서 device 영구 비활성화 가능 | transient/permanent/success/빈 device 4개 단위 테스트 |
| 저장 debounce를 기다리지 않던 E2E | 실제 server persistence 누락을 통과로 오인 | 모든 변경 뒤 `서버에 저장됨`과 PUT 성공을 확인 |
| 서버 304 확인 중 수정하면 로컬 변경을 저장 완료로 오인 | 화면에는 바뀌었지만 서버 PUT이 생략될 수 있음 | handshake 중 변경을 dirty로 유지하고 응답 종료 후 후속 동기화; 운영 E2E가 실제 PUT을 확인 |
| `autoFocus` 자식이 있는 modal에서 닫은 뒤 trigger focus 유실 | 키보드 사용자가 문서 처음부터 다시 탐색 | modal render 시 trigger를 보존하고 unit/E2E에서 Escape 후 복귀 검증 |
| 설정의 법률 링크 터치 높이가 16px | 모바일 오탭과 접근성 저하 | 링크 hit area 44px, 대상 이름을 출력하는 자동 검사 |

## QA 실행 기록

전체 연속 검증의 최종 실행 결과는 `GATES.md`에 명령·종료 코드·측정값으로 남깁니다. 핵심 명령은 다음과 같습니다.

```bash
npm run verify:production
npm run verify:production:e2e
npm run verify:production:reliability
npm run verify:k8s:runtime
npm run verify:secrets
git diff --check
npm audit --audit-level=moderate
```

## 외부 승인에 필요한 최소 입력

1. 공개 staging domain과 DNS/TLS 제어권, Kubernetes context, Secret Manager 쓰기 권한, HA MySQL 8.4 접속 정보
2. OIDC issuer/client/audience, 등록된 web/native redirect URI, 운영 테스트 계정
3. Google Cloud OAuth client ID/secret, 검증된 redirect domain, Calendar API·동의 화면 권한, 테스트 계정
4. VAPID 공개/개인 키, APNs/FCM adapter endpoint와 credential
5. Apple Developer/Google Play 계정, signing identity/keystore, 실제 bundle/application ID, iOS·Android 실기기
6. 운영 개인정보 담당 연락처·보관기간·약관에 대한 법률 승인

이 값은 Git에 커밋하지 않고 CI environment/Secret Manager에만 입력합니다.
