import { useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import type { DayKey, Task } from '../domain/types';
import { weekDays as defaultWeekDays } from '../data/demo';
import { dayLabels, formatMinutes } from '../lib/format';
import { Modal } from './Modal';

interface PlacementSheetProps {
  task: Task;
  initialDay?: DayKey;
  initialStart?: number;
  days?: Array<{ key: DayKey; short: string; date: string }>;
  error?: string;
  onClose: () => void;
  onPlace: (day: DayKey, startMinutes: number, durationMinutes: number) => void;
}

const timeOptions = [420, 540, 660, 780, 900, 1020, 1170, 1260];

export function PlacementSheet({
  task,
  initialDay = 'mon',
  initialStart = 1170,
  days = defaultWeekDays,
  error,
  onClose,
  onPlace
}: PlacementSheetProps) {
  const [day, setDay] = useState<DayKey>(initialDay);
  const [startMinutes, setStartMinutes] = useState(initialStart);
  const [durationMinutes, setDurationMinutes] = useState(task.estimateMinutes);

  return (
    <Modal
      title="실행 시간을 정해요"
      description={`“${task.title}”을 달력에 배치합니다.`}
      onClose={onClose}
      className="placement-sheet"
    >
      <div className="field-group">
        <span className="field-label"><CalendarDays size={16} /> 요일</span>
        <div className="segmented segmented--days">
          {days.map((item, index) => (
            <button
              key={item.key}
              data-autofocus={index === 0 ? '' : undefined}
              type="button"
              className={day === item.key ? 'is-selected' : ''}
              aria-pressed={day === item.key}
              onClick={() => setDay(item.key)}
            >
              <span>{item.short}</span>
              <small>{item.date}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span className="field-label"><Clock3 size={16} /> 시작</span>
          <select value={startMinutes} onChange={(event) => setStartMinutes(Number(event.target.value))}>
            {timeOptions.map((time) => (
              <option key={time} value={time}>{String(Math.floor(time / 60)).padStart(2, '0')}:{String(time % 60).padStart(2, '0')}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">예상 시간</span>
          <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
            {[15, 25, 40, 60, 90, 120].map((minutes) => (
              <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="placement-preview">
        <span>{dayLabels[day]}</span>
        <strong>{String(Math.floor(startMinutes / 60)).padStart(2, '0')}:{String(startMinutes % 60).padStart(2, '0')}</strong>
        <span>부터 {formatMinutes(durationMinutes)}</span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="modal__actions">
        <button className="button button--secondary" type="button" onClick={onClose}>취소</button>
        <button className="button button--primary" type="button" onClick={() => onPlace(day, startMinutes, durationMinutes)}>계획에 배치</button>
      </div>
    </Modal>
  );
}
