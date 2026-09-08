package io.nowline.planner.ai;

import tools.jackson.databind.JsonNode;

public interface AiReviewProvider {
    Result generate(AiReviewRepository.Job job);
    record Result(JsonNode body, Long inputTokens, Long outputTokens) {}
    final class Failure extends RuntimeException {
        final boolean ambiguous;
        final String code;
        public Failure(boolean ambiguous, String code) { super(code); this.ambiguous = ambiguous; this.code = code; }
    }
}
