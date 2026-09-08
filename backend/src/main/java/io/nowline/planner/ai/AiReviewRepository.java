package io.nowline.planner.ai;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;

@Repository
public class AiReviewRepository {
    public static final String POLICY = "2026-09-08";
    public static final String PROMPT = "evidence-only-v1";
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public AiReviewRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    public Settings settings(UUID user) {
        return jdbc.query("SELECT * FROM ai_review_setting WHERE user_id=?", (rs, row) -> new Settings(
                rs.getBoolean("consent") && POLICY.equals(rs.getString("consent_version")), rs.getBoolean("include_reflections"),
                rs.getBoolean("weekly_enabled"), rs.getBoolean("monthly_enabled"), rs.getTime("scheduled_time").toLocalTime().toString()), user.toString())
                .stream().findFirst().orElse(new Settings(false, false, false, false, "08:00"));
    }
    @Transactional
    public Settings saveSettings(UUID user, Settings value) {
        LocalTime time;
        try { time = LocalTime.parse(value.scheduledTime()); }
        catch (RuntimeException e) { throw new AiReviewException(422, "ai-invalid-time", "올바른 알림 시각을 선택해 주세요."); }
        if (time.getSecond() != 0 || time.getNano() != 0) throw new AiReviewException(422, "ai-invalid-time", "시와 분까지만 설정할 수 있어요.");
        jdbc.update("""
                INSERT INTO ai_review_setting(user_id, consent, include_reflections, weekly_enabled, monthly_enabled, scheduled_time, consent_version)
                VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE consent=VALUES(consent), include_reflections=VALUES(include_reflections),
                weekly_enabled=VALUES(weekly_enabled), monthly_enabled=VALUES(monthly_enabled), scheduled_time=VALUES(scheduled_time), consent_version=VALUES(consent_version), updated_at=CURRENT_TIMESTAMP(6)
                """, user.toString(), value.consent(), value.consent() && value.includeReflections(), value.consent() && value.weeklyEnabled(),
                value.consent() && value.monthlyEnabled(), time.toString(), POLICY);
        // The upsert holds this account's settings row until cancellation/refunds commit.
        // Regranting later cannot resurrect a request authorized by the withdrawn consent.
        cancelUnsent(user,!value.consent(),!value.includeReflections());
        return settings(user);
    }
    private Settings lockSettings(UUID user) {
        jdbc.query("SELECT user_id FROM ai_review_setting WHERE user_id=? FOR UPDATE",(rs,row) -> rs.getString(1),user.toString());
        return settings(user);
    }
    private void cancelUnsent(UUID user,boolean all,boolean reflections) {
        if (!all && !reflections) return;
        var rows=jdbc.queryForList("SELECT report_id,budget_month,reserved_usd,input_snapshot FROM ai_review_report WHERE user_id=? AND status IN ('QUEUED','RUNNING') AND provider_started_at IS NULL FOR UPDATE",user.toString());
        Map<String,BigDecimal> refunds=new TreeMap<>();
        for(var row:rows) {
            var snapshot=json.readValue(row.get("input_snapshot").toString(),AiEvidenceService.Snapshot.class);
            if (!all && snapshot.evidence().stream().noneMatch(item -> item.kind().equals("reflection"))) continue;
            int changed=jdbc.update("UPDATE ai_review_report SET status='CANCELLED', error_code='ai-consent-revoked', cost_usd=0, completed_at=CURRENT_TIMESTAMP(6) WHERE report_id=? AND status IN ('QUEUED','RUNNING') AND provider_started_at IS NULL",row.get("report_id"));
            if(changed==1) refunds.merge(row.get("budget_month").toString(),(BigDecimal)row.get("reserved_usd"),BigDecimal::add);
        }
        refunds.forEach((month,amount) -> jdbc.update("UPDATE ai_review_budget_month SET reserved_usd=reserved_usd-? WHERE budget_month=?",amount,month));
    }
    public List<UUID> automaticUsers() {
        return jdbc.query("SELECT user_id FROM ai_review_setting WHERE consent=TRUE AND consent_version=? AND (weekly_enabled=TRUE OR monthly_enabled=TRUE)",
                (rs, row) -> UUID.fromString(rs.getString(1)), POLICY);
    }
    public Instant settingsUpdatedAt(UUID user) {
        return jdbc.queryForObject("SELECT updated_at FROM ai_review_setting WHERE user_id=?",java.sql.Timestamp.class,user.toString()).toInstant();
    }
    public List<Report> list(UUID user, String period, LocalDate start) {
        return jdbc.query("SELECT * FROM ai_review_report WHERE user_id=? AND (? IS NULL OR period=?) AND (? IS NULL OR start_date=?) ORDER BY created_at DESC, version DESC LIMIT 100",
                (rs,row) -> read(rs), user.toString(), period, period, start, start);
    }
    public Optional<Report> find(UUID user, UUID report) {
        return jdbc.query("SELECT * FROM ai_review_report WHERE user_id=? AND report_id=?", (rs,row) -> read(rs), user.toString(), report.toString()).stream().findFirst();
    }
    public Optional<Report> byRequest(UUID user, String request) {
        return jdbc.query("SELECT * FROM ai_review_report WHERE user_id=? AND request_id=?", (rs,row) -> read(rs), user.toString(), request).stream().findFirst();
    }
    @Transactional
    public Report enqueue(UUID user, String request, AiEvidenceService.Snapshot snapshot, AiReviewProperties config) {
        // Settings always precede budget/report writes. A withdrawal cannot miss a concurrent enqueue.
        var consent=lockSettings(user);
        var previous = byRequest(user, request);
        if (previous.isPresent()) return replay(previous.get(), snapshot.period(), snapshot.startDate());
        if (!consent.consent() || !consent.includeReflections() && snapshot.evidence().stream().anyMatch(item -> item.kind().equals("reflection"))) throw AiReviewException.consent();
        String month = YearMonth.now(ZoneOffset.UTC).toString();
        // Acquire the exclusive row lock directly; INSERT IGNORE's shared duplicate-key lock
        // followed by SELECT FOR UPDATE would deadlock simultaneous generators upgrading it.
        jdbc.update("INSERT INTO ai_review_budget_month(budget_month) VALUES(?) ON DUPLICATE KEY UPDATE budget_month=VALUES(budget_month)", month);
        BigDecimal spent = jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month WHERE budget_month=? FOR UPDATE", BigDecimal.class, month);
        long count = jdbc.queryForObject("SELECT COUNT(*) FROM ai_review_report WHERE user_id=? AND budget_month=?", Long.class, user.toString(), month);
        String input = json.writeValueAsString(snapshot);
        int size = input.getBytes(StandardCharsets.UTF_8).length;
        if (size > config.maxInputBytes()) throw new AiReviewException(422, "ai-input-too-large", "분석할 기록이 너무 많아요. 작은 기간을 선택해 주세요.");
        BigDecimal reservation = config.reservation(size);
        if (count >= config.monthlyReportLimit() || spent.add(reservation).compareTo(config.monthlyBudgetUsd()) > 0)
            throw new AiReviewException(429, "ai-budget-exhausted", "이번 달 AI 보고서 사용 한도에 도달했어요.");
        int version = jdbc.queryForObject("SELECT COALESCE(MAX(version),0)+1 FROM ai_review_report WHERE user_id=? AND period=? AND start_date=?", Integer.class,
                user.toString(), snapshot.period(), snapshot.startDate());
        UUID reportId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_review_report(report_id,user_id,request_id,period,start_date,end_date,version,input_snapshot,input_hash,prompt_version,model,
                budget_month,reserved_usd,input_price_per_million,output_price_per_million,max_output_tokens)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, reportId.toString(), user.toString(), request, snapshot.period(), snapshot.startDate(), snapshot.endDate(), version, input, hash(input), PROMPT, config.model(),
                month, reservation, config.inputPrice(), config.outputPrice(), config.maxOutputTokens());
        jdbc.update("UPDATE ai_review_budget_month SET reserved_usd=reserved_usd+? WHERE budget_month=?", reservation, month);
        return find(user, reportId).orElseThrow();
    }
    static Report replay(Report report, String period, LocalDate start) {
        if (!report.period().equals(period) || !report.startDate().equals(start)) throw new AiReviewException(409, "ai-request-conflict", "같은 요청 번호로 다른 기간을 생성할 수 없어요.");
        return report;
    }
    @Transactional
    public Optional<Job> claim() {
        var reports = jdbc.query("SELECT * FROM ai_review_report WHERE status='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED", (rs,row) -> read(rs));
        if (reports.isEmpty()) return Optional.empty();
        Report report = reports.getFirst();
        jdbc.update("UPDATE ai_review_report SET status='RUNNING', started_at=CURRENT_TIMESTAMP(6) WHERE report_id=? AND status='QUEUED'", report.id().toString());
        return jdbc.query("SELECT user_id,model,max_output_tokens FROM ai_review_report WHERE report_id=?", (rs,row) -> new Job(
                UUID.fromString(rs.getString(1)), report, rs.getString(2), rs.getInt(3)), report.id().toString()).stream().findFirst();
    }
    @Transactional
    public boolean beginSend(Job job) {
        // This is the consent/send linearization point. Never keep these locks during HTTP.
        var consent=lockSettings(job.userId());
        var rows=jdbc.queryForList("SELECT status,provider_started_at FROM ai_review_report WHERE report_id=? AND user_id=? FOR UPDATE",job.report().id().toString(),job.userId().toString());
        if(rows.isEmpty() || !"RUNNING".equals(rows.getFirst().get("status")) || rows.getFirst().get("provider_started_at")!=null) return false;
        boolean hasReflections=job.report().inputSnapshot().evidence().stream().anyMatch(item -> item.kind().equals("reflection"));
        if(!consent.consent() || hasReflections && !consent.includeReflections()) {
            cancelUnsent(job.userId(),!consent.consent(),!consent.includeReflections());
            return false;
        }
        return jdbc.update("UPDATE ai_review_report SET provider_started_at=CURRENT_TIMESTAMP(6) WHERE report_id=? AND status='RUNNING' AND provider_started_at IS NULL",job.report().id().toString())==1;
    }
    @Transactional
    public void complete(Job job, JsonNode body, Long inputTokens, Long outputTokens) {
        var rows = jdbc.queryForList("SELECT * FROM ai_review_report WHERE report_id=? AND status='RUNNING' FOR UPDATE", job.report().id().toString());
        if (rows.isEmpty()) return; // Account may have been deleted while a request was in flight.
        var row = rows.getFirst();
        BigDecimal reserved = (BigDecimal) row.get("reserved_usd");
        BigDecimal cost = inputTokens == null || outputTokens == null ? null : ((BigDecimal) row.get("input_price_per_million"))
                .multiply(BigDecimal.valueOf(inputTokens)).add(((BigDecimal) row.get("output_price_per_million")).multiply(BigDecimal.valueOf(outputTokens)))
                .divide(BigDecimal.valueOf(1_000_000), 8, RoundingMode.UP);
        jdbc.update("UPDATE ai_review_report SET status='READY', report_body=?, input_tokens=?, output_tokens=?, cost_usd=?, completed_at=CURRENT_TIMESTAMP(6) WHERE report_id=?",
                json.writeValueAsString(body), inputTokens, outputTokens, cost, job.report().id().toString());
        if (cost != null) jdbc.update("UPDATE ai_review_budget_month SET reserved_usd=reserved_usd-?+? WHERE budget_month=?", reserved, cost, row.get("budget_month"));
    }
    @Transactional
    public void stop(Job job, String status, String code, boolean refund) {
        int changed = jdbc.update("UPDATE ai_review_report SET status=?, error_code=?, completed_at=CURRENT_TIMESTAMP(6) WHERE report_id=? AND status='RUNNING'",
                status, code, job.report().id().toString());
        if (refund && changed == 1) jdbc.update("UPDATE ai_review_budget_month b JOIN ai_review_report r ON b.budget_month=r.budget_month SET b.reserved_usd=b.reserved_usd-r.reserved_usd WHERE r.report_id=? AND r.provider_started_at IS NULL", job.report().id().toString());
    }
    public void expireAmbiguous() {
        jdbc.update("UPDATE ai_review_report SET status='UNKNOWN', error_code='ai-worker-interrupted', completed_at=CURRENT_TIMESTAMP(6) WHERE status='RUNNING' AND started_at<DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 5 MINUTE)");
    }
    private Report read(java.sql.ResultSet rs) throws java.sql.SQLException {
        String body = rs.getString("report_body");
        Long input = rs.getObject("input_tokens", Long.class), output = rs.getObject("output_tokens", Long.class);
        var completed = rs.getTimestamp("completed_at");
        var cost = rs.getBigDecimal("cost_usd");
        return new Report(UUID.fromString(rs.getString("report_id")), rs.getString("request_id"), rs.getString("period"), rs.getObject("start_date",LocalDate.class), rs.getObject("end_date",LocalDate.class),
                rs.getInt("version"), rs.getString("status"), rs.getTimestamp("created_at").toInstant(), completed == null ? null : completed.toInstant(), rs.getString("error_code"),
                json.readValue(rs.getString("input_snapshot"),AiEvidenceService.Snapshot.class), body == null ? null : json.readTree(body),
                input == null || output == null ? null : new Usage(input,output), cost == null ? null : cost.toPlainString());
    }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public record Settings(boolean consent, boolean includeReflections, boolean weeklyEnabled, boolean monthlyEnabled, String scheduledTime) {}
    public record Usage(long inputTokens,long outputTokens) {}
    public record Report(UUID id,String requestId,String period,LocalDate startDate,LocalDate endDate,int version,String status,Instant createdAt,Instant completedAt,String errorCode,
            AiEvidenceService.Snapshot inputSnapshot,JsonNode report,Usage usage,String costUsd) {}
    public record Job(UUID userId,Report report,String model,int maxOutputTokens) {}
}
