import { DayTimeline, DAY_TIMELINE_HOUR_HEIGHT, type DayTimelineProps, type TimelineCreateInput } from './DayTimeline';
import { getDayKeyForDate, type getWeekDays } from '../lib/calendarDate';
import { formatClock } from '../lib/format';
import type { Task } from '../domain/types';
import type { DayMinuteRange } from '../lib/dayTimeline';

interface WeekTimelineProps extends Omit<DayTimelineProps, 'date' | 'day' | 'onCreate' | 'onScheduleTask' | 'layout'> {
  days: ReturnType<typeof getWeekDays>;
  selectedDate: string;
  todayDate: string;
  onSelectDate: (date: string) => void;
  onCreate: (input: TimelineCreateInput, date: string) => boolean;
  onScheduleTask: (task: Task, range: DayMinuteRange, date: string) => boolean;
}

/** One scroll surface keeps every day on the same time axis. */
export function WeekTimeline({ days, selectedDate, todayDate, onSelectDate, onCreate, onScheduleTask, ...shared }: WeekTimelineProps) {
  return <div className="planning-week-scroll" ref={shared.scrollRef} aria-label="주간 시간 달력">
    <div className="planning-week-canvas">
      <div className="planning-week-dates">
        <span aria-hidden="true">시간</span>
        {days.map(day => <button key={day.isoDate} type="button" aria-label={`${day.isoDate} 할 일 보기`} aria-pressed={day.isoDate === selectedDate} aria-current={day.isoDate === todayDate ? 'date' : undefined} onClick={() => onSelectDate(day.isoDate)}><small>{day.short}</small><strong>{day.date}</strong></button>)}
      </div>
      <div className="planning-week-body">
        <div className="planning-week-axis" aria-hidden="true" style={{ height: DAY_TIMELINE_HOUR_HEIGHT * 24 }}>
          {Array.from({ length: 25 }, (_, hour) => <time key={hour} style={{ top: hour * DAY_TIMELINE_HOUR_HEIGHT }}>{formatClock(hour * 60)}</time>)}
        </div>
        {days.map(day => <DayTimeline key={day.isoDate} {...shared} layout="week" date={day.isoDate} day={getDayKeyForDate(day.isoDate)}
          blocks={shared.blocks.filter(block => block.date === day.isoDate)}
          currentMinute={day.isoDate === todayDate ? shared.currentMinute : null}
          onCreate={input => onCreate(input, day.isoDate)}
          onScheduleTask={(task, range) => onScheduleTask(task, range, day.isoDate)} />)}
      </div>
    </div>
  </div>;
}
