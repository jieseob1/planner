package io.nowline.planner.security;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

@Service
public class CurrentUserService {

    private final JdbcClient jdbc;
    private final boolean consentRequired;
    private final String currentPolicyVersion;

    public CurrentUserService(
            JdbcClient jdbc,
            @Value("${nowline.security.consent-required:true}") boolean consentRequired,
            @Value("${nowline.policy.version:2026-09-01}") String currentPolicyVersion
    ) {
        this.jdbc = jdbc;
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
        jdbc.sql("""
                        INSERT INTO app_user (
                            user_id, oidc_issuer, oidc_subject, email, display_name, last_seen_at
                        ) VALUES (:userId, :issuer, :subject, :email, :displayName, now())
                        ON CONFLICT (oidc_issuer, oidc_subject) DO UPDATE SET
                            email = COALESCE(EXCLUDED.email, app_user.email),
                            display_name = COALESCE(EXCLUDED.display_name, app_user.display_name),
                            last_seen_at = now()
                        """)
                .param("userId", userId)
                .param("issuer", issuer)
                .param("subject", subject)
                .param("email", normalizedClaim(jwt.getClaimAsString("email"), 320))
                .param("displayName", normalizedClaim(jwt.getClaimAsString("name"), 200))
                .update();

        return jdbc.sql("""
                        SELECT user_id FROM app_user
                        WHERE oidc_issuer = :issuer AND oidc_subject = :subject AND deleted_at IS NULL
                        """)
                .param("issuer", issuer)
                .param("subject", subject)
                .query(UUID.class)
                .single();
    }

    @Transactional(readOnly = true)
    public ConsentStatus consentStatus(UUID userId) {
        return jdbc.sql("""
                        SELECT terms_accepted_at, privacy_accepted_at, policy_version
                        FROM app_user WHERE user_id = ? AND deleted_at IS NULL
                        """)
                .param(userId)
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
                        UPDATE app_user SET terms_accepted_at = now(), privacy_accepted_at = now(),
                            policy_version = :version, last_seen_at = now()
                        WHERE user_id = :userId AND deleted_at IS NULL
                        """)
                .param("version", currentPolicyVersion)
                .param("userId", userId)
                .update();
        return consentStatus(userId);
    }

    public String currentPolicyVersion() {
        return currentPolicyVersion;
    }

    public record ConsentStatus(boolean accepted, String policyVersion) {}

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
