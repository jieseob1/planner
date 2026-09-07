import { Link } from 'react-router-dom';
import { ArrowRight, Target } from 'lucide-react';
import { usePeriods } from '../state/PeriodProvider';
import { goalProgress, periodLabels, periodRange, reviewId } from '../domain/periods';
import { PeriodReviewEditor } from './PeriodReviewEditor';
import { PeriodFeedback } from './PeriodFeedback';
export function TodayGoalStrip({ date }: { date: string }) {
  const periods = usePeriods();
  if (!periods) return null;
  const goals = periods.documents.filter(d => !d.deleted && d.goal && d.goal.startDate <= date && d.goal.endDate >= date).sort((a, b) => a.goal!.endDate.localeCompare(b.goal!.endDate));
  return <div className="today-period-context"><PeriodFeedback />{periods.ready && <div className="today-goal-strip"><Target size={19} /><div>{goals.length ? goals.slice(0, 3).map(d => <Link key={d.goal!.id} to={`/goals?period=${d.goal!.period}&date=${d.goal!.startDate}`}><small>{periodLabels[d.goal!.period]} 목표</small><strong>{d.goal!.title}</strong><span>{goalProgress(d.goal!) === null ? '미측정' : `${goalProgress(d.goal!)}%`}</span></Link>) : <span>목표 없이 시작해도 좋아요. 필요할 때 기간별 목표를 연결하세요.</span>}</div><Link to="/goals" aria-label="기간별 목표 보기"><ArrowRight size={19} /></Link></div>}</div>;
}
export function TodayReview({ date, expanded = false }: { date: string; expanded?: boolean }) {
  const periods = usePeriods();
  const range = periodRange('day', date);
  return periods?.ready ? <details className="today-period-review" open={expanded}><summary>하루 마무리 · {date}</summary><PeriodReviewEditor key={reviewId(range)} range={range} /></details> : null;
}
