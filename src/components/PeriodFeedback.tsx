import { usePeriods } from '../state/PeriodProvider';
export function PeriodFeedback() {
  const periods = usePeriods();
  if (!periods) return null;
  if (periods.error) return <div className="period-feedback" role="alert"><span>{periods.error}</span><button type="button" onClick={() => void periods.reload()}>다시 불러오기</button></div>;
  return periods.ready ? null : <p role="status">목표와 회고를 불러오고 있습니다…</p>;
}
