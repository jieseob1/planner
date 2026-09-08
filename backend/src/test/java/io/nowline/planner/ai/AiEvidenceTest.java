package io.nowline.planner.ai;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.domain.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class AiEvidenceTest {
    @Test void deduplicatesActiveBeforeHistoryAndExcludesExternalAndPrivateNotes() {
        var source=PlannerFixtures.snapshot();
        var done = new PlannerSnapshot.Task("same", "완료 제목", null,30, PlannerSnapshot.TaskStatus.DONE,false,0,"SECRET-NOTE",Instant.parse("2026-08-31T15:30:00Z"));
        var old = new PlannerSnapshot.Task("same", "옛 제목",null,30,PlannerSnapshot.TaskStatus.DONE,false,0,null,Instant.parse("2026-08-30T00:00:00Z"));
        var blocks=List.of(new PlannerSnapshot.TimeBlock("a",null,"계획",PlannerSnapshot.DayKey.TUE,600,60,false,0,LocalDate.parse("2026-09-01")),
                new PlannerSnapshot.TimeBlock("b",null,"겹침",PlannerSnapshot.DayKey.TUE,630,60,false,0,LocalDate.parse("2026-09-01")),
                new PlannerSnapshot.TimeBlock("g",null,"PRIVATE-GOOGLE",PlannerSnapshot.DayKey.TUE,700,60,true,0,LocalDate.parse("2026-09-01")));
        var entries=List.of(new PlannerSnapshot.TimeEntry("e","same",1200,PlannerSnapshot.TimeSource.TIMER,Instant.parse("2026-08-31T15:30:00Z"),"SECRET-EVIDENCE"));
        var active=new PlannerSnapshot(1,source.plan(),0,List.of(done),blocks,entries,List.of(),null,source.review());
        var history=new PlannerSnapshot(1,source.plan(),0,List.of(old),blocks,entries,List.of(),null,source.review());
        var result=AiEvidenceService.aggregate("month",LocalDate.parse("2026-09-01"),LocalDate.parse("2026-09-30"),ZoneId.of("Asia/Seoul"),Instant.now(),List.of(active,history),List.of(),false);
        assertThat(result.metrics()).isEqualTo(new AiEvidenceService.Metrics(1,90,1200));
        assertThat(result.evidence()).hasSize(4);
        assertThat(result.toString()).doesNotContain("SECRET", "PRIVATE-GOOGLE", "옛 제목");
    }
    @Test void honorsLeapMonthAndYearCrossingCanonicalWeeks() {
        assertThat(AiEvidenceService.end("month",LocalDate.parse("2024-02-01"))).isEqualTo(LocalDate.parse("2024-02-29"));
        assertThat(AiEvidenceService.end("week",LocalDate.parse("2025-12-29"))).isEqualTo(LocalDate.parse("2026-01-04"));
        assertThatThrownBy(() -> AiEvidenceService.end("week",LocalDate.parse("2026-09-01"))).isInstanceOf(AiReviewException.class);
        assertThatThrownBy(() -> AiEvidenceService.end("year",LocalDate.parse("2026-01-01"))).isInstanceOf(AiReviewException.class);
    }
    @Test void undatedCompletionIsNotInventedAndReflectionsRequireSeparateConsent() {
        var source=PlannerFixtures.snapshot();
        var done=new PlannerSnapshot.Task("done","done",null,30,PlannerSnapshot.TaskStatus.DONE,false,0,null);
        var snap=new PlannerSnapshot(1,source.plan(),0,List.of(done),List.of(),List.of(),List.of(),null,source.review());
        var review=new PeriodDocument(1,null,new PeriodDocument.Review("review-week-2026-08-31",PeriodDocument.Period.week,
                LocalDate.parse("2026-08-31"),LocalDate.parse("2026-09-06"),"PRIVATE-REFLECTION","","","",true),false,Instant.now(),List.of());
        var without=AiEvidenceService.aggregate("week",review.review().startDate(),review.review().endDate(),ZoneOffset.UTC,Instant.now(),List.of(snap),List.of(review),false);
        var with=AiEvidenceService.aggregate("week",review.review().startDate(),review.review().endDate(),ZoneOffset.UTC,Instant.now(),List.of(snap),List.of(review),true);
        assertThat(without.evidence()).isEmpty(); assertThat(without.metrics().completedTasks()).isZero();
        assertThat(with.evidence()).hasSize(1); assertThat(with.toString()).contains("PRIVATE-REFLECTION");
    }
    @Test void binaryGoalIncludesDoneAndMeasurementWithoutLeakingNoteOrClaimingHistoricalValue() {
        var start=LocalDate.parse("2026-09-01"); var end=LocalDate.parse("2026-09-30");
        var goal=new PeriodDocument.Goal("goal-binary","완료형 목표",PeriodDocument.Period.month,start,end,null,PeriodDocument.Measurement.completion,
                java.math.BigDecimal.ZERO,null,java.math.BigDecimal.ONE,"",true,"SECRET-GOAL-NOTE",List.of());
        var document=new PeriodDocument(1,goal,null,false,Instant.parse("2026-10-02T00:00:00Z"),List.of());
        var result=AiEvidenceService.aggregate("month",start,end,ZoneOffset.UTC,Instant.now(),List.of(),List.of(document),false);
        assertThat(result.evidence()).hasSize(1);
        assertThat(result.evidence().getFirst().details()).containsEntry("done",true).containsEntry("measurement","completion")
                .containsEntry("baseline",java.math.BigDecimal.ZERO).containsEntry("meaning","current-value-at-capture-not-period-end");
        assertThat(result.toString()).doesNotContain("SECRET-GOAL-NOTE");
    }
}
