package io.nowline.planner.ai;

import io.nowline.planner.account.UserPreferenceService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import java.time.*;
import java.util.*;

@Component
@ConditionalOnProperty(name="nowline.workers.enabled", havingValue="true", matchIfMissing=true)
public class AiReviewWorker {
    private final AiReviewProperties config;
    private final AiReviewRepository repository;
    private final AiReviewProvider provider;
    private final AiReviewService service;
    private final UserPreferenceService preferences;
    public AiReviewWorker(AiReviewProperties config,AiReviewRepository repository,AiReviewProvider provider,AiReviewService service,UserPreferenceService preferences) {
        this.config=config; this.repository=repository; this.provider=provider; this.service=service; this.preferences=preferences;
    }
    @Scheduled(fixedDelayString="${nowline.ai.dispatch-delay-ms:10000}")
    public void dispatch() {
        if (!config.configured()) return;
        var job = repository.claim().orElse(null);
        if (job == null) return;
        if (!repository.beginSend(job)) return;
        try {
            var result = provider.generate(job); // Claim transaction ended before any network request.
            validate(result.body(), job.report().inputSnapshot());
            if (result.inputTokens() != null && (result.inputTokens() <= 0 || result.inputTokens() > config.maxInputBytes() * 2L + 8192)
                    || result.outputTokens() != null && (result.outputTokens() <= 0 || result.outputTokens() > job.maxOutputTokens()))
                throw new AiReviewProvider.Failure(true,"ai-usage-not-verified");
            repository.complete(job,result.body(),result.inputTokens(),result.outputTokens());
        } catch (AiReviewProvider.Failure e) {
            repository.stop(job,e.ambiguous ? "UNKNOWN" : "FAILED",e.code,false);
        } catch (RuntimeException e) {
            // Never silently repeat a call that might have incurred cost.
            repository.stop(job,"UNKNOWN","ai-result-not-verified",false);
        }
    }
    @Scheduled(fixedDelayString="${nowline.ai.schedule-delay-ms:60000}")
    public void schedule() {
        schedule(Instant.now());
    }
    void schedule(Instant instant) {
        if (!config.configured()) return;
        for (UUID user : repository.automaticUsers()) {
            var settings = repository.settings(user);
            var now = instant.atZone(ZoneId.of(preferences.get(user).timezone()));
            LocalTime time = LocalTime.parse(settings.scheduledTime());
            Instant target = now.toLocalDate().atTime(time).atZone(now.getZone()).toInstant();
            long elapsed = Duration.between(target,instant).toMinutes();
            if (instant.isBefore(target) || elapsed >= 120 || repository.settingsUpdatedAt(user).isAfter(target)) continue;
            if (settings.weeklyEnabled() && now.getDayOfWeek() == DayOfWeek.MONDAY) requestAutomatic(user,"week",now.toLocalDate().minusWeeks(1));
            if (settings.monthlyEnabled() && now.getDayOfMonth() == 1) requestAutomatic(user,"month",now.toLocalDate().minusMonths(1));
        }
    }
    private void requestAutomatic(UUID user,String period,LocalDate start) {
        try { service.request(user,period,start,"automatic:"+period+":"+start); }
        catch (AiReviewException ignored) { /* No evidence/quota/consent: do not call provider or log private input. */ }
    }
    @Scheduled(fixedDelayString="${nowline.ai.recovery-delay-ms:60000}")
    public void recover() { repository.expireAmbiguous(); }
    static void validate(JsonNode body,AiEvidenceService.Snapshot snapshot) {
        if (body == null || !body.isObject() || body.size()!=3 || !body.has("summary") || !body.has("observations") || !body.has("suggestions")
                || !text(body.path("summary"),2000)) throw new AiReviewProvider.Failure(false,"ai-invalid-report");
        Set<String> allowed = new HashSet<>(); snapshot.evidence().forEach(e -> allowed.add(e.id()));
        for (String field : List.of("observations","suggestions")) {
            var values=body.path(field);
            if (!values.isArray() || values.size()>(field.equals("suggestions") ? 3 : 8) || field.equals("observations") && values.isEmpty()) throw new AiReviewProvider.Failure(false,"ai-invalid-report");
            for (var item:values) {
                var refs=item.path("evidenceIds");
                if (!item.isObject() || item.size()!=2 || !text(item.path("text"),1000) || !refs.isArray() || refs.isEmpty() || refs.size()>10)
                    throw new AiReviewProvider.Failure(false,"ai-invalid-report");
                for (var ref:refs) if (!ref.isTextual() || !allowed.contains(ref.asText())) throw new AiReviewProvider.Failure(false,"ai-invalid-evidence-reference");
            }
        }
    }
    private static boolean text(JsonNode value,int max) { return value.isTextual() && !value.asText().isBlank() && value.asText().length()<=max; }
}
