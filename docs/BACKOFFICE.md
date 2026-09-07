# 운영 백오피스

`/admin`은 Goals to Today 운영 현황을 읽는 관리자 화면입니다. Grafana는 `/ops/grafana/` 링크로 엽니다. 계정이나 작업을 변경·삭제·재시도하는 기능은 없습니다.

## 접근 권한

Keycloak의 `nowline-admin` **realm role**이 있는 사용자만 `/api/v1/admin/**`의 운영 데이터 조회 API를 호출할 수 있습니다. 서버의 기존 OAuth2 Resource Server가 JWT 서명, issuer, audience, 만료를 검증한 뒤 `AdminAccess`가 인증된 `JwtAuthenticationToken`의 `realm_access.roles`를 확인합니다. 최상위 `roles`, client role, 이메일 일치, 클라이언트 화면의 문자열은 권한을 부여하지 않습니다. 누락·잘못된 타입·혼합 타입 역할 목록은 거부합니다.

메뉴 표시 여부를 확인하는 `/api/v1/admin/access`만 로그인한 모든 계정에 200으로 응답합니다. 응답은 관리자에게 `{allowed:true}`, 일반 사용자에게 `{allowed:false}`이며 운영 데이터는 포함하지 않습니다. 익명·유효하지 않은 토큰은 이 경로에서도 401이고, 나머지 운영 데이터 경로는 일반 사용자에게 계속 403입니다. 정상적인 일반 사용자 메뉴 확인이 브라우저 오류로 기록되지 않도록 discovery 메서드에만 인증 검사 재정의를 적용합니다.

운영자가 지정한 기존 계정의 정확한 Keycloak identity에 역할을 부여하는 작업은 별도입니다. 이 코드가 이메일 일치만으로 역할을 자동 부여하지 않습니다. 서버에서 `node scripts/configure-product-identity.mjs --apply --admin-email <관리자 이메일>`을 실행하면 정확히 하나의 활성 계정을 확인한 뒤 역할을 부여합니다. 실제 이메일은 저장소에 기록하지 마세요. 역할 변경 후 기존 액세스 토큰은 만료 전까지 이전 권한을 유지할 수 있으므로 새로 로그인하여 토큰을 갱신합니다.

프런트엔드 `useAdminAccess()`는 서버 `/access` 응답을 확인해 메뉴를 표시하는 보조 수단입니다. 각 데이터 API는 독립적으로 서버 권한을 검사합니다. 계정 변경·화면 전환 시 이전 요청을 취소하고, 늦게 도착한 응답은 버립니다. 401/403 응답에서는 운영 데이터를 표시하지 않습니다.

권한 모델은 [Spring Security method security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)와 기존 [JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) 검증 경로를 사용합니다.

## 데이터 범위

| API (GET) | 응답 |
| --- | --- |
| `/api/v1/admin/access` | 로그인한 관리자 200 `{allowed:true}`, 일반 사용자 200 `{allowed:false}`; 익명·유효하지 않은 토큰 401 |
| `/api/v1/admin/overview` | 계정, 최근 7일 활동 계정, 활성 계획, 캘린더 연결·오류, 대기·실행·재시도·최종 실패 작업, 실패 알림, 최근 24시간 감사 기록 건수 |
| `/api/v1/admin/users` | 삭제되지 않은 계정의 ID, 마스킹 이메일, 가입·최근 활동 시각, 탈퇴 요청 여부, 플랜·이용권·캘린더 상태 |
| `/api/v1/admin/sync-failures` | `ERROR` 또는 `REAUTHORIZE` 연결의 계정 ID, 상태, 허용 목록에 있는 오류 코드, 최근 완료·변경 시각 |
| `/api/v1/admin/job-failures` | `DEAD`, 또는 시도 횟수가 1 이상인 `PENDING` 작업의 ID, 계정 ID, 종류, 상태, 시도 횟수, 실행 가능·변경 시각 |
| `/api/v1/admin/audit` | 삭제되지 않은 계정의 감사 이벤트 ID, 계정 ID, 동작 코드, 리비전, 발생 시각 |

목록의 `page`는 0–200, `size`는 1–50이며 기본값은 0/20입니다. 범위를 벗어나거나 숫자가 아니면 400을 반환합니다. `items`, `page`, `size`, `hasNext`, `limited`로 응답하며 한 행을 추가 조회해서 다음 페이지 유무를 결정합니다. 최대 페이지에서 추가 행이 있으면 `hasNext:false, limited:true`입니다. 마지막 시각 내림차순과 고유 ID 오름차순으로 정렬합니다. 조회 중 원본이 변경되면 페이지 간 결과도 달라질 수 있습니다.

데이터는 현재 DB 상태이며 과거 장애 발생 건수의 누계가 아닙니다. 예를 들어 성공한 재시도 작업은 실패 목록에서 빠집니다. `last_seen_at`은 기존 애플리케이션의 계정 활동 기록으로, 로그인 횟수나 웹 분석 세션 수를 의미하지 않습니다. 캘린더 연결 수는 저장된 연결 행 수이며 Google 인증의 실시간 유효성을 검증한 수치는 아닙니다. 알림 실패는 `FAILED` 상태만 집계하며 개별 알림 본문은 표시하지 않습니다. 감사 기록은 기존 플래너 변경 메타데이터이며 관리자 조회 이력은 아닙니다.

플래너 제목·본문·스냅샷, 일정 제목, Google 계정 이메일·캘린더 식별자·토큰, 작업 payload·중복 키·원본 오류, 알림 본문, 감사 details, OIDC subject/issuer, 결제 공급자 식별자는 응답하지 않습니다. 알려지지 않은 캘린더 오류 코드는 `OTHER`로 표시합니다. 모든 조회 응답은 `Cache-Control: no-store`이며 브라우저 요청도 저장을 금지합니다.

현재 쿼리는 소규모 운영 DB를 위한 제한된 조회입니다. 전역 통계와 최근 감사 목록은 데이터 증가에 따라 비용이 늘어날 수 있습니다. 정렬용 전역 인덱스나 집계 저장소가 필요한지는 실제 지연·DB 부하로 판단하며, 이 기능은 스키마를 변경하지 않습니다.

## 연결 및 검증

`AdminScreen`은 `src/admin/AdminScreen.tsx`의 named export입니다. `AuthProvider` 및 Router 내부에 렌더링합니다. 화면은 자체 헤더와 반응형 카드 목록을 제공하며 서버 접근 확인, 로딩, 빈 결과, 오류 재시도, 권한 없음, 페이지 이동을 처리합니다. 상위 앱은 `/admin` 경로와 `useAdminAccess().status === 'allowed'` 메뉴를 연결합니다.

```sh
rtk node scripts/verify-admin.mjs
```

필요 환경: Java 25, Node/npm, `rtk`, Docker/Testcontainers. 검증은 프런트엔드 동작 테스트, TypeScript 검사, 역할 단위 테스트, 모든 Flyway 마이그레이션을 적용한 별도 MySQL 8.4 컨테이너의 실제 HTTP 테스트를 실행합니다. JWT는 테스트 전용 비밀로 서명하며 운영 자격 증명을 쓰지 않습니다. 서명 위조, issuer/audience 불일치, 만료, 잘못된 역할, 익명/일반 사용자, 관리자 조회, 페이지 범위, 민감 데이터 누출, 변경 메서드 거부를 확인합니다. 당일 실행한 테스트 보고서에 실패·오류·skip이 모두 0이어야 성공 메시지를 출력합니다.

이 검증은 운영 Keycloak 역할 부여, 실제 배포, Grafana 접근, 브라우저 통합 화면의 성공을 대신하지 않습니다. 해당 항목은 배포 통합 단계에서 별도로 확인합니다.
