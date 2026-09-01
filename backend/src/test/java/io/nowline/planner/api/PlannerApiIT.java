package io.nowline.planner.api;

import com.zaxxer.hikari.HikariDataSource;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.config.DatabaseWriteExecutor;
import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.integration.calendar.CalendarIntegrationRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static io.nowline.planner.persistence.JdbcValues.id;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlannerApiIT {

    private static final String TEST_ISSUER = "https://identity.test.nowline.local";
    private static final String TEST_AUDIENCE = "nowline-api";
    private static final String TEST_SECRET = "nowline-integration-test-secret-key-32-bytes-minimum";

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4.10")
            .withDatabaseName("nowline")
            .withUsername("nowline")
            .withPassword("nowline")
            .withCommand(
                    "--character-set-server=utf8mb4",
                    "--collation-server=utf8mb4_0900_as_ci",
                    "--default-time-zone=+00:00",
                    "--log-bin-trust-function-creators=1");

    @DynamicPropertySource
    static void mysqlProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("nowline.security.issuer", () -> TEST_ISSUER);
        registry.add("nowline.security.audience", () -> TEST_AUDIENCE);
        registry.add("nowline.security.hmac-secret", () -> TEST_SECRET);
        registry.add("nowline.workers.enabled", () -> "false");
        registry.add("nowline.security.consent-required", () -> "false");
    }

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    Environment environment;

    @Autowired
    DataSource dataSource;

    @Autowired
    CalendarIntegrationRepository calendarJobs;

    @Autowired
    DatabaseWriteExecutor databaseWrites;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @Test
    void createReadReplayUpdateConflictDeleteAndUserIsolation() throws Exception {
        String userToken = token("user-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        String otherUserToken = token("user-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        PlannerSnapshot initial = PlannerFixtures.snapshot();

        HttpResponse<String> created = put(userToken, "create-1", null, "*", initial);
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.headers().firstValue("ETag")).contains("\"1\"");
        PlannerEnvelope createdEnvelope = objectMapper.readValue(created.body(), PlannerEnvelope.class);
        assertThat(createdEnvelope.revision()).isEqualTo(1);
        assertThat(createdEnvelope.snapshot().timeBlocks().getFirst().weekOffset()).isZero();

        HttpResponse<String> replay = put(userToken, "create-1", null, "*", initial);
        assertThat(replay.statusCode()).isEqualTo(201);
        assertThat(replay.body()).isEqualTo(created.body());

        HttpResponse<String> read = get(userToken, null);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(read.headers().firstValue("ETag")).contains("\"1\"");
        assertThat(objectMapper.readValue(read.body(), PlannerEnvelope.class).snapshot().tasks())
                .extracting(PlannerSnapshot.Task::id)
                .containsExactly("task-draft", "task-invoice");

        HttpResponse<String> notModified = get(userToken, "W/\"1\"");
        assertThat(notModified.statusCode()).isEqualTo(304);
        assertThat(notModified.body()).isEmpty();

        PlannerSnapshot changed = PlannerFixtures.withDirection(initial, "수정된 연간 방향");
        HttpResponse<String> updated = put(userToken, "update-1", "\"1\"", null, changed);
        assertThat(updated.statusCode()).isEqualTo(200);
        assertThat(updated.headers().firstValue("ETag")).contains("\"2\"");
        assertThat(objectMapper.readValue(updated.body(), PlannerEnvelope.class).revision()).isEqualTo(2);

        HttpResponse<String> stale = put(userToken, "stale-1", "\"1\"", null, changed);
        assertProblem(stale, 412, "revision-conflict");

        HttpResponse<String> reusedKey = put(
                userToken,
                "update-1",
                "\"1\"",
                null,
                PlannerFixtures.withDirection(initial, "다른 내용"));
        assertProblem(reusedKey, 409, "idempotency-key-reused");

        assertProblem(get(otherUserToken, null), 404, "planner-not-found");

        HttpResponse<String> deleted = delete(userToken, "delete-1", "\"2\"");
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(delete(userToken, "delete-1", "\"2\"").statusCode()).isEqualTo(204);
        assertProblem(get(userToken, null), 404, "planner-not-found");

        HttpResponse<String> recreated = put(userToken, "create-2", null, "*", initial);
        assertThat(recreated.statusCode()).isEqualTo(201);
        assertThat(recreated.headers().firstValue("ETag")).contains("\"4\"");
        assertProblem(put(userToken, "old-generation", "\"2\"", null, changed), 412, "revision-conflict");
    }

    @Test
    void rejectsCrossObjectValidationAndDatabaseOverlap() throws Exception {
        String rejectedUser = token("rejected-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        HttpResponse<String> rejected = put(
                rejectedUser,
                "invalid-overlap",
                null,
                "*",
                PlannerFixtures.withOverlappingBlock(PlannerFixtures.snapshot()));
        assertProblem(rejected, 400, "invalid-planner-snapshot");
        assertProblem(get(rejectedUser, null), 404, "planner-not-found");

        String constrainedSubject = "constrained-" + UUID.randomUUID();
        String constrainedToken = token(constrainedSubject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        assertThat(put(constrainedToken, "valid-create", null, "*", PlannerFixtures.snapshot()).statusCode())
                .isEqualTo(201);
        UUID constrainedUser = jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                UUID.class,
                TEST_ISSUER,
                constrainedSubject);

        assertThatThrownBy(() -> jdbc.update("""
                        INSERT INTO planner_time_block (
                            user_id, block_id, sort_order, task_id, title, day_key,
                            start_minutes, duration_minutes, external, week_offset
                        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, false, ?)
                        """, id(constrainedUser), "direct-overlap", 99, "DB overlap", "tue", 1_200, 30, 0))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void managesMultiplePlanLifecycleWithTenantIsolationAndAudit() throws Exception {
        String ownerToken = token("plans-owner-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        String otherToken = token("plans-other-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        PlannerSnapshot initial = PlannerFixtures.snapshot();
        assertThat(put(ownerToken, "plan-bootstrap", null, "*", initial).statusCode()).isEqualTo(201);

        HttpResponse<String> initialPlans = authenticatedGet("/api/v1/plans", ownerToken);
        assertThat(initialPlans.statusCode()).isEqualTo(200);
        assertThat(initialPlans.body()).contains("\"status\":\"ACTIVE\"");

        UUID secondPlanId = UUID.randomUUID();
        PlannerSnapshot secondSnapshot = PlannerFixtures.withDirection(initial, "두 번째 연간 계획");
        HttpResponse<String> created = jsonRequest(
                "PUT",
                "/api/v1/plans/" + secondPlanId,
                ownerToken,
                objectMapper.writeValueAsString(java.util.Map.of(
                        "title", "2027년 성장 계획",
                        "snapshot", secondSnapshot)));
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.body()).contains("\"status\":\"DRAFT\"");
        assertThat(authenticatedGet("/api/v1/plans/" + secondPlanId, otherToken).statusCode()).isEqualTo(404);

        HttpResponse<String> activated = jsonRequest(
                "POST", "/api/v1/plans/" + secondPlanId + "/activate", ownerToken, null);
        assertThat(activated.statusCode()).isEqualTo(200);
        assertThat(activated.body()).contains("\"status\":\"ACTIVE\"");
        HttpResponse<String> activePlanner = get(ownerToken, null);
        assertThat(activePlanner.statusCode()).isEqualTo(200);
        assertThat(activePlanner.body()).contains("두 번째 연간 계획", "\"revision\":2");

        HttpResponse<String> listed = authenticatedGet("/api/v1/plans", ownerToken);
        assertThat(listed.body()).contains("\"status\":\"ACTIVE\"", "\"status\":\"CLOSED\"");
        HttpResponse<String> audit = authenticatedGet("/api/v1/plans/" + secondPlanId + "/audit", ownerToken);
        assertThat(audit.statusCode()).isEqualTo(200);
        assertThat(audit.body()).contains("PLAN_CREATED", "PLAN_ACTIVATED_SNAPSHOT_LOADED");

        HttpResponse<String> archived = jsonRequest(
                "POST", "/api/v1/plans/" + secondPlanId + "/archive", ownerToken, null);
        assertThat(archived.statusCode()).isEqualTo(200);
        assertThat(archived.body()).contains("\"status\":\"ARCHIVED\"");
        assertProblem(get(ownerToken, null), 404, "planner-not-found");

        HttpResponse<String> restored = jsonRequest(
                "POST", "/api/v1/plans/" + secondPlanId + "/restore", ownerToken, null);
        assertThat(restored.statusCode()).isEqualTo(200);
        assertThat(restored.body()).contains("\"status\":\"DRAFT\"");
        assertThat(jsonRequest("POST", "/api/v1/plans/" + secondPlanId + "/activate", ownerToken, null).statusCode())
                .isEqualTo(200);
        assertThat(get(ownerToken, null).body()).contains("\"revision\":4", "두 번째 연간 계획");
    }

    @Test
    void exposesProductionHealthMetricsAndBoundedPoolConfiguration() throws Exception {
        HttpResponse<String> readiness = rawGet("/actuator/health/readiness");
        assertThat(readiness.statusCode()).isEqualTo(200);
        assertThat(readiness.body()).contains("UP");
        String metricsToken = token("metrics-reader", TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        assertThat(authenticatedGet("/actuator/prometheus", metricsToken).statusCode()).isEqualTo(200);
        assertThat(environment.getProperty("spring.threads.virtual.enabled", Boolean.class)).isTrue();
        assertThat(dataSource.unwrap(HikariDataSource.class).getMaximumPoolSize()).isEqualTo(10);
    }

    @Test
    void returnsRfcProblemsForMissingConditionsInvalidAuthenticationAndBeanValidation() throws Exception {
        String userToken = token("validation-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        HttpRequest missingCondition = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Authorization", "Bearer " + userToken)
                .header(PlannerController.IDEMPOTENCY_HEADER, "missing-condition")
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .PUT(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(PlannerFixtures.snapshot())))
                .build();
        assertProblem(send(missingCondition), 428, "precondition-required");

        assertProblem(put(
                userToken,
                "invalid-target",
                null,
                "*",
                PlannerFixtures.withInvalidTarget(PlannerFixtures.snapshot())), 400, "validation-failed");

        assertThat(rawGet("/api/v1/planner").statusCode()).isEqualTo(401);

        HttpRequest legacyHeaderOnly = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("X-Nowline-User-Id", UUID.randomUUID().toString())
                .GET().build();
        assertThat(send(legacyHeaderOnly).statusCode()).isEqualTo(401);

        String wrongIssuer = token("wrong-issuer", "https://attacker.invalid", List.of(TEST_AUDIENCE), 900);
        assertThat(get(wrongIssuer, null).statusCode()).isEqualTo(401);

        String wrongAudience = token("wrong-audience", TEST_ISSUER, List.of("other-api"), 900);
        assertThat(get(wrongAudience, null).statusCode()).isEqualTo(401);

        String expired = token("expired", TEST_ISSUER, List.of(TEST_AUDIENCE), -60);
        assertThat(get(expired, null).statusCode()).isEqualTo(401);
    }

    @Test
    void allowsConfiguredNativeAndDynamicLocalWebPreflights() throws Exception {
        assertAllowedPreflight("capacitor://localhost");
        assertAllowedPreflight("http://127.0.0.1:4189");
    }

    @Test
    void recordsTheCurrentTermsAndPrivacyConsentVersion() throws Exception {
        String accessToken = token(
                "consent-" + UUID.randomUUID(),
                TEST_ISSUER,
                List.of(TEST_AUDIENCE),
                900
        );

        HttpResponse<String> initial = authenticatedGet("/api/v1/account/consent", accessToken);
        assertThat(initial.statusCode()).isEqualTo(200);
        assertThat(initial.body()).contains("\"accepted\":false", "\"policyVersion\":\"2026-09-01\"");

        HttpResponse<String> invalid = jsonRequest(
                "PUT",
                "/api/v1/account/consent",
                accessToken,
                "{\"termsAccepted\":true,\"privacyAccepted\":false}"
        );
        assertProblem(invalid, 400, "validation-failed");

        HttpResponse<String> accepted = jsonRequest(
                "PUT",
                "/api/v1/account/consent",
                accessToken,
                "{\"termsAccepted\":true,\"privacyAccepted\":true}"
        );
        assertThat(accepted.statusCode()).isEqualTo(200);
        assertThat(accepted.body()).contains("\"accepted\":true", "\"policyVersion\":\"2026-09-01\"");
        assertThat(authenticatedGet("/api/v1/account/consent", accessToken).body())
                .contains("\"accepted\":true");
    }

    @Test
    void provisionsAnIsolatedFreeBetaEntitlementForEachAuthenticatedUser() throws Exception {
        String firstSubject = "beta-first-" + UUID.randomUUID();
        String secondSubject = "beta-second-" + UUID.randomUUID();
        String firstToken = token(firstSubject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        String secondToken = token(secondSubject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);

        HttpResponse<String> first = authenticatedGet("/api/v1/account/entitlement", firstToken);
        HttpResponse<String> second = authenticatedGet("/api/v1/account/entitlement", secondToken);

        assertThat(first.statusCode()).isEqualTo(200);
        assertThat(second.statusCode()).isEqualTo(200);
        assertThat(first.body()).contains("\"plan\":\"BETA\"", "\"status\":\"ACTIVE\"", "\"paid\":false");
        assertThat(second.body()).contains("\"plan\":\"BETA\"", "\"status\":\"ACTIVE\"", "\"paid\":false");
        assertThat(jdbc.queryForObject("""
                        SELECT count(*) FROM account_entitlement entitlement
                        JOIN app_user app ON app.user_id = entitlement.user_id
                        WHERE app.oidc_subject IN (?, ?)
                        """, Long.class, firstSubject, secondSubject)).isEqualTo(2);
    }

    @Test
    void exportsPreferencesAndDeletesAllAccountDataAfterFreshAuthentication() throws Exception {
        String subject = "privacy-" + UUID.randomUUID();
        String accessToken = token(subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        assertThat(put(accessToken, "privacy-create", null, "*", PlannerFixtures.snapshot()).statusCode())
                .isEqualTo(201);
        UUID userId = jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                UUID.class, TEST_ISSUER, subject);

        HttpResponse<String> preferences = jsonRequest("PUT", "/api/v1/account/preferences", accessToken,
                """
                {"timezone":"Asia/Seoul","locale":"ko-KR","dailyReminderEnabled":true,
                 "dailyReminderTime":"08:30:00","blockReminderMinutes":15}
                """);
        assertThat(preferences.statusCode()).isEqualTo(200);
        assertThat(preferences.body()).contains("Asia/Seoul", "08:30:00");

        HttpResponse<String> exported = authenticatedGet("/api/v1/account/export", accessToken);
        assertThat(exported.statusCode()).isEqualTo(200);
        assertThat(exported.headers().firstValue("Content-Disposition")).hasValueSatisfying(
                value -> assertThat(value).contains("goals-to-today-account-export.json"));
        assertThat(exported.body()).contains("nowline-account-export-v1", subject, "기술 글 6개 발행", "entitlement", "BETA");

        assertProblem(jsonRequest("DELETE", "/api/v1/account", accessToken,
                "{\"confirmation\":\"wrong\"}"), 400, "invalid-planner-snapshot");

        String futureAuthentication = token(
                subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900, Instant.now().plusSeconds(120));
        assertProblem(jsonRequest("DELETE", "/api/v1/account", futureAuthentication,
                "{\"confirmation\":\"DELETE\"}"), 401, "reauthentication-required");

        String staleAuthentication = token(
                subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900, Instant.now().minus(Duration.ofMinutes(16)));
        assertProblem(jsonRequest("DELETE", "/api/v1/account", staleAuthentication,
                "{\"confirmation\":\"DELETE\"}"), 401, "reauthentication-required");

        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE oidc_subject = ?", Long.class, subject))
                .isOne();
        assertThat(jsonRequest("DELETE", "/api/v1/account", accessToken,
                "{\"confirmation\":\"DELETE\"}").statusCode()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE oidc_subject = ?", Long.class, subject))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_aggregate WHERE user_id = ?", Long.class, userId))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_entitlement WHERE user_id = ?", Long.class, userId))
                .isZero();
    }

    @Test
    void claimsOneMySqlJobAcrossVirtualThreadsAndRetriesTransientDeadlocks() throws Exception {
        String subject = "mysql-concurrency-" + UUID.randomUUID();
        String token = token(subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        assertThat(put(token, "mysql-concurrency-create", null, "*", PlannerFixtures.snapshot()).statusCode())
                .isEqualTo(201);
        UUID userId = UUID.fromString(jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                String.class,
                TEST_ISSUER,
                subject));
        calendarJobs.enqueue(userId, "MYSQL_CONCURRENCY_TEST", "single-claim");

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var claims = executor.invokeAll(java.util.stream.IntStream.range(0, 24)
                    .<java.util.concurrent.Callable<Boolean>>mapToObj(index ->
                            () -> calendarJobs.claimJob("mysql-it-" + index).isPresent())
                    .toList());
            long claimed = 0;
            for (var claim : claims) {
                if (claim.get()) claimed += 1;
            }
            assertThat(claimed).isOne();
        }

        AtomicInteger attempts = new AtomicInteger();
        assertThat(databaseWrites.execute(() -> {
            int attempt = attempts.incrementAndGet();
            if (attempt < 3) throw new CannotAcquireLockException("simulated MySQL deadlock");
            return attempt;
        })).isEqualTo(3);
    }

    private void assertAllowedPreflight(String origin) throws IOException, InterruptedException {
        HttpRequest preflight = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "PUT")
                .header("Access-Control-Request-Headers", "authorization,content-type,if-match,idempotency-key")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .build();

        HttpResponse<String> response = send(preflight);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).contains(origin);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElse(""))
                .contains("PUT");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElse(""))
                .containsIgnoringCase("idempotency-key")
                .containsIgnoringCase("authorization");
    }

    private HttpResponse<String> get(String accessToken, String ifNoneMatch) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Authorization", "Bearer " + accessToken)
                .GET();
        if (ifNoneMatch != null) {
            request.header("If-None-Match", ifNoneMatch);
        }
        return send(request.build());
    }

    private HttpResponse<String> put(
            String accessToken,
            String idempotencyKey,
            String ifMatch,
            String ifNoneMatch,
            PlannerSnapshot snapshot
    ) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Authorization", "Bearer " + accessToken)
                .header(PlannerController.IDEMPOTENCY_HEADER, idempotencyKey)
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .PUT(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(snapshot)));
        if (ifMatch != null) {
            request.header("If-Match", ifMatch);
        }
        if (ifNoneMatch != null) {
            request.header("If-None-Match", ifNoneMatch);
        }
        return send(request.build());
    }

    private HttpResponse<String> delete(String accessToken, String idempotencyKey, String ifMatch)
            throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Authorization", "Bearer " + accessToken)
                .header(PlannerController.IDEMPOTENCY_HEADER, idempotencyKey)
                .header("If-Match", ifMatch)
                .DELETE()
                .build();
        return send(request);
    }

    private HttpResponse<String> rawGet(String path) throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(uri(path)).GET().build());
    }

    private HttpResponse<String> authenticatedGet(String path, String accessToken)
            throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .GET().build());
    }

    private HttpResponse<String> jsonRequest(String method, String path, String accessToken, String body)
            throws IOException, InterruptedException {
        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .method(method, publisher);
        return send(request.build());
    }

    private HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String token(
            String subject,
            String issuer,
            List<String> audience,
            long expiresInSeconds
    ) throws Exception {
        return token(subject, issuer, audience, expiresInSeconds, Instant.now().minusSeconds(5));
    }

    private String token(
            String subject,
            String issuer,
            List<String> audience,
            long expiresInSeconds,
            Instant authenticationTime
    ) throws Exception {
        Instant now = Instant.now();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader(JWSAlgorithm.HS256),
                new JWTClaimsSet.Builder()
                        .issuer(issuer)
                        .subject(subject)
                        .audience(audience)
                        .issueTime(Date.from(now.minusSeconds(1)))
                        .notBeforeTime(Date.from(now.minusSeconds(1)))
                        .expirationTime(Date.from(now.plusSeconds(expiresInSeconds)))
                        .claim("email", subject + "@example.test")
                        .claim("name", subject)
                        .claim("scope", "metrics.read")
                        .claim("auth_time", Date.from(authenticationTime))
                        .build());
        jwt.sign(new MACSigner(TEST_SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return jwt.serialize();
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private void assertProblem(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type").orElse(""))
                .startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        assertThat(response.body()).contains("\"code\":\"" + code + "\"");
    }

}
