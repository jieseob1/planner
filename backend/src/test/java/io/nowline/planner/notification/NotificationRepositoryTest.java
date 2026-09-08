package io.nowline.planner.notification;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;

import static io.nowline.planner.persistence.JdbcValues.id;
import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class NotificationRepositoryTest {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4.10")
            .withDatabaseName("nowline_notification_test")
            .withUsername("nowline")
            .withPassword("nowline")
            .withUrlParam("serverTimezone", "UTC")
            .withUrlParam("preserveInstants", "true")
            .withCommand(
                    "--character-set-server=utf8mb4",
                    "--collation-server=utf8mb4_0900_as_ci",
                    "--default-time-zone=+00:00",
                    "--log-bin-trust-function-creators=1");

    static HikariDataSource dataSource;
    static JdbcTemplate jdbc;
    static NotificationRepository repository;

    @BeforeAll
    static void createRepository() {
        HikariConfig configuration = new HikariConfig();
        configuration.setJdbcUrl(MYSQL.getJdbcUrl());
        configuration.setUsername(MYSQL.getUsername());
        configuration.setPassword(MYSQL.getPassword());
        dataSource = new HikariDataSource(configuration);
        Flyway.configure().dataSource(dataSource).load().migrate();
        jdbc = new JdbcTemplate(dataSource);
        repository = new NotificationRepository(jdbc);
    }

    @AfterAll
    static void closeDataSource() {
        if (dataSource != null) dataSource.close();
    }

    @BeforeEach
    void cleanRows() {
        jdbc.update("DELETE FROM notification_delivery");
        jdbc.update("DELETE FROM notification_device");
        jdbc.update("DELETE FROM app_user WHERE oidc_issuer = 'urn:nowline:notification-repository-test'");
    }

    @Test
    void atomicallyTransfersAReusedLegacyDeviceToTheAuthenticatedOwner() {
        UUID firstUser = createUser("first-user");
        UUID secondUser = createUser("second-user");
        UUID reusedDevice = UUID.randomUUID();

        repository.upsertDevice(firstUser, reusedDevice, "WEB", "cipher-for-first-user", "first browser");
        repository.upsertDevice(secondUser, reusedDevice, "WEB", "cipher-for-second-user", "second browser");

        assertThat(repository.activeDevices(firstUser)).isEmpty();
        assertThat(repository.activeDevices(secondUser))
                .singleElement()
                .satisfies(device -> {
                    assertThat(device.userId()).isEqualTo(secondUser);
                    assertThat(device.deviceId()).isEqualTo(reusedDevice);
                    assertThat(device.cipher()).isEqualTo("cipher-for-second-user");
                    assertThat(device.label()).isEqualTo("second browser");
                });

        repository.disableDevice(firstUser, reusedDevice);
        assertThat(repository.activeDevices(secondUser)).hasSize(1);
    }

    @Test
    void refreshesTheCurrentOwnersCipherAndReenablesTheDevice() {
        UUID user = createUser("same-user");
        UUID device = UUID.randomUUID();

        repository.upsertDevice(user, device, "WEB", "old-cipher", "old label");
        repository.disableDevice(user, device);
        repository.upsertDevice(user, device, "WEB", "new-cipher", "new label");

        assertThat(repository.activeDevices(user))
                .singleElement()
                .satisfies(value -> {
                    assertThat(value.cipher()).isEqualTo("new-cipher");
                    assertThat(value.label()).isEqualTo("new label");
                });
    }

    @Test
    void futureDeliveryCannotBeClaimedEvenWhenProducerQueuedAheadOfTime() {
        UUID user = createUser("future");
        Instant target = Instant.now().plusSeconds(60);
        assertThat(repository.createDelivery(user, "TIME_BLOCK", "future", "title", "body", "/today", target)).isTrue();
        assertThat(repository.claimDelivery()).isEmpty();
        // Defense against a rolling-deployment producer that still sets available_at to now.
        jdbc.update("UPDATE notification_delivery SET available_at = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 SECOND)");
        assertThat(repository.claimDelivery()).isEmpty();
        jdbc.update("UPDATE notification_delivery SET scheduled_for = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 SECOND)");
        assertThat(repository.claimDelivery()).isPresent();
    }

    @Test
    void duplicateProducersAndConcurrentWorkersProduceOneClaim() throws Exception {
        UUID user = createUser("concurrent");
        Instant target = Instant.now().minusSeconds(5);
        var transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        try (var pool = Executors.newFixedThreadPool(8)) {
            var creations = pool.invokeAll(IntStream.range(0, 8).<Callable<Boolean>>mapToObj(index -> () ->
                    repository.createDelivery(user, "TIME_BLOCK", "same-start", "title", "body", "/today", target)).toList());
            long created = 0;
            for (var result : creations) if (result.get()) created++;
            assertThat(created).isEqualTo(1);
            var claims = pool.invokeAll(IntStream.range(0, 8).<Callable<Boolean>>mapToObj(index -> () ->
                    transaction.execute(status -> repository.claimDelivery().isPresent())).toList());
            long claimed = 0;
            for (var result : claims) if (result.get()) claimed++;
            assertThat(claimed).isEqualTo(1);
        }
        assertThat(jdbc.queryForObject("SELECT attempts FROM notification_delivery", Integer.class)).isEqualTo(1);
    }

    @Test
    void claimRetainsKeyAndScheduleNeededForFreshValidation() {
        UUID user = createUser("payload");
        Instant target = Instant.now().minusSeconds(5).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        repository.createDelivery(user, "TIME_BLOCK", "block:v2:payload", "title", "body", "/today", target);
        assertThat(repository.claimDelivery()).isPresent().get().satisfies(delivery -> {
            assertThat(delivery.deduplicationKey()).isEqualTo("block:v2:payload");
            assertThat(delivery.scheduledFor()).isEqualTo(target);
            assertThat(delivery.userId()).isEqualTo(user);
        });
    }

    @Test
    void newPreferencesDefaultToFifteenButExplicitChoicesRemainUntouched() {
        UUID user = createUser("new-default");
        var preferences = new io.nowline.planner.account.UserPreferenceService(jdbc);
        assertThat(preferences.get(user).blockReminderMinutes()).isEqualTo(15);
        jdbc.update("UPDATE user_preference SET block_reminder_minutes = 10 WHERE user_id = ?", id(user));
        assertThat(preferences.get(user).blockReminderMinutes()).isEqualTo(10);
    }

    @Test
    void revertingAScheduleCanRearmOnlyAnInvalidatedUndeliveredReminder() {
        UUID user = createUser("reverted");
        Instant target = Instant.now().minusSeconds(5).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        repository.createDelivery(user, "TIME_BLOCK", "reverted", "title", "body", "/today", target);
        var delivery = repository.claimDelivery().orElseThrow();
        repository.skipped(delivery.deliveryId(), "reminder-no-longer-current");
        assertThat(repository.createDelivery(user, "TIME_BLOCK", "reverted", "fresh title", "body", "/today", target)).isTrue();
        assertThat(repository.claimDelivery()).isPresent().get().satisfies(rearmed -> {
            assertThat(rearmed.deliveryId()).isEqualTo(delivery.deliveryId());
            assertThat(rearmed.title()).isEqualTo("fresh title");
        });
        repository.delivered(delivery.deliveryId());
        assertThat(repository.createDelivery(user, "TIME_BLOCK", "reverted", "title", "body", "/today", target)).isFalse();
        assertThat(repository.claimDelivery()).isEmpty();
    }

    private UUID createUser(String subject) {
        UUID userId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO app_user (user_id, oidc_issuer, oidc_subject, display_name)
                VALUES (?, 'urn:nowline:notification-repository-test', ?, ?)
                """, id(userId), subject, subject);
        return userId;
    }
}
