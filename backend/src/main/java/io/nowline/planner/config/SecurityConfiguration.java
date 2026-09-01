package io.nowline.planner.config;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import io.nowline.planner.security.ApiProtectionFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

@Configuration
@EnableMethodSecurity
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfiguration {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ApiProtectionFilter apiProtectionFilter) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"))
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(referrer -> referrer.policy(
                                org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .permissionsPolicyHeader(permissions -> permissions.policy(
                                "camera=(), microphone=(), geolocation=(), payment=(), usb=()"))
                        .httpStrictTransportSecurity(hsts -> hsts
                                .includeSubDomains(true).preload(true).maxAgeInSeconds(31536000)))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers("/actuator/prometheus").hasAuthority("SCOPE_metrics.read")
                        .requestMatchers(HttpMethod.POST, "/api/v1/calendar/google/webhook").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/integrations/google-calendar/oauth/callback").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/dev-token").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .requestMatchers("/actuator/**").denyAll()
                        .anyRequest().denyAll())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .addFilterAfter(apiProtectionFilter, BearerTokenAuthenticationFilter.class)
                .build();
    }

    @Bean
    JwtDecoder jwtDecoder(
            @Value("${nowline.security.issuer}") String issuer,
            @Value("${nowline.security.audience}") String audience,
            @Value("${nowline.security.hmac-secret}") String hmacSecret,
            Environment environment
    ) {
        NimbusJwtDecoder decoder;
        if (!hmacSecret.isBlank()) {
            boolean localOnly = Arrays.stream(environment.getActiveProfiles())
                    .anyMatch(profile -> profile.equals("local-auth") || profile.equals("test"));
            if (!localOnly) {
                throw new IllegalStateException("NOWLINE_DEV_JWT_SECRET is allowed only in local-auth or test profile");
            }
            byte[] secret = hmacSecret.getBytes(StandardCharsets.UTF_8);
            if (secret.length < 32) {
                throw new IllegalStateException("NOWLINE_DEV_JWT_SECRET must contain at least 32 UTF-8 bytes");
            }
            decoder = NimbusJwtDecoder.withSecretKey(new SecretKeySpec(secret, "HmacSHA256"))
                    .macAlgorithm(org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256)
                    .build();
        } else {
            if (issuer.isBlank()) {
                throw new IllegalStateException("NOWLINE_OIDC_ISSUER is required outside local-auth/test profiles");
            }
            JwtDecoder discovered = JwtDecoders.fromIssuerLocation(issuer);
            if (!(discovered instanceof NimbusJwtDecoder nimbus)) {
                return discovered;
            }
            decoder = nimbus;
        }

        OAuth2TokenValidator<Jwt> audienceValidator = token -> token.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error(
                        "invalid_token", "Required audience is missing", null));
        OAuth2TokenValidator<Jwt> baseValidator = issuer.isBlank()
                ? new JwtTimestampValidator()
                : new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(), new JwtIssuerValidator(issuer));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(baseValidator, audienceValidator));
        return decoder;
    }
}
