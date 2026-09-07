package io.nowline.planner.admin;

import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AdminAccessTest {
    private final AdminAccess access = new AdminAccess();

    @Test
    void deniesAbsentMalformedAndMisplacedRoles() {
        for (Object realm : List.of("nowline-admin", List.of("nowline-admin"), Map.of(),
                Map.of("roles", "nowline-admin"), Map.of("roles", List.of("Nowline-admin")),
                Map.of("roles", List.of("nowline-admin", 3)))) {
            assertThat(access.allowed(token(Map.of("realm_access", realm)))).isFalse();
        }
        assertThat(access.allowed(null)).isFalse();
        assertThat(access.allowed(token(Map.of("email", "jieseob1@gmail.com")))).isFalse();
        assertThat(access.allowed(token(Map.of("roles", List.of("nowline-admin"))))).isFalse();
        assertThat(access.allowed(token(Map.of("resource_access", Map.of("nowline-web", Map.of("roles", List.of("nowline-admin"))))))).isFalse();
        assertThat(access.allowed(UsernamePasswordAuthenticationToken.authenticated("admin", "secret",
                List.of(new SimpleGrantedAuthority("ROLE_nowline-admin"))))).isFalse();
    }

    @Test
    void allowsExactRealmRoleOnAuthenticatedJwtOnly() {
        JwtAuthenticationToken admin = token(Map.of("realm_access", Map.of("roles", List.of("user", "nowline-admin"))));
        assertThat(access.allowed(admin)).isTrue();
        admin.setAuthenticated(false);
        assertThat(access.allowed(admin)).isFalse();
    }

    @Test
    void guardsMetadataFormatting() {
        assertThat(AdminRepository.maskEmail("jieseob1@gmail.com")).isEqualTo("j•••@gmail.com");
        assertThat(AdminRepository.maskEmail("not-an-email")).isEqualTo("비공개");
        assertThat(AdminRepository.maskEmail(null)).isNull();
        assertThat(AdminRepository.safeCode("Bearer secret\nraw payload")).isEqualTo("REDACTED");
        assertThat(AdminRepository.errorCode("SECRET_REFRESH_TOKEN")).isEqualTo("OTHER");
    }

    private JwtAuthenticationToken token(Map<String, Object> claims) {
        Jwt jwt = Jwt.withTokenValue("unit-fixture").header("alg", "RS256").subject("admin")
                .claims(values -> values.putAll(claims)).build();
        return new JwtAuthenticationToken(jwt, List.of());
    }
}
