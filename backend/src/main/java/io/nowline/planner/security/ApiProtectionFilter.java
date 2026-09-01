package io.nowline.planner.security;

import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;

@Component
public class ApiProtectionFilter extends OncePerRequestFilter {

    private final RateLimitService rateLimits;
    private final ObjectMapper objectMapper;
    private final long maxRequestBytes;

    public ApiProtectionFilter(
            RateLimitService rateLimits,
            ObjectMapper objectMapper,
            @Value("${nowline.security.max-request-bytes:1048576}") long maxRequestBytes
    ) {
        this.rateLimits = rateLimits;
        this.objectMapper = objectMapper;
        this.maxRequestBytes = maxRequestBytes;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/") || "OPTIONS".equals(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        long contentLength = request.getContentLengthLong();
        if (contentLength > maxRequestBytes) {
            problem(response, 413, "request-too-large", "요청 본문은 1MB를 초과할 수 없습니다.");
            return;
        }

        String path = request.getRequestURI();
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String identity = identity(authentication, request);
        int limit = isSensitive(path) ? 30 : isMutation(request) ? 120 : 600;
        RateLimitService.Decision decision = rateLimits.consume(
                hash(identity + ':' + category(request, path)), limit, Duration.ofMinutes(1));
        response.setHeader("RateLimit-Limit", Integer.toString(limit));
        response.setHeader("RateLimit-Remaining", Integer.toString(decision.remaining()));
        response.setHeader("RateLimit-Reset", Long.toString(decision.resetsAt().getEpochSecond()));
        if (!decision.allowed()) {
            long retryAfter = Math.max(1, decision.resetsAt().getEpochSecond() - System.currentTimeMillis() / 1000);
            response.setHeader("Retry-After", Long.toString(retryAfter));
            problem(response, 429, "rate-limit-exceeded", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
            return;
        }
        filterChain.doFilter(request, response);
    }

    private boolean isSensitive(String path) {
        return path.contains("/oauth/") || path.endsWith("/account") || path.contains("/subscriptions");
    }

    private boolean isMutation(HttpServletRequest request) {
        return !request.getMethod().equals("GET") && !request.getMethod().equals("HEAD");
    }

    private String category(HttpServletRequest request, String path) {
        if (isSensitive(path)) return "sensitive";
        return isMutation(request) ? "mutation" : "read";
    }

    private String identity(Authentication authentication, HttpServletRequest request) {
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            return "jwt:" + jwt.getIssuer() + ':' + jwt.getSubject();
        }
        return "remote:" + request.getRemoteAddr();
    }

    private String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private void problem(HttpServletResponse response, int status, String code, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), Map.of(
                "type", "https://nowline.app/problems/" + code,
                "title", status == 429 ? "Too Many Requests" : "Payload Too Large",
                "status", status,
                "detail", detail,
                "code", code));
    }
}
