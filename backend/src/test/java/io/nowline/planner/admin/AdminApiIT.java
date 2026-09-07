package io.nowline.planner.admin;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminApiIT {
    private static final String ISSUER = "https://admin-tests.invalid";
    private static final String SECRET = "admin-test-only-signing-secret-at-least-32-bytes";
    private static final List<String> ENDPOINTS = List.of("access", "overview", "users", "sync-failures", "job-failures", "audit");
    private static final Map<String, Object> ADMIN = Map.of("realm_access", Map.of("roles", List.of("nowline-admin")));

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4.10")
            .withDatabaseName("nowline").withUsername("nowline").withPassword("nowline")
            .withCommand("--character-set-server=utf8mb4", "--collation-server=utf8mb4_0900_as_ci",
                    "--default-time-zone=+00:00", "--log-bin-trust-function-creators=1");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("nowline.security.issuer", () -> ISSUER);
        registry.add("nowline.security.audience", () -> "nowline-api");
        registry.add("nowline.security.hmac-secret", () -> SECRET);
        registry.add("nowline.workers.enabled", () -> "false");
        registry.add("nowline.security.consent-required", () -> "false");
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @BeforeEach
    void resetFixtures() { jdbc.update("DELETE FROM app_user"); jdbc.update("DELETE FROM integration_job"); }

    @Test
    void discoveryReturnsTheValidatedRoleAndEveryDataEndpointRequiresIt() throws Exception {
        String user = token(Map.of("email", "jieseob1@gmail.com"));
        String admin = token(ADMIN);
        for (String endpoint : ENDPOINTS) {
            assertThat(get(endpoint, null).statusCode()).as("anonymous %s", endpoint).isEqualTo(401);
            HttpResponse<String> ordinaryResponse = get(endpoint, user);
            if (endpoint.equals("access")) {
                assertThat(body(ordinaryResponse).path("allowed").asBoolean()).isFalse();
                assertThat(json.readTree(ordinaryResponse.body()).size()).isEqualTo(1);
                assertThat(ordinaryResponse.headers().firstValue("Cache-Control")).contains("no-store");
            } else {
                assertThat(ordinaryResponse.statusCode()).as("ordinary %s", endpoint).isEqualTo(403);
            }
            HttpResponse<String> response = get(endpoint, admin);
            assertThat(response.statusCode()).as("admin %s: %s", endpoint, response.body()).isEqualTo(200);
            assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
            if (endpoint.equals("access")) assertThat(body(response).path("allowed").asBoolean()).isTrue();
        }
    }

    @Test
    void forgedSignatureAndUntrustedIssuerAudienceOrExpiredTokenAreUnauthorized() throws Exception {
        for (String invalid : List.of(
                token(ADMIN, "another-test-signing-secret-that-is-long-enough", ISSUER, "nowline-api", 300),
                token(ADMIN, SECRET, "https://forged-issuer.invalid", "nowline-api", 300),
                token(ADMIN, SECRET, ISSUER, "different-api", 300),
                token(ADMIN, SECRET, ISSUER, "nowline-api", -300),
                "eyJhbGciOiJub25lIn0.eyJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsibm93bGluZS1hZG1pbiJdfX0.")) {
            assertThat(get("overview", invalid).statusCode()).isEqualTo(401);
            assertThat(get("access", invalid).statusCode()).isEqualTo(401);
        }
    }

    @Test
    void signedMalformedAndWrongLocationRoleClaimsAreForbidden() throws Exception {
        for (Map<String, Object> claims : List.of(
                Map.<String, Object>of("realm_access", "nowline-admin"),
                Map.<String, Object>of("realm_access", Map.of("roles", "nowline-admin")),
                Map.<String, Object>of("realm_access", Map.of("roles", List.of("nowline-admin", 1))),
                Map.<String, Object>of("roles", List.of("nowline-admin")),
                Map.<String, Object>of("resource_access", Map.of("nowline-web", Map.of("roles", List.of("nowline-admin")))))) {
            assertThat(get("overview", token(claims)).statusCode()).isEqualTo(403);
            assertThat(body(get("access", token(claims))).path("allowed").asBoolean()).isFalse();
        }
    }

    @Test
    void listBoundsAreRejectedAndStablePagesNeverOverrunRequestedSize() throws Exception {
        for (int i = 0; i < 23; i++) user("person" + i + "@example.com", false);
        user("deleted@example.com", true);
        String admin = token(ADMIN);
        for (String endpoint : List.of("users", "sync-failures", "job-failures", "audit")) {
            for (String query : List.of("?size=0", "?size=51", "?size=2147483647", "?page=-1", "?page=201", "?page=oops")) {
                assertThat(get(endpoint + query, admin).statusCode()).as(endpoint + query).isEqualTo(400);
            }
            assertThat(get(endpoint + "?page=200&size=50", admin).statusCode()).isEqualTo(200);
        }
        JsonNode first = body(get("users?size=20", admin));
        JsonNode next = body(get("users?page=1&size=20", admin));
        assertThat(first.path("items").size()).isEqualTo(20);
        assertThat(first.path("hasNext").asBoolean()).isTrue();
        assertThat(next.path("items").size()).isEqualTo(3);
        assertThat(next.path("hasNext").asBoolean()).isFalse();
        assertThat(first.path("items").toString()).doesNotContain("person", "deleted", "displayName", "oidc_subject", "email\"");
        var ids = new java.util.HashSet<String>();
        for (JsonNode item : first.path("items")) ids.add(item.path("userId").asText());
        for (JsonNode item : next.path("items")) assertThat(ids.add(item.path("userId").asText())).isTrue();
        assertThat(body(get("overview", admin)).path("accounts").asInt()).isEqualTo(23);
    }

    @Test
    void actualDatabaseFailureAndAuditMetadataExcludePrivateContent() throws Exception {
        String id = user("sensitive-address@example.com", false);
        jdbc.update("""
                INSERT INTO google_calendar_connection
                (user_id,google_account_email,refresh_token_cipher,granted_scopes,sync_token,selected_calendar_id,sync_status,last_error_code)
                VALUES (?, 'private-calendar@example.com','SECRET_REFRESH','[]','SECRET_SYNC','PRIVATE_CALENDAR','ERROR','google-calendar-sync-failed')
                """, id);
        jdbc.update("""
                INSERT INTO integration_job (job_id,user_id,job_type,deduplication_key,payload,status,attempts,last_error)
                VALUES (?,?,'CALENDAR_SYNC','PRIVATE_DEDUPE','{"secret":"PRIVATE_PAYLOAD"}','DEAD',5,'Bearer SECRET_ERROR')
                """, UUID.randomUUID().toString(), id);
        jdbc.update("""
                INSERT INTO planner_audit_event (event_id,user_id,action,revision,details)
                VALUES (?,?,'PLAN_UPDATED',4,'{"title":"PRIVATE_PLANNER_TEXT"}')
                """, UUID.randomUUID().toString(), id);
        String admin = token(ADMIN);
        for (String endpoint : ENDPOINTS) {
            HttpResponse<String> response = get(endpoint, admin);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.body()).doesNotContain("SECRET_", "PRIVATE_", "private-calendar", "sensitive-address", "refreshToken", "payload", "details", "lastError");
        }
        assertThat(body(get("sync-failures", admin)).path("items").get(0).path("errorCode").asText()).isEqualTo("google-calendar-sync-failed");
        assertThat(body(get("job-failures", admin)).path("items").get(0).path("attempts").asInt()).isEqualTo(5);
        assertThat(body(get("audit", admin)).path("items").get(0).path("action").asText()).isEqualTo("PLAN_UPDATED");
        JsonNode overview = body(get("overview", admin));
        assertThat(overview.path("syncFailures").asInt()).isEqualTo(1);
        assertThat(overview.path("deadJobs").asInt()).isEqualTo(1);
        assertThat(overview.path("recentAuditEvents").asInt()).isEqualTo(1);
    }

    @Test
    void noAdminMutationRoutesExist() throws Exception {
        String admin = token(ADMIN);
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE")) {
            for (String endpoint : ENDPOINTS) {
                HttpResponse<String> response = http.send(HttpRequest.newBuilder(uri(endpoint))
                        .header("Authorization", "Bearer " + admin).timeout(Duration.ofSeconds(10))
                        .method(method, HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
                // Existing global security also denies the framework's /error dispatch.
                assertThat(response.statusCode()).as(method + " " + endpoint).isIn(403, 405);
            }
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_user", Integer.class)).isZero();
    }

    private String user(String email, boolean deleted) {
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO app_user (user_id,oidc_issuer,oidc_subject,email,display_name,deleted_at)
                VALUES (?, ?, ?, ?, 'PRIVATE_DISPLAY_NAME', ?)
                """, id, ISSUER, id, email, deleted ? java.sql.Timestamp.from(Instant.now()) : null);
        return id;
    }
    private JsonNode body(HttpResponse<String> response) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return json.readTree(response.body());
    }
    private URI uri(String endpoint) { return URI.create("http://localhost:" + port + "/api/v1/admin/" + endpoint); }
    private HttpResponse<String> get(String endpoint, String token) throws Exception {
        var builder = HttpRequest.newBuilder(uri(endpoint)).timeout(Duration.ofSeconds(10)).GET();
        if (token != null) builder.header("Authorization", "Bearer " + token);
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }
    private String token(Map<String, Object> claims) throws Exception { return token(claims, SECRET, ISSUER, "nowline-api", 300); }
    private String token(Map<String, Object> claims, String secret, String issuer, String audience, int lifetime) throws Exception {
        Instant now = Instant.now();
        var builder = new JWTClaimsSet.Builder().subject("admin-http-test").issuer(issuer).audience(audience)
                .issueTime(Date.from(now.minusSeconds(600))).expirationTime(Date.from(now.plusSeconds(lifetime)));
        claims.forEach(builder::claim);
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), builder.build());
        jwt.sign(new MACSigner(secret));
        return jwt.serialize();
    }
}
