package io.nowline.planner.api;

import com.zaxxer.hikari.HikariDataSource;
import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlannerApiIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("nowline")
            .withUsername("nowline")
            .withPassword("nowline");

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
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

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @Test
    void createReadReplayUpdateConflictDeleteAndUserIsolation() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID otherUser = UUID.randomUUID();
        PlannerSnapshot initial = PlannerFixtures.snapshot();

        HttpResponse<String> created = put(userId, "create-1", null, "*", initial);
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.headers().firstValue("ETag")).contains("\"1\"");
        PlannerEnvelope createdEnvelope = objectMapper.readValue(created.body(), PlannerEnvelope.class);
        assertThat(createdEnvelope.revision()).isEqualTo(1);
        assertThat(createdEnvelope.snapshot().timeBlocks().getFirst().weekOffset()).isZero();

        HttpResponse<String> replay = put(userId, "create-1", null, "*", initial);
        assertThat(replay.statusCode()).isEqualTo(201);
        assertThat(replay.body()).isEqualTo(created.body());

        HttpResponse<String> read = get(userId, null);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(read.headers().firstValue("ETag")).contains("\"1\"");
        assertThat(objectMapper.readValue(read.body(), PlannerEnvelope.class).snapshot().tasks())
                .extracting(PlannerSnapshot.Task::id)
                .containsExactly("task-draft", "task-invoice");

        HttpResponse<String> notModified = get(userId, "W/\"1\"");
        assertThat(notModified.statusCode()).isEqualTo(304);
        assertThat(notModified.body()).isEmpty();

        PlannerSnapshot changed = PlannerFixtures.withDirection(initial, "수정된 연간 방향");
        HttpResponse<String> updated = put(userId, "update-1", "\"1\"", null, changed);
        assertThat(updated.statusCode()).isEqualTo(200);
        assertThat(updated.headers().firstValue("ETag")).contains("\"2\"");
        assertThat(objectMapper.readValue(updated.body(), PlannerEnvelope.class).revision()).isEqualTo(2);

        HttpResponse<String> stale = put(userId, "stale-1", "\"1\"", null, changed);
        assertProblem(stale, 412, "revision-conflict");

        HttpResponse<String> reusedKey = put(
                userId,
                "update-1",
                "\"1\"",
                null,
                PlannerFixtures.withDirection(initial, "다른 내용"));
        assertProblem(reusedKey, 409, "idempotency-key-reused");

        assertProblem(get(otherUser, null), 404, "planner-not-found");

        HttpResponse<String> deleted = delete(userId, "delete-1", "\"2\"");
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(delete(userId, "delete-1", "\"2\"").statusCode()).isEqualTo(204);
        assertProblem(get(userId, null), 404, "planner-not-found");

        HttpResponse<String> recreated = put(userId, "create-2", null, "*", initial);
        assertThat(recreated.statusCode()).isEqualTo(201);
        assertThat(recreated.headers().firstValue("ETag")).contains("\"4\"");
        assertProblem(put(userId, "old-generation", "\"2\"", null, changed), 412, "revision-conflict");
    }

    @Test
    void rejectsCrossObjectValidationAndDatabaseOverlap() throws Exception {
        UUID rejectedUser = UUID.randomUUID();
        HttpResponse<String> rejected = put(
                rejectedUser,
                "invalid-overlap",
                null,
                "*",
                PlannerFixtures.withOverlappingBlock(PlannerFixtures.snapshot()));
        assertProblem(rejected, 400, "invalid-planner-snapshot");
        assertProblem(get(rejectedUser, null), 404, "planner-not-found");

        UUID constrainedUser = UUID.randomUUID();
        assertThat(put(constrainedUser, "valid-create", null, "*", PlannerFixtures.snapshot()).statusCode())
                .isEqualTo(201);

        assertThatThrownBy(() -> jdbc.update("""
                        INSERT INTO planner_time_block (
                            user_id, block_id, sort_order, task_id, title, day_key,
                            start_minutes, duration_minutes, external, week_offset
                        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, false, ?)
                        """, constrainedUser, "direct-overlap", 99, "DB overlap", "tue", 1_200, 30, 0))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void exposesProductionHealthMetricsAndBoundedPoolConfiguration() throws Exception {
        HttpResponse<String> readiness = rawGet("/actuator/health/readiness");
        assertThat(readiness.statusCode()).isEqualTo(200);
        assertThat(readiness.body()).contains("UP");
        assertThat(rawGet("/actuator/prometheus").statusCode()).isEqualTo(200);
        assertThat(environment.getProperty("spring.threads.virtual.enabled", Boolean.class)).isTrue();
        assertThat(dataSource.unwrap(HikariDataSource.class).getMaximumPoolSize()).isEqualTo(10);
    }

    @Test
    void returnsRfcProblemsForMissingConditionsInvalidIdentityAndBeanValidation() throws Exception {
        UUID userId = UUID.randomUUID();
        HttpRequest missingCondition = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header(PlannerController.USER_HEADER, userId.toString())
                .header(PlannerController.IDEMPOTENCY_HEADER, "missing-condition")
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .PUT(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(PlannerFixtures.snapshot())))
                .build();
        assertProblem(send(missingCondition), 428, "precondition-required");

        assertProblem(put(
                userId,
                "invalid-target",
                null,
                "*",
                PlannerFixtures.withInvalidTarget(PlannerFixtures.snapshot())), 400, "validation-failed");

        HttpRequest invalidIdentity = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header(PlannerController.USER_HEADER, "not-a-uuid")
                .GET()
                .build();
        assertProblem(send(invalidIdentity), 400, "invalid-request-header");
    }

    @Test
    void allowsConfiguredNativeAndDynamicLocalWebPreflights() throws Exception {
        assertAllowedPreflight("capacitor://localhost");
        assertAllowedPreflight("http://127.0.0.1:4189");
    }

    private void assertAllowedPreflight(String origin) throws IOException, InterruptedException {
        HttpRequest preflight = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "PUT")
                .header("Access-Control-Request-Headers", "content-type,if-match,idempotency-key,x-nowline-user-id")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .build();

        HttpResponse<String> response = send(preflight);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).contains(origin);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElse(""))
                .contains("PUT");
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElse(""))
                .containsIgnoringCase("idempotency-key")
                .containsIgnoringCase("x-nowline-user-id");
    }

    private HttpResponse<String> get(UUID userId, String ifNoneMatch) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header(PlannerController.USER_HEADER, userId.toString())
                .GET();
        if (ifNoneMatch != null) {
            request.header("If-None-Match", ifNoneMatch);
        }
        return send(request.build());
    }

    private HttpResponse<String> put(
            UUID userId,
            String idempotencyKey,
            String ifMatch,
            String ifNoneMatch,
            PlannerSnapshot snapshot
    ) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header(PlannerController.USER_HEADER, userId.toString())
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

    private HttpResponse<String> delete(UUID userId, String idempotencyKey, String ifMatch)
            throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/v1/planner"))
                .header(PlannerController.USER_HEADER, userId.toString())
                .header(PlannerController.IDEMPOTENCY_HEADER, idempotencyKey)
                .header("If-Match", ifMatch)
                .DELETE()
                .build();
        return send(request);
    }

    private HttpResponse<String> rawGet(String path) throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(uri(path)).GET().build());
    }

    private HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
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
