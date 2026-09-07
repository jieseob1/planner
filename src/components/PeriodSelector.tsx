import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periods, periodLabels, periodRange, rangeLabel, shiftPeriod, type PeriodRange } from '../domain/periods';

export function PeriodSelector({ value, today, onChange }: { value: PeriodRange; today: string; onChange: (range: PeriodRange) => void }) {
  return <div className="period-selector">
    <div className="period-segments" role="group" aria-label="기간 단위">
      {periods.map(period => <button key={period} type="button" aria-pressed={period === value.period} onClick={() => onChange(periodRange(period, value.startDate))}>{periodLabels[period]}</button>)}
    </div>
    <div className="period-selector__dates">
      <button type="button" aria-label="이전 기간" disabled={value.startDate <= '1900-01-07'} onClick={() => onChange(shiftPeriod(value, -1))}><ChevronLeft size={18} /></button>
      <span>{rangeLabel(value)}</span>
      <button type="button" aria-label="다음 기간" disabled={value.endDate >= '9998-12-25'} onClick={() => onChange(shiftPeriod(value, 1))}><ChevronRight size={18} /></button>
      <button type="button" className="period-now" onClick={() => onChange(periodRange(value.period, today))}>현재 기간</button>
    </div>
  </div>;
}
