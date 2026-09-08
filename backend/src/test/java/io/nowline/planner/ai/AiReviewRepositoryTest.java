package io.nowline.planner.ai;

import com.zaxxer.hikari.*;
import io.nowline.planner.account.*;
import io.nowline.planner.integration.calendar.GoogleCalendarConnectionService;
import io.nowline.planner.persistence.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.*;
import tools.jackson.databind.json.JsonMapper;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.IntStream;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@Testcontainers
class AiReviewRepositoryTest {
    @Container static final MySQLContainer<?> MYSQL=new MySQLContainer<>("mysql:8.4.10").withDatabaseName("ai_review_test")
            .withUsername("nowline").withPassword("nowline").withUrlParam("serverTimezone","UTC").withUrlParam("preserveInstants","true")
            .withCommand("--character-set-server=utf8mb4","--collation-server=utf8mb4_0900_as_ci","--default-time-zone=+00:00","--log-bin-trust-function-creators=1");
    static HikariDataSource pool; static JdbcTemplate jdbc; static TransactionTemplate tx; static AiReviewRepository repository;
    static final JsonMapper JSON=new JsonMapper();
    UUID user;
    @BeforeAll static void start() {
        var config=new HikariConfig(); config.setJdbcUrl(MYSQL.getJdbcUrl()); config.setUsername(MYSQL.getUsername()); config.setPassword(MYSQL.getPassword());
        pool=new HikariDataSource(config); jdbc=new JdbcTemplate(pool); tx=new TransactionTemplate(new DataSourceTransactionManager(pool));
        Flyway.configure().dataSource(pool).load().migrate(); repository=new AiReviewRepository(jdbc,JSON);
    }
    @AfterAll static void close() { if(pool!=null) pool.close(); }
    @BeforeEach void setup() {
        jdbc.update("DELETE FROM ai_review_report"); jdbc.update("DELETE FROM ai_review_setting"); jdbc.update("DELETE FROM ai_review_budget_month");
        jdbc.update("DELETE FROM app_user WHERE oidc_issuer='urn:ai-review-test'");
        user=createUser(); repository.saveSettings(user,new AiReviewRepository.Settings(true,false,false,false,"08:00"));
    }
    UUID createUser() { UUID id=UUID.randomUUID(); jdbc.update("INSERT INTO app_user(user_id,oidc_issuer,oidc_subject,display_name) VALUES(?,'urn:ai-review-test',?,'test')",id.toString(),id.toString()); return id; }
    AiReviewRepository.Report enqueue(String request) { return tx.execute(s -> repository.enqueue(user,request,AiReviewServiceTest.snapshot(),AiReviewServiceTest.config(true))); }
    @Test void concurrentDuplicatesReserveOnceAndClaimOnce() throws Exception {
        try(var workers=Executors.newFixedThreadPool(8)) {
            var futures=workers.invokeAll(IntStream.range(0,8).<Callable<AiReviewRepository.Report>>mapToObj(i -> () -> enqueue("same")).toList());
            Set<UUID> ids=new HashSet<>(); for(var result:futures) ids.add(result.get().id());
            assertThat(ids).hasSize(1); assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_review_report",Long.class)).isEqualTo(1);
            var claims=workers.invokeAll(IntStream.range(0,8).<Callable<Boolean>>mapToObj(i -> () -> tx.execute(s -> repository.claim().isPresent())).toList());
            int count=0; for(var result:claims) if(result.get()) count++;
            assertThat(count).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class))
                    .isEqualByComparingTo(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_report",BigDecimal.class));
        }
    }
    @Test void separateVersionsKeepImmutableEvidenceAndEnforceAccountIsolation() {
        var first=enqueue("v1");
        var source=AiReviewServiceTest.snapshot();
        var changed=new AiEvidenceService.Snapshot(source.period(),source.startDate(),source.endDate(),source.timezone(),source.capturedAt().plusSeconds(60),
                new AiEvidenceService.Metrics(9,0,0),List.of(new AiEvidenceService.Evidence("task:changed","completed-task","2026-09-01","changed evidence",Map.of())));
        var second=tx.execute(s -> repository.enqueue(user,"v2",changed,AiReviewServiceTest.config(true)));
        assertThat(first.version()).isEqualTo(1); assertThat(second.version()).isEqualTo(2);
        assertThat(repository.find(user,first.id()).orElseThrow().inputSnapshot()).isEqualTo(first.inputSnapshot());
        assertThat(second.inputSnapshot().metrics().completedTasks()).isEqualTo(9);
        assertThat(first.inputSnapshot().metrics().completedTasks()).isEqualTo(1);
        assertThat(repository.list(createUser(),null,null)).isEmpty(); assertThat(repository.find(createUser(),first.id())).isEmpty();
        assertThat(enqueue("v1").id()).isEqualTo(first.id());
        assertThatThrownBy(() -> AiReviewRepository.replay(first,"month",LocalDate.parse("2026-08-01"))).isInstanceOf(AiReviewException.class);
    }
    @Test void accountQuotaAndGlobalBudgetRejectBeforeClaimOrSpending() {
        var base=AiReviewServiceTest.config(true);
        var one=new AiReviewProperties(true,base.apiKey(),base.model(),base.monthlyBudgetUsd(),base.inputPrice(),base.outputPrice(),1,32768,1600);
        tx.execute(s -> repository.enqueue(user,"one",AiReviewServiceTest.snapshot(),one));
        assertThatThrownBy(() -> tx.execute(s -> repository.enqueue(user,"two",AiReviewServiceTest.snapshot(),one))).hasMessageContaining("한도");
        var tiny=new AiReviewProperties(true,base.apiKey(),base.model(),new BigDecimal("0.00000001"),base.inputPrice(),base.outputPrice(),8,32768,1600);
        assertThatThrownBy(() -> tx.execute(s -> repository.enqueue(user,"tiny",AiReviewServiceTest.snapshot(),tiny))).hasMessageContaining("한도");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_review_report",Long.class)).isEqualTo(1);
    }
    @Test void oversizedInputAndRevokedConsentCannotReserveBudget() {
        var source=AiReviewServiceTest.snapshot(); var base=AiReviewServiceTest.config(true);
        var large=new AiEvidenceService.Snapshot(source.period(),source.startDate(),source.endDate(),source.timezone(),source.capturedAt(),source.metrics(),
                List.of(new AiEvidenceService.Evidence("large","completed-task",null,"x".repeat(33000),Map.of())));
        assertThatThrownBy(() -> tx.execute(s -> repository.enqueue(user,"large",large,base))).hasMessageContaining("너무 많아요");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_review_report",Long.class)).isZero();
        repository.saveSettings(user,new AiReviewRepository.Settings(false,true,true,true,"08:00"));
        assertThat(repository.settings(user)).isEqualTo(new AiReviewRepository.Settings(false,false,false,false,"08:00"));
        assertThatThrownBy(() -> enqueue("revoked")).hasMessageContaining("동의");
    }
    @Test void usageUnknownIsNullAndInterruptedRequestNeverReturnsToQueue() {
        var first=enqueue("missing-usage");
        var job=tx.execute(s -> repository.claim().orElseThrow());
        tx.executeWithoutResult(s -> repository.complete(job,JSON.readTree("{}"),null,null));
        var ready=repository.find(user,first.id()).orElseThrow(); assertThat(ready.status()).isEqualTo("READY");
        assertThat(ready.usage()).isNull(); assertThat(ready.costUsd()).isNull();
        var second=enqueue("interrupted"); tx.execute(s -> repository.claim());
        jdbc.update("UPDATE ai_review_report SET started_at=DATE_SUB(CURRENT_TIMESTAMP(6),INTERVAL 6 MINUTE) WHERE report_id=?",second.id().toString());
        repository.expireAmbiguous();
        assertThat(repository.find(user,second.id()).orElseThrow().status()).isEqualTo("UNKNOWN");
        Optional<AiReviewRepository.Job> retried=tx.execute(s -> repository.claim());
        assertThat(retried).isEmpty();
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isGreaterThan(BigDecimal.ZERO);
    }
    @Test void verifiedUsageSettlesButConsentCancellationRefundsReservation() {
        var first=enqueue("settle"); var job=tx.execute(s -> repository.claim().orElseThrow());
        tx.executeWithoutResult(s -> repository.complete(job,JSON.readTree("{}"),100L,50L));
        assertThat(repository.find(user,first.id()).orElseThrow().costUsd()).isEqualTo("0.00020000");
        enqueue("cancel"); var cancelled=tx.execute(s -> repository.claim().orElseThrow());
        tx.executeWithoutResult(s -> repository.stop(cancelled,"CANCELLED","ai-consent-revoked",true));
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isEqualByComparingTo("0.0002");
    }
    @Test void exportIncludesReportsAndAccountDeletionCascadesButKeepsAnonymousBudget() {
        var report=enqueue("export");
        var account=new AccountService(jdbc,mock(PlannerRepository.class),mock(PlanHistoryRepository.class),mock(UserPreferenceService.class),
                mock(GoogleCalendarConnectionService.class),mock(AccountDeletionRepository.class),mock(AccountEntitlementService.class));
        var exported=account.export(user);
        assertThat(exported).containsKeys("aiReviewSettings","aiReviewReports");
        assertThat(exported.get("aiReviewReports").toString()).contains(report.id().toString(),"input_snapshot");
        jdbc.update("DELETE FROM app_user WHERE user_id=?",user.toString());
        assertThat(repository.find(user,report.id())).isEmpty(); assertThat(repository.settings(user).consent()).isFalse();
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isGreaterThan(BigDecimal.ZERO);
    }
    @Test void withdrawalThenRegrantNeverRevivesQueuedOrClaimedUnsentReports() {
        var claimed=enqueue("claimed-before-withdrawal");
        var job=tx.execute(s -> repository.claim().orElseThrow());
        var queued=enqueue("queued-before-withdrawal");
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(false,false,false,false,"08:00")));
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(true,false,false,false,"08:00")));
        assertThat(repository.find(user,claimed.id()).orElseThrow().status()).isEqualTo("CANCELLED");
        assertThat(repository.find(user,queued.id()).orElseThrow().status()).isEqualTo("CANCELLED");
        Boolean permitted=tx.execute(s -> repository.beginSend(job));
        assertThat(permitted).isFalse();
        assertThat(enqueue("queued-before-withdrawal").status()).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isEqualByComparingTo(BigDecimal.ZERO);
        enqueue("fresh-positive-control");
        var fresh=tx.execute(s -> repository.claim().orElseThrow());
        Boolean freshAllowed=tx.execute(s -> repository.beginSend(fresh));
        assertThat(freshAllowed).isTrue();
    }
    @Test void reflectionWithdrawalCancelsOnlyReflectedUnsentSubsetAndNeverResurrectsIt() {
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(true,true,false,false,"08:00")));
        var source=AiReviewServiceTest.snapshot();
        var reflected=new AiEvidenceService.Snapshot(source.period(),source.startDate(),source.endDate(),source.timezone(),source.capturedAt(),source.metrics(),
                List.of(new AiEvidenceService.Evidence("reflection:test","reflection","2026-09-01","private reflection",Map.of("note","private"))));
        var reflection=tx.execute(s -> repository.enqueue(user,"reflection",reflected,AiReviewServiceTest.config(true)));
        var ordinary=enqueue("ordinary");
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(true,false,false,false,"08:00")));
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(true,true,false,false,"08:00")));
        assertThat(repository.find(user,reflection.id()).orElseThrow().status()).isEqualTo("CANCELLED");
        assertThat(repository.find(user,ordinary.id()).orElseThrow().status()).isEqualTo("QUEUED");
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class))
                .isEqualByComparingTo(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_report WHERE report_id=?",BigDecimal.class,ordinary.id().toString()));
        var next=tx.execute(s -> repository.claim().orElseThrow());
        assertThat(next.report().id()).isEqualTo(ordinary.id());
    }
    @Test void withdrawalRacingWithClaimAlwaysBlocksUnsentWorkButDoesNotRefundStartedProviderCall() throws Exception {
        var report=enqueue("claim-race");
        var start=new CountDownLatch(1);
        try(var workers=Executors.newFixedThreadPool(2)) {
            var claim=workers.submit(() -> { start.await(); return tx.execute(s -> repository.claim()); });
            var withdraw=workers.submit(() -> { start.await(); tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(false,false,false,false,"08:00"))); return true; });
            start.countDown();
            var job=claim.get(5,TimeUnit.SECONDS); withdraw.get(5,TimeUnit.SECONDS);
            tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(true,false,false,false,"08:00")));
            assertThat(repository.find(user,report.id()).orElseThrow().status()).isEqualTo("CANCELLED");
            if(job.isPresent()) { Boolean permitted=tx.execute(s -> repository.beginSend(job.get())); assertThat(permitted).isFalse(); }
        }
        enqueue("started-positive-control");
        var started=tx.execute(s -> repository.claim().orElseThrow());
        Boolean permitted=tx.execute(s -> repository.beginSend(started)); assertThat(permitted).isTrue();
        BigDecimal before=jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class);
        tx.executeWithoutResult(s -> repository.saveSettings(user,new AiReviewRepository.Settings(false,false,false,false,"08:00")));
        assertThat(repository.find(user,started.report().id()).orElseThrow().status()).isEqualTo("RUNNING");
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isEqualByComparingTo(before);
        tx.executeWithoutResult(s -> repository.stop(started,"UNKNOWN","provider-result-unknown",true));
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM ai_review_budget_month",BigDecimal.class)).isEqualByComparingTo(before);
    }
}
