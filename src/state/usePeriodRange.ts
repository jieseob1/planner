import { useSearchParams } from 'react-router-dom';
import { isLocalDate } from '../lib/calendarDate';
import { periodRange, periods, type Period, type PeriodRange } from '../domain/periods';
/** The URL is the selected-period state, so back/forward and shared links agree. */
export function usePeriodRange(defaultRange: PeriodRange): [PeriodRange, (range: PeriodRange) => void] {
  const [params, setParams] = useSearchParams();
  const kind = params.get('period') as Period;
  const date = params.get('date');
  const range = periodRange(periods.includes(kind) ? kind : defaultRange.period, isLocalDate(date) ? date : defaultRange.startDate);
  return [range, next => setParams({ period: next.period, date: next.startDate })];
}
