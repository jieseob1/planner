package io.nowline.planner.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.math.BigDecimal;

@Component
public record AiReviewProperties(
        @Value("${nowline.ai.enabled:false}") boolean enabled,
        @Value("${nowline.ai.api-key:}") String apiKey,
        @Value("${nowline.ai.model:}") String model,
        @Value("${nowline.ai.monthly-budget-usd:0}") BigDecimal monthlyBudgetUsd,
        @Value("${nowline.ai.input-price-per-million:0}") BigDecimal inputPrice,
        @Value("${nowline.ai.output-price-per-million:0}") BigDecimal outputPrice,
        @Value("${nowline.ai.monthly-report-limit:8}") int monthlyReportLimit,
        @Value("${nowline.ai.max-input-bytes:32768}") int maxInputBytes,
        @Value("${nowline.ai.max-output-tokens:1600}") int maxOutputTokens) {
    public boolean configured() {
        return enabled && apiKey != null && !apiKey.isBlank() && model != null && model.matches("[a-zA-Z0-9._-]{1,100}")
                && monthlyBudgetUsd.signum() > 0 && inputPrice.signum() > 0 && outputPrice.signum() > 0
                && monthlyReportLimit > 0 && monthlyReportLimit <= 100
                && maxInputBytes >= 1024 && maxInputBytes <= 131072
                && maxOutputTokens >= 256 && maxOutputTokens <= 8192;
    }
    public BigDecimal reservation(int inputBytes) {
        // UTF-8 byte upper bound with generous schema/message overhead; no tools or images.
        return inputPrice.multiply(BigDecimal.valueOf(inputBytes * 2L + 8192))
                .add(outputPrice.multiply(BigDecimal.valueOf(maxOutputTokens)))
                .divide(BigDecimal.valueOf(1_000_000), 8, java.math.RoundingMode.UP);
    }
    @Override public String toString() { return "AiReviewProperties[credentials=redacted]"; }
}
