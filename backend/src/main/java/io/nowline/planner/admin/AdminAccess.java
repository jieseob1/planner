package io.nowline.planner.admin;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Map;

@Component("adminAccess")
public class AdminAccess {
    public static final String ROLE = "nowline-admin";

    /** Invoked only after the resource server verifies signature, issuer, audience and expiry. */
    public boolean allowed(Authentication authentication) {
        if (!(authentication instanceof JwtAuthenticationToken token) || !token.isAuthenticated()) return false;
        if (token.getToken().getSubject() == null || token.getToken().getSubject().isBlank()) return false;
        Object realm = token.getToken().getClaims().get("realm_access");
        if (!(realm instanceof Map<?, ?> access)) return false;
        Object value = access.get("roles");
        return value instanceof Collection<?> roles
                && roles.stream().allMatch(String.class::isInstance)
                && roles.contains(ROLE);
    }
}
