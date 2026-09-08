import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import type { TimeBlock } from '../domain/types';
import { addLocalDateDays, getWeekStartDate, isLocalDate, weekDayMeta } from '../lib/calendarDate';
import { formatClock } from '../lib/format';
import './MonthCalendar.css';

/** Calendar-only arithmetic: never interpret a stored local date as a UTC instant. */
export function shiftCalendarMonth(date: string, amount: number) {
  const [year, month] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
export function calendarMonthDates(date: string) {
  const first = `${date.slice(0, 7)}-01`;
  const start = getWeekStartDate(first);
  const last = addLocalDateDays(shiftCalendarMonth(first, 1), -1);
  const lastSunday = addLocalDateDays(getWeekStartDate(last), 6);
  const dates: string[] = [];
  for (let day = start; day <= lastSunday; day = addLocalDateDays(day, 1)) dates.push(day);
  return dates;
}
const dateLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
};

interface MonthCalendarProps {
  today: string;
  initialDate?: string;
  blocks: TimeBlock[];
  minDate?: string;
  maxDate?: string;
  onAdd: (date: string) => void;
  onEdit: (block: TimeBlock) => void;
  onSelectDate?: (date: string) => void;
}

export function MonthCalendar({ today, initialDate = today, blocks, minDate, maxDate, onAdd, onEdit, onSelectDate }: MonthCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [month, setMonth] = useState(`${initialDate.slice(0, 7)}-01`);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const days = useMemo(() => calendarMonthDates(month), [month]);
  const blocksByDate = useMemo(() => {
    const grouped = new Map<string, TimeBlock[]>();
    for (const block of blocks) {
      if (isLocalDate(block.date)) grouped.set(block.date, [...(grouped.get(block.date) ?? []), block]);
    }
    for (const events of grouped.values()) events.sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
    return grouped;
  }, [blocks]);
  const selectedBlocks = blocksByDate.get(selectedDate) ?? [];
  const outsideBounds = (date: string) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate));
  const canVisitMonth = (date: string) => (!minDate || shiftCalendarMonth(date, 1) > minDate) && (!maxDate || date <= maxDate);
  const visit = (date: string) => {
    const clamped = minDate && date < minDate ? minDate : maxDate && date > maxDate ? maxDate : date;
    setSelectedDate(clamped); setMonth(`${clamped.slice(0, 7)}-01`); onSelectDate?.(clamped);
  };
  const onDateKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const next = event.key === 'Home' ? getWeekStartDate(date)
      : event.key === 'End' ? addLocalDateDays(getWeekStartDate(date), 6)
        : event.key in offsets ? addLocalDateDays(date, offsets[event.key]) : null;
    if (!next || outsideBounds(next)) return;
    event.preventDefault(); visit(next);
    // React commits before the next frame, including keys that cross a month boundary.
    requestAnimationFrame(() => dayButtons.current.get(next)?.focus());
  };

  return <section className="month-calendar" aria-label="월간 일정표">
    <header className="month-calendar-toolbar">
      <h2 aria-live="polite"><CalendarDays size={19} /> {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월</h2>
      <div className="month-calendar-navigation">
        <button type="button" className="icon-button" aria-label="이전 달" disabled={!canVisitMonth(shiftCalendarMonth(month, -1))} onClick={() => visit(shiftCalendarMonth(month, -1))}><ChevronLeft size={18} /></button>
        <button type="button" className="button button--secondary button--small" onClick={() => visit(today)}>이번 달</button>
        <button type="button" className="icon-button" aria-label="다음 달" disabled={!canVisitMonth(shiftCalendarMonth(month, 1))} onClick={() => visit(shiftCalendarMonth(month, 1))}><ChevronRight size={18} /></button>
      </div>
    </header>
    <p className="month-calendar-guide">날짜를 선택하면 아래에서 하루 일정을 볼 수 있어요. 일정 제목을 누르면 수정합니다.</p>
    <div className="month-calendar-weekdays" aria-hidden="true">{weekDayMeta.map(day => <span key={day.key}>{day.short}</span>)}</div>
    <div className="month-calendar-grid" role="group" aria-label="날짜 선택">
      {days.map(date => {
        const events = blocksByDate.get(date) ?? [];
        const inMonth = date.slice(0, 7) === month.slice(0, 7);
        return <div className={`month-calendar-day${inMonth ? '' : ' is-outside'}${date === selectedDate ? ' is-selected' : ''}`} key={date}>
          <button type="button" className="month-calendar-date" onClick={() => visit(date)} ref={element => { if (element) dayButtons.current.set(date, element); else dayButtons.current.delete(date); }} aria-label={`${dateLabel(date)}${date === today ? ', 오늘' : ''}, 일정 ${events.length}개`} aria-current={date === today ? 'date' : undefined} aria-pressed={date === selectedDate} disabled={outsideBounds(date)} onKeyDown={event => onDateKeyDown(event, date)}>
            <span>{Number(date.slice(8, 10))}</span>{events.length > 0 && <small>{events.length}개</small>}
          </button>
          <div className="month-calendar-events">
            {events.slice(0, 2).map(block => block.external
              ? <span key={block.id} className="month-calendar-event is-external" title={`${block.title} · 외부 일정 · 읽기 전용`}><Lock size={10} /><time>{formatClock(block.startMinutes)}</time><span>{block.title}</span></span>
              : <button key={block.id} type="button" className="month-calendar-event" aria-label={`${dateLabel(date)} ${formatClock(block.startMinutes)} ${block.title} 일정 수정`} onClick={() => { setSelectedDate(date); onSelectDate?.(date); onEdit(block); }}><time>{formatClock(block.startMinutes)}</time><span>{block.title}</span></button>)}
            {events.length > 2 && <button type="button" className="month-calendar-more" aria-label={`${dateLabel(date)} 일정 ${events.length}개 모두 보기`} onClick={() => visit(date)}>+{events.length - 2}개 더</button>}
            <button type="button" className="month-calendar-quick-add" disabled={outsideBounds(date)} aria-label={`${dateLabel(date)} 일정 추가`} onClick={() => { setSelectedDate(date); onSelectDate?.(date); onAdd(date); }}><Plus size={13} /><span>추가</span></button>
          </div>
        </div>;
      })}
    </div>
    <section className="month-calendar-agenda" aria-label="선택한 날짜의 일정">
      <header><div><h3>{dateLabel(selectedDate)}</h3><p>{selectedBlocks.length ? `일정 ${selectedBlocks.length}개 · 시간순` : '아직 일정이 없어요. 휴식이나 약속만 적어도 좋아요.'}</p></div><button className="button button--primary button--small" type="button" disabled={outsideBounds(selectedDate)} onClick={() => onAdd(selectedDate)}><Plus size={16} /> 일정 추가</button></header>
      {selectedBlocks.length > 0 && <ul>{selectedBlocks.map(block => <li key={block.id}>{block.external
        ? <div className="month-calendar-agenda-event is-external"><Lock size={15} /><span><strong>{block.title}</strong><small>{formatClock(block.startMinutes)} – {formatClock(block.startMinutes + block.durationMinutes)} · 외부 일정 · 원본 캘린더에서 수정</small></span></div>
        : <button type="button" className="month-calendar-agenda-event" onClick={() => onEdit(block)} aria-label={`${block.title} 일정 수정`}><span><strong>{block.title}</strong><small>{formatClock(block.startMinutes)} – {formatClock(block.startMinutes + block.durationMinutes)}</small></span><span className="month-calendar-edit-label">수정</span></button>}</li>)}</ul>}
    </section>
  </section>;
}
