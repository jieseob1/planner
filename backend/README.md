# Nowline backend

Nowline 프론트엔드의 `PlannerSnapshot` 전체를 PostgreSQL에 보관하는 Java 25 / Spring Boot 4.1.1 API입니다. 애플리케이션 Pod에는 사용자 상태가 없으며, 여러 Pod가 떠도 PostgreSQL의 사용자별 transaction advisory lock과 aggregate revision으로 쓰기 순서를 보장합니다.

> `X-Nowline-User-Id`는 로컬 개발용 신뢰 헤더입니다. 인증, 권한 확인, 토큰 검증이 아니므로 외부에 공개하면 안 됩니다. 운영 전에는 OIDC/JWT 인증으로 서버가 user id를 결정하도록 교체해야 합니다.

## 기술 구성

- Java 25, Spring MVC, Tomcat virtual threads
- PostgreSQL, Spring JDBC, Flyway
- HikariCP: Pod당 기본 최대 10 connection
- RFC Problem Details (`application/problem+json`)
- 웹 개발 서버와 Capacitor origin을 위한 제한된 CORS 설정
- Actuator liveness/readiness, Prometheus
- Testcontainers PostgreSQL 통합 테스트

가상 스레드는 동시 HTTP 요청의 플랫폼 스레드 비용을 줄이지만, DB 처리량을 늘려 주지는 않습니다. 그래서 `spring.threads.virtual.enabled=true`와 별개로 Hikari pool을 명시적으로 제한합니다. 총 DB 연결 상한은 대략 `backend replica 수 × NOWLINE_DB_POOL_MAX + 운영 여유분`으로 계산해야 합니다.

## 로컬 실행

필수 조건은 Java 25와 PostgreSQL 17 이상입니다. 저장소 루트의 Compose/Kubernetes 구성을 쓰지 않고 백엔드만 실행하려면 먼저 DB를 준비합니다.

```bash
export NOWLINE_DB_URL=jdbc:postgresql://localhost:5432/nowline
export NOWLINE_DB_USER=nowline
export NOWLINE_DB_PASSWORD=nowline
./mvnw spring-boot:run
```

시작 시 Flyway가 `V1__create_planner_schema.sql`을 적용합니다. `btree_gist` extension을 만들 권한이 필요합니다. 기본 포트는 `8080`입니다.

```bash
curl -fsS http://localhost:8080/actuator/health/liveness
curl -fsS http://localhost:8080/actuator/health/readiness
curl -fsS http://localhost:8080/actuator/prometheus
```

## API 사용

모든 planner 요청에 로컬 사용자 UUID를 보냅니다. PUT/DELETE에는 재시도 안전성을 위해 `Idempotency-Key`가 필수입니다. 생성과 수정의 조건 헤더를 섞어 보내면 400입니다.

```bash
USER_ID=11111111-1111-4111-8111-111111111111

# 최초 생성: 다른 snapshot이 없을 때만 revision 1로 저장
curl -i -X PUT http://localhost:8080/api/v1/planner \
  -H "X-Nowline-User-Id: ${USER_ID}" \
  -H 'Idempotency-Key: create-2026-08-31-1' \
  -H 'If-None-Match: *' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/planner-snapshot.json

# 조회: 200 + ETag: "1" + { revision, snapshot }
curl -i http://localhost:8080/api/v1/planner \
  -H "X-Nowline-User-Id: ${USER_ID}"

# cache revalidation: revision이 같으면 body 없는 304
curl -i http://localhost:8080/api/v1/planner \
  -H "X-Nowline-User-Id: ${USER_ID}" \
  -H 'If-None-Match: "1"'

# 수정: 직전 ETag와 일치할 때 revision을 2로 증가
curl -i -X PUT http://localhost:8080/api/v1/planner \
  -H "X-Nowline-User-Id: ${USER_ID}" \
  -H 'Idempotency-Key: update-2026-08-31-1' \
  -H 'If-Match: "1"' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/planner-snapshot.json

# 삭제: 해당 사용자의 현재 revision만 조건부 삭제
curl -i -X DELETE http://localhost:8080/api/v1/planner \
  -H "X-Nowline-User-Id: ${USER_ID}" \
  -H 'Idempotency-Key: delete-2026-08-31-1' \
  -H 'If-Match: "2"'
```

GET/PUT 응답은 다음 envelope입니다.

```json
{
  "revision": 1,
  "snapshot": {
    "version": 1
  }
}
```

주요 실패 응답은 모두 RFC Problem Details입니다.

| HTTP | code | 의미 |
| --- | --- | --- |
| 400 | `validation-failed`, `invalid-planner-snapshot` | 필드, 참조 관계, 중복 ID, 시간 범위 또는 겹침 오류 |
| 400 | `invalid-precondition`, `invalid-request-header` | ETag 또는 로컬 사용자 헤더 오류 |
| 404 | `planner-not-found` | 해당 사용자 snapshot 없음 |
| 409 | `idempotency-key-reused` | 같은 key를 다른 payload/조건에 재사용 |
| 409 | `planner-integrity-conflict` | DB 관계/시간 겹침 constraint 충돌 |
| 412 | `revision-conflict` | If-Match가 현재 revision과 다르거나 생성 대상이 이미 존재 |
| 428 | `precondition-required` | 쓰기 조건 헤더 누락 |

같은 사용자·operation·Idempotency-Key로 같은 요청을 다시 보내면 최초 PUT 응답 또는 DELETE 204를 재생합니다. key 보존 기간은 현재 무기한이므로 운영에서는 백업/재시도 기간보다 충분히 긴 보존 정책과 정리 job을 별도로 정해야 합니다.

## 데이터와 동시성

- `planner_aggregate`: 사용자별 revision, 연/분기 계획, 회고 scalar
- `planner_revision_clock`: 삭제 후 재생성해도 revision을 되돌리지 않는 사용자별 영구 clock
- `planner_outcome`, `planner_task`: 목표와 할 일, 입력 순서 보존
- `planner_time_block`: 주/요일/분 단위 계획; PostgreSQL exclusion constraint로 동시 요청까지 겹침 방지
- `planner_time_entry`, `planner_timer`: 실제 실행 기록과 진행 중 타이머
- `planner_review_top_task`: 순서가 있는 최대 3개 다음 주 핵심 할 일
- `planner_idempotency`: 요청 hash와 최초 응답 재생 데이터

PUT은 단일 transaction에서 기존 children을 삭제하고 새 snapshot을 다시 구성합니다. aggregate update에는 `WHERE revision = ?`가 포함됩니다. DELETE도 revision을 한 번 소비하고 영구 clock을 남기므로, 삭제 전의 오래된 ETag가 재생성된 aggregate에 우연히 일치하는 ABA 문제를 막습니다. 사용자별 advisory lock은 서로 다른 backend replica의 생성/수정/삭제도 직렬화합니다. GET은 repeatable-read transaction에서 조립하므로 교체 중간 상태를 읽지 않습니다.

## 테스트와 패키징

```bash
# 단위 테스트 7개
./mvnw test

# 단위 + 실제 PostgreSQL 통합 테스트 + 실행 JAR
./mvnw verify
```

통합 테스트는 생성, idempotent replay, 조회/304, optimistic conflict, 수정, 삭제, 사용자 격리, payload 겹침 검증, DB exclusion constraint, health/Prometheus, Hikari 상한을 확인합니다. macOS에서 OrbStack socket이 있으면 Maven의 `orbstack-testcontainers` profile이 자동 활성화됩니다. 다른 환경에서는 표준 `DOCKER_HOST`를 Testcontainers가 사용합니다.

Docker build는 네트워크가 불안정한 로컬 Kubernetes 환경에서도 재현 가능하도록, Maven Central에 접근하지 않고 host에서 만든 JAR만 복사합니다.

```bash
./mvnw -q package -DskipTests
docker build -t nowline-backend:local .
docker run --rm -p 8080:8080 \
  -e NOWLINE_DB_URL=jdbc:postgresql://host.docker.internal:5432/nowline \
  -e NOWLINE_DB_USER=nowline \
  -e NOWLINE_DB_PASSWORD=nowline \
  nowline-backend:local
```

runtime image는 Java 25 JRE를 사용하며 UID/GID `10001` 비루트 사용자로 실행합니다.

직접 API를 호출하는 앱 origin은 `NOWLINE_CORS_ALLOWED_ORIGIN_PATTERNS`의 쉼표 구분 목록으로 제한합니다. 기본값은 임의 포트의 `localhost`/`127.0.0.1`과 `capacitor://localhost`/`ionic://localhost`만 포함합니다. 운영에서는 실제 앱/웹 origin만 남기고 이 값을 명시적으로 설정해야 합니다.

## 운영 전 필수 보완

- `X-Nowline-User-Id` 제거 후 인증 주체에서 user id를 주입하고 사용자별 접근 제어 테스트 추가
- TLS, secret manager, network policy, DB backup/PITR 적용
- replica 수와 PostgreSQL `max_connections`에 맞춰 `NOWLINE_DB_POOL_MAX` 조정
- idempotency row 보존/정리 정책, request size limit, rate limit 확정
- aggregate 최대 크기와 PUT latency를 관측한 뒤 필요하면 부분 변경 API로 분리
