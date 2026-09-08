package io.nowline.planner.ai;

import org.springframework.stereotype.Service;
import java.time.LocalDate;
import java.util.UUID;

@Service
public class AiReviewService {
    private final AiReviewProperties config;
    private final AiReviewRepository repository;
    private final AiEvidenceService evidence;
    public AiReviewService(AiReviewProperties config, AiReviewRepository repository, AiEvidenceService evidence) {
        this.config = config; this.repository = repository; this.evidence = evidence;
    }
    public AiReviewRepository.Report request(UUID user, String period, LocalDate start, String request) {
        AiEvidenceService.end(period, start);
        var previous = repository.byRequest(user, request);
        if (previous.isPresent()) return AiReviewRepository.replay(previous.get(),period,start);
        if (!config.configured()) throw AiReviewException.unavailable();
        var settings = repository.settings(user);
        if (!settings.consent()) throw AiReviewException.consent();
        var snapshot = evidence.capture(user, period, start, settings.includeReflections());
        if (snapshot.evidence().isEmpty()) throw new AiReviewException(422, "ai-no-evidence", "보고서를 만들 기록이 아직 없어요.");
        return repository.enqueue(user, request, snapshot, config);
    }
}
