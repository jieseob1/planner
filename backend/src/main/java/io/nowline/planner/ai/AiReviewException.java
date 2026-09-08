package io.nowline.planner.ai;

final class AiReviewException extends RuntimeException {
    final int status;
    final String code;
    AiReviewException(int status, String code, String message) { super(message); this.status = status; this.code = code; }
    static AiReviewException unavailable() { return new AiReviewException(503, "ai-not-configured", "운영자가 AI 제공자와 예산을 설정한 뒤 사용할 수 있어요."); }
    static AiReviewException consent() { return new AiReviewException(403, "ai-consent-required", "AI 분석 동의가 필요해요."); }
}
