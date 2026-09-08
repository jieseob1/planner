package io.nowline.planner.ai;

import io.nowline.planner.security.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/v1/ai-reviews")
public class AiReviewController {
    private final CurrentUserService users;
    private final AiReviewProperties config;
    private final AiReviewRepository repository;
    private final AiReviewService service;
    public AiReviewController(CurrentUserService users,AiReviewProperties config,AiReviewRepository repository,AiReviewService service) {
        this.users=users; this.config=config; this.repository=repository; this.service=service;
    }
    @GetMapping("/config")
    ResponseEntity<Configuration> config(@AuthenticationPrincipal Jwt jwt) {
        return ok(new Configuration(config.configured(),"OpenAI",config.configured()?config.model():null,AiReviewRepository.POLICY,
                repository.settings(users.resolve(jwt)),config.monthlyReportLimit()));
    }
    @PutMapping("/settings")
    ResponseEntity<AiReviewRepository.Settings> settings(@AuthenticationPrincipal Jwt jwt,@RequestBody AiReviewRepository.Settings settings) {
        return ok(repository.saveSettings(users.resolve(jwt),settings));
    }
    @GetMapping("/reports")
    ResponseEntity<Map<String,Object>> list(@AuthenticationPrincipal Jwt jwt,@RequestParam(required=false) String period,@RequestParam(required=false) LocalDate startDate) {
        return ok(Map.of("reports",repository.list(users.resolve(jwt),period,startDate)));
    }
    @GetMapping("/reports/{id}")
    ResponseEntity<AiReviewRepository.Report> get(@AuthenticationPrincipal Jwt jwt,@PathVariable UUID id) {
        return ok(repository.find(users.resolve(jwt),id).orElseThrow(() -> new AiReviewException(404,"ai-report-not-found","보고서를 찾을 수 없어요.")));
    }
    @PostMapping("/reports")
    ResponseEntity<AiReviewRepository.Report> request(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody Request request) {
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(service.request(users.resolve(jwt),request.period(),request.startDate(),request.requestId().toString()));
    }
    @ExceptionHandler(AiReviewException.class)
    ResponseEntity<Map<String,String>> error(AiReviewException error) {
        return ResponseEntity.status(error.status).cacheControl(CacheControl.noStore()).body(Map.of("code",error.code,"message",error.getMessage()));
    }
    private <T> ResponseEntity<T> ok(T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
    public record Request(@NotNull String period,@NotNull LocalDate startDate,@NotNull UUID requestId) {}
    public record Configuration(boolean configured,String provider,String model,String policyVersion,AiReviewRepository.Settings settings,int monthlyReportLimit) {}
}
