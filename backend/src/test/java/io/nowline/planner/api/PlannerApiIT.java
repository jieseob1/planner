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
import org.springframework.dao.DataAccessException;
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
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
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
        String userSubject = "user-" + UUID.randomUUID();
        String userToken = token(userSubject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        String otherUserToken = token("user-" + UUID.randomUUID(), TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        PlannerSnapshot initial = PlannerFixtures.snapshot();

        HttpResponse<String> created = put(userToken, "create-1", null, "*", initial);
        assertThat(created.statusCode()).isEqualTo(201);
        String etag1 = created.headers().firstValue("ETag").orElseThrow();
        assertThat(etag1).matches("\"planner-[0-9a-f]{32}-1\"");
        PlannerEnvelope createdEnvelope = objectMapper.readValue(created.body(), PlannerEnvelope.class);
        assertThat(createdEnvelope.revision()).isEqualTo(1);
        assertThat(createdEnvelope.snapshot().timeBlocks().getFirst().weekOffset()).isZero();
        assertThat(createdEnvelope.snapshot().timeBlocks().getFirst().date())
                .isEqualTo(LocalDate.parse("2026-09-01"));
        assertThat(createdEnvelope.snapshot().outcomes().getFirst().nextCheckDate())
                .isEqualTo(LocalDate.parse("2026-09-04"));
        assertThat(createdEnvelope.snapshot().outcomes().getFirst().metricUpdatedAt())
                .isEqualTo(Instant.parse("2026-08-30T03:00:00Z"));
        assertThat(createdEnvelope.snapshot().outcomes().getFirst().metricHistoryOrEmpty())
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.value()).isEqualByComparingTo("2");
                    assertThat(entry.evidence()).isEqualTo("게시 URL 2건 확인");
                });
        assertThat(jdbc.queryForObject("""
                        SELECT block.block_date
                        FROM planner_time_block block
                        JOIN app_user app ON app.user_id = block.user_id
                        WHERE app.oidc_issuer = ? AND app.oidc_subject = ? AND block.block_id = ?
                        """, LocalDate.class, TEST_ISSUER, userSubject, "block-draft"))
                .isEqualTo(LocalDate.parse("2026-09-01"));
        assertThat(jdbc.queryForObject("""
                        SELECT COUNT(*)
                        FROM planner_outcome_metric_history history
                        JOIN app_user app ON app.user_id = history.user_id
                        WHERE app.oidc_issuer = ? AND app.oidc_subject = ?
                          AND history.outcome_id = ? AND history.evidence = ?
                        """, Integer.class, TEST_ISSUER, userSubject, "outcome-writing", "게시 URL 2건 확인"))
                .isEqualTo(1);

        HttpResponse<String> replay = put(userToken, "create-1", null, "*", initial);
        assertThat(replay.statusCode()).isEqualTo(201);
        assertThat(replay.body()).isEqualTo(created.body());

        HttpResponse<String> read = get(userToken, null);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(read.headers().firstValue("ETag")).contains(etag1);
        PlannerEnvelope readEnvelope = objectMapper.readValue(read.body(), PlannerEnvelope.class);
        assertThat(readEnvelope.snapshot().tasks())
                .extracting(PlannerSnapshot.Task::id)
                .containsExactly("task-draft", "task-invoice");
        assertThat(readEnvelope.snapshot().timeBlocks().getFirst().date())
                .isEqualTo(LocalDate.parse("2026-09-01"));
        assertThat(readEnvelope.snapshot().outcomes().getFirst().metricHistoryOrEmpty())
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.id()).isEqualTo("metric-writing-2");
                    assertThat(entry.value()).isEqualByComparingTo("2");
                    assertThat(entry.observedAt()).isEqualTo(Instant.parse("2026-08-30T03:00:00Z"));
                    assertThat(entry.evidence()).isEqualTo("게시 URL 2건 확인");
                });

        HttpResponse<String> notModified = get(userToken, "W/" + etag1);
        assertThat(notModified.statusCode()).isEqualTo(304);
        assertThat(notModified.body()).isEmpty();

        assertProblem(put(
                userToken,
                "tamper-metric-history",
                etag1,
                null,
                PlannerFixtures.withTamperedMetricEvidence(initial)), 400, "invalid-planner-snapshot");

        PlannerSnapshot changed = PlannerFixtures.withDirection(initial, "수정된 연간 방향");
        HttpResponse<String> updated = put(userToken, "update-1", etag1, null, changed);
        assertThat(updated.statusCode()).isEqualTo(200);
        String etag2 = updated.headers().firstValue("ETag").orElseThrow();
        assertThat(etag2).matches("\"planner-[0-9a-f]{32}-2\"");
        assertThat(objectMapper.readValue(updated.body(), PlannerEnvelope.class).revision()).isEqualTo(2);

        HttpResponse<String> stale = put(userToken, "stale-1", etag1, null, changed);
        assertProblem(stale, 412, "revision-conflict");

        HttpResponse<String> reusedKey = put(
                userToken,
                "update-1",
                etag1,
                null,
                PlannerFixtures.withDirection(initial, "다른 내용"));
        assertProblem(reusedKey, 409, "idempotency-key-reused");

        assertProblem(get(otherUserToken, null), 404, "planner-not-found");

        HttpResponse<String> deleted = delete(userToken, "delete-1", etag2);
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(delete(userToken, "delete-1", etag2).statusCode()).isEqualTo(204);
        assertProblem(get(userToken, null), 404, "planner-not-found");

        HttpResponse<String> recreated = put(userToken, "create-2", null, "*", initial);
        assertThat(recreated.statusCode()).isEqualTo(201);
        String etag4 = recreated.headers().firstValue("ETag").orElseThrow();
        assertThat(etag4).matches("\"planner-[0-9a-f]{32}-4\"");
        assertProblem(put(userToken, "old-generation", etag2, null, changed), 412, "revision-conflict");
    }

    @Test
    void preservesMigratedLegacyMetricUntilTheFirstRealObservation() throws Exception {
        String subject = "legacy-metric-" + UUID.randomUUID();
        String accessToken = token(subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        HttpResponse<String> created = put(
                accessToken, "legacy-metric-create", null, "*", PlannerFixtures.snapshot());
        assertThat(created.statusCode()).isEqualTo(201);
        String etag1 = created.headers().firstValue("ETag").orElseThrow();
        UUID userId = UUID.fromString(jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                String.class,
                TEST_ISSUER,
                subject));

        jdbc.update("DELETE FROM planner_outcome_metric_history WHERE user_id = ?", id(userId));
        jdbc.update("UPDATE planner_outcome SET metric_updated_at = NULL WHERE user_id = ?", id(userId));

        PlannerEnvelope migrated = objectMapper.readValue(get(accessToken, null).body(), PlannerEnvelope.class);
        assertThat(migrated.snapshot().outcomes().getFirst().current()).isEqualByComparingTo("2");
        assertThat(migrated.snapshot().outcomes().getFirst().metricUpdatedAt()).isNull();
        assertThat(migrated.snapshot().outcomes().getFirst().metricHistoryOrEmpty()).isEmpty();

        PlannerSnapshot unrelated = PlannerFixtures.withDirection(
                migrated.snapshot(), "기존 지표와 무관한 연간 방향 수정");
        HttpResponse<String> unrelatedUpdate = put(
                accessToken, "legacy-metric-unrelated", etag1, null, unrelated);
        assertThat(unrelatedUpdate.statusCode()).isEqualTo(200);
        String etag2 = unrelatedUpdate.headers().firstValue("ETag").orElseThrow();
        PlannerEnvelope preserved = objectMapper.readValue(unrelatedUpdate.body(), PlannerEnvelope.class);
        assertThat(preserved.snapshot().outcomes().getFirst().metricHistoryOrEmpty()).isEmpty();
        assertThat(preserved.snapshot().outcomes().getFirst().metricUpdatedAt()).isNull();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM planner_outcome_metric_history WHERE user_id = ?",
                Integer.class,
                id(userId))).isZero();

        Instant observedAt = Instant.now().minusSeconds(1);
        PlannerSnapshot firstMeasured = withFirstMetricObservation(
                preserved.snapshot(), new BigDecimal("3"), observedAt, "게시 URL 3건 확인");
        HttpResponse<String> measuredUpdate = put(
                accessToken, "legacy-metric-first-observation", etag2, null, firstMeasured);
        assertThat(measuredUpdate.statusCode()).isEqualTo(200);
        PlannerSnapshot.Outcome measured = objectMapper.readValue(measuredUpdate.body(), PlannerEnvelope.class)
                .snapshot().outcomes().getFirst();
        assertThat(measured.current()).isEqualByComparingTo("3");
        assertThat(measured.metricUpdatedAt()).isEqualTo(observedAt);
        assertThat(measured.metricHistoryOrEmpty())
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.value()).isEqualByComparingTo("3");
                    assertThat(entry.observedAt()).isEqualTo(observedAt);
                    assertThat(entry.evidence()).isEqualTo("게시 URL 3건 확인");
                });
    }

    @Test
    void roundTripsAnOfflineMetricObservationRecordedTwentyFourHoursEarlier() throws Exception {
        String subject = "offline-metric-" + UUID.randomUUID();
        String accessToken = token(subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        HttpResponse<String> created = put(
                accessToken, "offline-metric-create", null, "*", PlannerFixtures.snapshot());
        assertThat(created.statusCode()).isEqualTo(201);
        String etag = created.headers().firstValue("ETag").orElseThrow();
        PlannerSnapshot source = objectMapper.readValue(created.body(), PlannerEnvelope.class).snapshot();
        Instant observedAt = Instant.now()
                .truncatedTo(ChronoUnit.MILLIS)
                .minus(Duration.ofHours(24));
        assertThat(observedAt).isAfter(source.outcomes().getFirst().metricUpdatedAt());

        PlannerSnapshot updated = withAppendedMetricObservation(
                source, new BigDecimal("3"), observedAt, "오프라인에서 확인한 게시 URL 3건");
        HttpResponse<String> response = put(
                accessToken, "offline-metric-update", etag, null, updated);

        assertThat(response.statusCode()).isEqualTo(200);
        PlannerSnapshot.Outcome roundTripped = objectMapper.readValue(response.body(), PlannerEnvelope.class)
                .snapshot().outcomes().getFirst();
        assertThat(roundTripped.metricHistoryOrEmpty()).hasSize(2);
        assertThat(roundTripped.metricHistoryOrEmpty().getLast()).satisfies(entry -> {
            assertThat(entry.value()).isEqualByComparingTo("3");
            assertThat(entry.observedAt()).isEqualTo(observedAt);
            assertThat(entry.evidence()).isEqualTo("오프라인에서 확인한 게시 URL 3건");
        });
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM planner_outcome_metric_history history "
                        + "JOIN app_user app ON app.user_id = history.user_id "
                        + "WHERE app.oidc_issuer = ? AND app.oidc_subject = ?",
                Integer.class,
                TEST_ISSUER,
                subject)).isEqualTo(2);
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
        UUID constrainedUser = UUID.fromString(jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                String.class,
                TEST_ISSUER,
                constrainedSubject));

        assertThatThrownBy(() -> jdbc.update("""
                        INSERT INTO planner_time_block (
                            user_id, block_id, sort_order, task_id, title, day_key,
                            start_minutes, duration_minutes, external, week_offset, block_date
                        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, false, ?, ?)
                        """, id(constrainedUser), "direct-overlap", 99, "DB overlap", "wed", 1_200, 30, 1,
                        LocalDate.parse("2026-09-01")))
                .isInstanceOf(DataAccessException.class)
                .hasRootCauseMessage("planner time blocks overlap");

        jdbc.update("""
                        INSERT INTO planner_time_block (
                            user_id, block_id, sort_order, task_id, title, day_key,
                            start_minutes, duration_minutes, external, week_offset, block_date
                        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, false, ?, NULL)
                        """, id(constrainedUser), "legacy-undated", 99, "날짜를 알 수 없는 기존 일정", "tue", 1_200, 30, 0);
        PlannerEnvelope legacyRead = objectMapper.readValue(get(constrainedToken, null).body(), PlannerEnvelope.class);
        assertThat(legacyRead.snapshot().timeBlocks())
                .filteredOn(block -> block.id().equals("legacy-undated"))
                .singleElement()
                .extracting(block -> block.date())
                .isNull();
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
        HttpResponse<String> created = put(
                accessToken, "privacy-create", null, "*", PlannerFixtures.snapshot());
        assertThat(created.statusCode()).isEqualTo(201);
        String plannerEtag = created.headers().firstValue("ETag").orElseThrow();
        UUID userId = UUID.fromString(jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                String.class, TEST_ISSUER, subject));

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
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM deleted_identity_tombstone WHERE user_id = ?",
                Long.class,
                id(userId))).isOne();
        assertThat(jsonRequest("DELETE", "/api/v1/account", accessToken,
                "{\"confirmation\":\"DELETE\"}").statusCode()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE oidc_subject = ?", Long.class, subject))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_aggregate WHERE user_id = ?", Long.class, userId))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM account_entitlement WHERE user_id = ?", Long.class, userId))
                .isZero();

        Instant deletedAt = Instant.ofEpochMilli(jdbc.queryForObject(
                "SELECT CAST(UNIX_TIMESTAMP(deleted_at) * 1000 AS SIGNED) "
                        + "FROM deleted_identity_tombstone WHERE user_id = ?",
                Long.class,
                id(userId)));
        assertProblem(authenticatedGet("/api/v1/planner", accessToken), 401, "account-deleted-session");
        assertProblem(put(
                accessToken,
                "privacy-stale-restore",
                plannerEtag,
                null,
                PlannerFixtures.withDirection(PlannerFixtures.snapshot(), "삭제 후 복원 시도")),
                401,
                "account-deleted-session");
        assertProblem(authenticatedGet("/api/v1/account/consent", accessToken),
                401,
                "account-deleted-session");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE user_id = ?", Long.class, id(userId)))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_aggregate WHERE user_id = ?", Long.class, id(userId)))
                .isZero();

        Instant freshAuthenticationTime = awaitJwtSecondAfter(deletedAt);
        String freshToken = token(
                subject,
                TEST_ISSUER,
                List.of(TEST_AUDIENCE),
                900,
                freshAuthenticationTime,
                freshAuthenticationTime);
        HttpResponse<String> freshConsent = authenticatedGet("/api/v1/account/consent", freshToken);
        assertThat(freshConsent.statusCode()).isEqualTo(200);
        assertThat(freshConsent.body()).contains("\"accepted\":false");
        assertProblem(get(freshToken, null), 404, "planner-not-found");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE user_id = ?", Long.class, id(userId)))
                .isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_aggregate WHERE user_id = ?", Long.class, id(userId)))
                .isZero();
        assertProblem(authenticatedGet("/api/v1/account/consent", accessToken),
                401,
                "account-deleted-session");
        assertThat(Instant.ofEpochMilli(jdbc.queryForObject(
                "SELECT CAST(UNIX_TIMESTAMP(deleted_at) * 1000 AS SIGNED) "
                        + "FROM deleted_identity_tombstone WHERE user_id = ?",
                Long.class,
                id(userId)))).isEqualTo(deletedAt);
    }

    @Test
    void accountDeletionAndStalePlannerUpdateHaveOneSafeFinalState() throws Exception {
        String subject = "privacy-race-" + UUID.randomUUID();
        String accessToken = token(subject, TEST_ISSUER, List.of(TEST_AUDIENCE), 900);
        HttpResponse<String> created = put(
                accessToken, "privacy-race-create", null, "*", PlannerFixtures.snapshot());
        assertThat(created.statusCode()).isEqualTo(201);
        String etag = created.headers().firstValue("ETag").orElseThrow();
        UUID userId = UUID.fromString(jdbc.queryForObject(
                "SELECT user_id FROM app_user WHERE oidc_issuer = ? AND oidc_subject = ?",
                String.class, TEST_ISSUER, subject));

        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var deletion = executor.submit(() -> {
                start.await();
                return jsonRequest("DELETE", "/api/v1/account", accessToken,
                        "{\"confirmation\":\"DELETE\"}");
            });
            var staleUpdate = executor.submit(() -> {
                start.await();
                return put(
                        accessToken,
                        "privacy-race-stale-update",
                        etag,
                        null,
                        PlannerFixtures.withDirection(PlannerFixtures.snapshot(), "삭제와 경합한 수정"));
            });
            start.countDown();

            assertThat(deletion.get().statusCode()).isEqualTo(204);
            HttpResponse<String> updateResponse = staleUpdate.get();
            assertThat(updateResponse.statusCode())
                    .withFailMessage("unexpected concurrent update response: %s", updateResponse.body())
                    .isIn(200, 401);
            if (updateResponse.statusCode() == 401) {
                assertProblem(updateResponse, 401, "account-deleted-session");
            }
        }

        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_user WHERE user_id = ?", Long.class, id(userId)))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_aggregate WHERE user_id = ?", Long.class, id(userId)))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM planner_plan WHERE user_id = ?", Long.class, id(userId)))
                .isZero();
        assertProblem(authenticatedGet("/api/v1/planner", accessToken), 401, "account-deleted-session");
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

    private PlannerSnapshot withFirstMetricObservation(
            PlannerSnapshot source,
            BigDecimal value,
            Instant observedAt,
            String evidence
    ) {
        PlannerSnapshot.Outcome before = source.outcomes().getFirst();
        PlannerSnapshot.MetricHistoryEntry observation = new PlannerSnapshot.MetricHistoryEntry(
                "metric-writing-first-real", value, observedAt, evidence);
        PlannerSnapshot.Outcome measured = new PlannerSnapshot.Outcome(
                before.id(), before.title(), before.parentTitle(), value, before.target(), before.unit(),
                before.confidence(), before.lastUpdatedDays(), observedAt, before.nextCheckDate(),
                List.of(observation), before.actualHours(), before.neededHours(), before.availableHours(),
                evidence, before.changeLabel(), before.attention(), before.decision());
        return new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), source.timeBlocks(),
                source.timeEntries(), List.of(measured), source.timer(), source.review());
    }

    private PlannerSnapshot withAppendedMetricObservation(
            PlannerSnapshot source,
            BigDecimal value,
            Instant observedAt,
            String evidence
    ) {
        PlannerSnapshot.Outcome before = source.outcomes().getFirst();
        PlannerSnapshot.MetricHistoryEntry observation = new PlannerSnapshot.MetricHistoryEntry(
                "metric-writing-offline", value, observedAt, evidence);
        ArrayList<PlannerSnapshot.MetricHistoryEntry> history = new ArrayList<>(before.metricHistoryOrEmpty());
        history.add(observation);
        PlannerSnapshot.Outcome measured = new PlannerSnapshot.Outcome(
                before.id(), before.title(), before.parentTitle(), value, before.target(), before.unit(),
                before.confidence(), before.lastUpdatedDays(), observedAt, before.nextCheckDate(),
                history, before.actualHours(), before.neededHours(), before.availableHours(),
                evidence, before.changeLabel(), before.attention(), before.decision());
        return new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), source.timeBlocks(),
                source.timeEntries(), List.of(measured), source.timer(), source.review());
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
        return token(subject, issuer, audience, expiresInSeconds, authenticationTime, now.minusSeconds(1));
    }

    private String token(
            String subject,
            String issuer,
            List<String> audience,
            long expiresInSeconds,
            Instant authenticationTime,
            Instant issuedAt
    ) throws Exception {
        Instant now = Instant.now();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader(JWSAlgorithm.HS256),
                new JWTClaimsSet.Builder()
                        .issuer(issuer)
                        .subject(subject)
                        .audience(audience)
                        .issueTime(Date.from(issuedAt))
                        .notBeforeTime(Date.from(issuedAt.minusSeconds(1)))
                        .expirationTime(Date.from(now.plusSeconds(expiresInSeconds)))
                        .claim("email", subject + "@example.test")
                        .claim("name", subject)
                        .claim("scope", "metrics.read")
                        .claim("auth_time", Date.from(authenticationTime))
                        .build());
        jwt.sign(new MACSigner(TEST_SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return jwt.serialize();
    }

    private Instant awaitJwtSecondAfter(Instant cutoff) throws InterruptedException {
        Instant candidate = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        while (!candidate.isAfter(cutoff)) {
            Thread.sleep(10);
            candidate = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        }
        return candidate;
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
