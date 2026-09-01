package io.nowline.planner.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
public class WebConfiguration implements WebMvcConfigurer {

    private final String[] allowedOriginPatterns;

    public WebConfiguration(@Value("${nowline.cors.allowed-origin-patterns}") List<String> allowedOriginPatterns) {
        this.allowedOriginPatterns = allowedOriginPatterns.stream()
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toArray(String[]::new);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOriginPatterns)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders(
                        HttpHeaders.CONTENT_TYPE,
                        HttpHeaders.AUTHORIZATION,
                        HttpHeaders.IF_MATCH,
                        HttpHeaders.IF_NONE_MATCH,
                        "Idempotency-Key")
                .exposedHeaders(HttpHeaders.ETAG, HttpHeaders.LOCATION)
                .allowCredentials(false)
                .maxAge(3600);
    }
}
