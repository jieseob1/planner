import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import { PeriodSelector } from '../components/PeriodSelector';
import { PeriodFeedback } from '../components/PeriodFeedback';
import { PeriodReviewEditor } from '../components/PeriodReviewEditor';
import { usePeriods } from '../state/PeriodProvider';
import { usePlanner } from '../state/PlannerProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { toLocalDate } from '../lib/calendarDate';
import { periodRange, rangeLabel, reviewId, shiftPeriod, summarizePeriod } from '../domain/periods';
import { usePeriodRange } from '../state/usePeriodRange';
import { GoalProgress } from './PeriodGoalsScreen';

export function PeriodReviewScreen() {
  const { timeZone } = useTimeZone();
  const today = toLocalDate(new Date(), timeZone);
  const [range, setRange] = usePeriodRange(shiftPeriod(periodRange('week', today), -1));
  const periods = usePeriods();
  const planner = usePlanner();
  const summary = useMemo(() => summarizePeriod(range, [...(periods?.history ?? []), planner], timeZone), [range, periods?.history, planner.tasks, planner.timeBlocks, planner.timeEntries, timeZone]);
  const savedReview = periods?.documents.find(d => !d.deleted && d.review?.id === reviewId(range));
  const goals = savedReview?.goalCheckpoints ?? periods?.documents.filter(d => !d.deleted && d.goal && d.goal.startDate <= range.endDate && d.goal.endDate >= range.startDate).map(d => d.goal!) ?? [];
  const history = periods?.documents.filter(d => !d.deleted && d.review?.period === range.period && d.review.id !== reviewId(range)).sort((a, b) => b.review!.startDate.localeCompare(a.review!.startDate)) ?? [];
  const hours = (minutes: number) => `${Number((minutes / 60).toFixed(1))}시간`;
  const scale = Math.max(1, ...summary.dates.flatMap(([, d]) => [d.plannedMinutes, d.recordedSeconds / 60]));
  return <div className="page period-page">
    <header className="page-header"><div><p className="eyebrow">REVIEW</p><h1>돌아보기</h1><p>한 일을 확인하고, 다음에 바꿀 한 가지를 남겨요.</p></div><div className="period-header-actions">{periods?.ready && <a className="button button--primary" href="#period-review-input">회고 쓰기</a>}<Link className="button button--secondary" to={`/goals?period=${range.period}&date=${shiftPeriod(range, 1).startDate}`}>다음 기간 계획 <ArrowRight size={16} /></Link></div></header>
    <PeriodFeedback />
    <PeriodSelector value={range} today={today} onChange={setRange} />
    <div className="period-summary" aria-label="기간 실행 요약">
      <div><CheckCircle2 size={19} /><span>완료한 일</span><strong>{summary.completed}개</strong></div>
      <div><CalendarDays size={19} /><span>계획한 시간</span><strong>{hours(summary.plannedMinutes)}</strong></div>
      <div><Clock3 size={19} /><span>기록한 시간</span><strong>{summary.recordedSeconds ? hours(summary.recordedSeconds / 60) : '기록 없음'}</strong></div>
    </div>
    <details className="period-hint"><summary>집계 기준 확인</summary><p>중복된 계획 시간은 한 번만 세고 외부 캘린더 일정은 제외합니다. 기록 시간은 기록한 날짜 기준이며 자정을 넘긴 실제 실행 구간과 다를 수 있습니다. 시간을 기록하지 않았다고 목표 달성률이 0%가 되지는 않습니다.</p><p>완료 취소한 일은 제외하며 재완료하면 마지막 완료일에 집계합니다. {summary.undatedCompleted}개 과거 완료 항목은 완료 날짜가 없어 날짜별 집계에서 제외했습니다. 수정·삭제한 실행 기록은 현재 보관된 계획 기준으로 다시 계산됩니다.</p></details>
    {summary.dates.length > 0 && <section className="period-chart" aria-label="날짜별 계획 시간과 기록 시간">
      {summary.dates.map(([date, values]) => <div key={date}><strong>{date.slice(5)}</strong><progress max={scale} value={values.plannedMinutes} aria-label={`${date} 계획 ${values.plannedMinutes}분`} /><progress max={scale} value={values.recordedSeconds / 60} aria-label={`${date} 기록 ${Math.round(values.recordedSeconds / 60)}분`} /><small>계획 {hours(values.plannedMinutes)}</small><small>기록 {hours(values.recordedSeconds / 60)}</small></div>)}
    </section>}
    <div className="period-review-grid">
      <section className="period-panel"><div className="period-section-title"><h2>목표는 얼마나 나아갔나요?</h2></div><p className="period-hint">{savedReview ? '회고를 처음 저장했을 때의 목표 측정값입니다. 이후 목표 수정과 분리해 보관합니다.' : '선택 기간과 겹치는 목표의 현재 측정값입니다. 회고 저장 시 함께 보관합니다.'} 완료 개수·시간과는 별개예요.</p>
        {goals.map(goal => <Link className="period-review-goal" key={goal.id} to={`/goals?period=${goal.period}&date=${goal.startDate}`}><strong>{goal.title}</strong><small>{rangeLabel(goal)}</small><GoalProgress goal={goal} /></Link>)}
        {!goals.length && <p className="period-empty-text">연결된 목표가 없어도 회고를 남길 수 있어요.</p>}
        <Link to={`/goals?period=${range.period}&date=${range.startDate}`}>목표 확인하기 <ArrowRight size={14} /></Link>
      </section>
      {periods?.ready && <PeriodReviewEditor key={reviewId(range)} range={range} />}
    </div>
    <section className="period-panel period-history"><h2>지난 기록</h2>{history.length ? history.map(d => <button key={d.review!.id} type="button" onClick={() => setRange(d.review!)}><CalendarDays size={18} /><span>{rangeLabel(d.review!)}<small>{d.review!.change || d.review!.well || '짧은 기록'}</small></span><small>{d.review!.completed ? '완료' : '초안'}</small><ArrowRight size={16} /></button>) : <p>아직 이 단위의 다른 회고가 없어요. 이전 기간을 선택해 기록할 수 있어요.</p>}</section>
    <details className="period-legacy"><summary>기존 주간 회고</summary><Link to="/review/legacy">기존 지표 갱신 · 이월 · Top 3 회고 열기</Link></details>
  </div>;
}
