package io.nowline.planner.notification;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;
import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class NotificationRepositoryTest {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4.10")
            .withDatabaseName("nowline_notification_test")
            .withUsername("nowline")
            .withPassword("nowline")
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

    private UUID createUser(String subject) {
        UUID userId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO app_user (user_id, oidc_issuer, oidc_subject, display_name)
                VALUES (?, 'urn:nowline:notification-repository-test', ?, ?)
                """, id(userId), subject, subject);
        return userId;
    }
}
