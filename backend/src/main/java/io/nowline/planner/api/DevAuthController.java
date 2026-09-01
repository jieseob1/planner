package io.nowline.planner.api;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

@Profile("local-auth")
@RestController
@RequestMapping("/api/v1/auth")
public class DevAuthController {

    private final String issuer;
    private final String audience;
    private final String subject;
    private final byte[] secret;

    public DevAuthController(
            @Value("${nowline.security.issuer}") String issuer,
            @Value("${nowline.security.audience}") String audience,
            @Value("${nowline.security.dev-subject}") String subject,
            @Value("${nowline.security.hmac-secret}") String secret
    ) {
        this.issuer = issuer;
        this.audience = audience;
        this.subject = subject;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping("/dev-token")
    ResponseEntity<Map<String, Object>> token() throws JOSEException {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(900);
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject(subject)
                .audience(audience)
                .issueTime(Date.from(now))
                .notBeforeTime(Date.from(now.minusSeconds(5)))
                .expirationTime(Date.from(expiresAt))
                .claim("auth_time", Date.from(now))
                .claim("name", "Local Goals to Today User")
                .claim("email", "local@nowline.invalid")
                .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner(secret));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(Map.of(
                        "accessToken", jwt.serialize(),
                        "tokenType", "Bearer",
                        "expiresIn", 900));
    }
}
