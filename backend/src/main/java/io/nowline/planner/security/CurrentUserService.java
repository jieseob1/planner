package io.nowline.planner.security;

import io.nowline.planner.account.AccountEntitlementService;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;

@Service
public class CurrentUserService {

    private final JdbcClient jdbc;
    private final AccountEntitlementService entitlements;
    private final boolean consentRequired;
    private final String currentPolicyVersion;

    public CurrentUserService(
            JdbcClient jdbc,
            AccountEntitlementService entitlements,
            @Value("${nowline.security.consent-required:true}") boolean consentRequired,
            @Value("${nowline.policy.version:2026-09-01}") String currentPolicyVersion
    ) {
        this.jdbc = jdbc;
        this.entitlements = entitlements;
        this.consentRequired = consentRequired;
        this.currentPolicyVersion = currentPolicyVersion;
    }

    @Transactional
    public UUID resolve(Jwt jwt) {
        UUID userId = resolveProvisional(jwt);
        if (consentRequired && !consentStatus(userId).accepted()) {
            throw io.nowline.planner.service.PlannerException.consentRequired();
        }
        return userId;
    }

    @Transactional
    public UUID resolveProvisional(Jwt jwt) {
        String issuer = issuer(jwt);
        String subject = jwt.getSubject();
        if (subject == null || subject.isBlank() || subject.length() > 512) {
            throw new IllegalArgumentException("Authenticated token has no usable subject");
        }
        UUID userId = stableUserId(issuer, subject);
        lockDeletionState(userId, jwt);
        jdbc.sql("""
                        INSERT INTO app_user (
                            user_id, oidc_issuer, oidc_subject, email, display_name, last_seen_at
                        ) VALUES (:userId, :issuer, :subject, :email, :displayName, CURRENT_TIMESTAMP(6)) AS new
                        ON DUPLICATE KEY UPDATE
                            email = COALESCE(new.email, app_user.email),
                            display_name = COALESCE(new.display_name, app_user.display_name),
                            last_seen_at = CURRENT_TIMESTAMP(6)
                        """)
                .param("userId", id(userId))
                .param("issuer", issuer)
                .param("subject", subject)
                .param("email", normalizedClaim(jwt.getClaimAsString("email"), 320))
                .param("displayName", normalizedClaim(jwt.getClaimAsString("name"), 200))
                .update();

        UUID resolvedUserId = jdbc.sql("""
                        SELECT user_id FROM app_user
                        WHERE identity_key = SHA2(CONCAT(:issuer, CHAR(0), :subject), 256)
                          AND oidc_issuer = :issuer AND oidc_subject = :subject AND deleted_at IS NULL
                        """)
                .param("issuer", issuer)
                .param("subject", subject)
                .query((rs, row) -> UUID.fromString(rs.getString("user_id")))
                .single();
        entitlements.ensureBetaEntitlement(resolvedUserId);
        return resolvedUserId;
    }

    private void lockDeletionState(UUID userId, Jwt jwt) {
        jdbc.sql("""
                        INSERT INTO deleted_identity_tombstone (user_id, deleted_at)
                        VALUES (:userId, NULL) AS identity_guard
                        ON DUPLICATE KEY UPDATE user_id = identity_guard.user_id
                        """)
                .param("userId", id(userId))
                .update();

        DeletionState state = jdbc.sql("""
                        SELECT deleted_at,
                               CAST(UNIX_TIMESTAMP(deleted_at) * 1000 AS SIGNED) AS deleted_epoch_millis
                        FROM deleted_identity_tombstone
                        WHERE user_id = :userId
                        """)
                .param("userId", id(userId))
                .query((rs, row) -> {
                    Long deletedEpochMillis = rs.getObject("deleted_epoch_millis", Long.class);
                    return new DeletionState(deletedEpochMillis == null
                            ? null
                            : Instant.ofEpochMilli(deletedEpochMillis));
                })
                .single();
        if (state.deletedAt() != null && !isAuthenticatedAfterDeletion(jwt, state.deletedAt())) {
            throw io.nowline.planner.service.PlannerException.deletedAccountSession();
        }
    }

    private boolean isAuthenticatedAfterDeletion(Jwt jwt, Instant deletedAt) {
        Instant authenticationTime = jwt.getClaimAsInstant("auth_time");
        Instant issuedAt = jwt.getIssuedAt();
        Instant latestAcceptedTimestamp = Instant.now().plusSeconds(30);
        return authenticationTime != null
                && issuedAt != null
                && authenticationTime.isAfter(deletedAt)
                && issuedAt.isAfter(deletedAt)
                && !authenticationTime.isAfter(latestAcceptedTimestamp)
                && !issuedAt.isAfter(latestAcceptedTimestamp);
    }

    @Transactional(readOnly = true)
    public ConsentStatus consentStatus(UUID userId) {
        return jdbc.sql("""
                        SELECT terms_accepted_at, privacy_accepted_at, policy_version
                        FROM app_user WHERE user_id = ? AND deleted_at IS NULL
                        """)
                .param(id(userId))
                .query((rs, row) -> new ConsentStatus(
                        rs.getTimestamp("terms_accepted_at") != null
                                && rs.getTimestamp("privacy_accepted_at") != null
                                && currentPolicyVersion.equals(rs.getString("policy_version")),
                        currentPolicyVersion))
                .single();
    }

    @Transactional
    public ConsentStatus acceptConsent(UUID userId) {
        jdbc.sql("""
                        UPDATE app_user SET terms_accepted_at = CURRENT_TIMESTAMP(6), privacy_accepted_at = CURRENT_TIMESTAMP(6),
                            policy_version = :version, last_seen_at = CURRENT_TIMESTAMP(6)
                        WHERE user_id = :userId AND deleted_at IS NULL
                        """)
                .param("version", currentPolicyVersion)
                .param("userId", id(userId))
                .update();
        return consentStatus(userId);
    }

    public String currentPolicyVersion() {
        return currentPolicyVersion;
    }

    public record ConsentStatus(boolean accepted, String policyVersion) {}

    private record DeletionState(Instant deletedAt) {}

    private String issuer(Jwt jwt) {
        var issuer = jwt.getIssuer();
        if (issuer == null || issuer.toString().isBlank()) {
            throw new IllegalArgumentException("Authenticated token has no issuer");
        }
        return issuer.toString();
    }

    private String normalizedClaim(String value, int maxLength) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
    }

    private UUID stableUserId(String issuer, String subject) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((issuer + "\0" + subject).getBytes(StandardCharsets.UTF_8));
            hash[6] = (byte) ((hash[6] & 0x0f) | 0x50);
            hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
            long high = 0;
            long low = 0;
            for (int index = 0; index < 8; index++) high = (high << 8) | (hash[index] & 0xffL);
            for (int index = 8; index < 16; index++) low = (low << 8) | (hash[index] & 0xffL);
            return new UUID(high, low);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
