import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarClock, Check, Clock3, ListChecks } from 'lucide-react';
import type { Task } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { Modal } from './Modal';

interface TimeBlockSheetProps {
  tasks: Task[];
  initialTaskId: string;
  initialStartMinutes: number;
  initialDurationMinutes: number;
  error?: string;
  onClose: () => void;
  onSave: (taskId: string, startMinutes: number, durationMinutes: number) => void;
}

const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 23 * 60;
const SLOT_MINUTES = 30;

const buildTimes = (start: number, end: number) => Array.from(
  { length: Math.floor((end - start) / SLOT_MINUTES) + 1 },
  (_, index) => start + (index * SLOT_MINUTES)
);

const startOptions = buildTimes(DAY_START_MINUTES, DAY_END_MINUTES - SLOT_MINUTES);

const roundDuration = (minutes: number) => (
  Math.max(SLOT_MINUTES, Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES)
);

export function TimeBlockSheet({
  tasks,
  initialTaskId,
  initialStartMinutes,
  initialDurationMinutes,
  error,
  onClose,
  onSave
}: TimeBlockSheetProps) {
  const [taskId, setTaskId] = useState(initialTaskId || tasks[0]?.id || '');
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [endMinutes, setEndMinutes] = useState(() => Math.min(
    DAY_END_MINUTES,
    initialStartMinutes + roundDuration(initialDurationMinutes)
  ));

  const selectedTask = tasks.find((task) => task.id === taskId);
  const endOptions = useMemo(
    () => buildTimes(startMinutes + SLOT_MINUTES, DAY_END_MINUTES),
    [startMinutes]
  );

  const updateTask = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    const nextTask = tasks.find((task) => task.id === nextTaskId);
    if (!nextTask) return;
    setEndMinutes(Math.min(DAY_END_MINUTES, startMinutes + roundDuration(nextTask.estimateMinutes)));
  };

  const updateStart = (nextStart: number) => {
    setStartMinutes(nextStart);
    if (endMinutes <= nextStart) {
      setEndMinutes(Math.min(DAY_END_MINUTES, nextStart + SLOT_MINUTES));
    }
  };

  const setDuration = (durationMinutes: number) => {
    setEndMinutes(Math.min(DAY_END_MINUTES, startMinutes + durationMinutes));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!taskId || endMinutes <= startMinutes) return;
    onSave(taskId, startMinutes, endMinutes - startMinutes);
  };

  return (
    <Modal
      title="시간 블록 만들기"
      description="언제부터 언제까지, 무엇을 할지 한 번에 정합니다."
      onClose={onClose}
      className="time-block-sheet"
    >
      <form className="time-block-form" onSubmit={submit}>
        <label className="field time-block-form__task">
          <span className="field-label"><ListChecks size={16} /> 무엇을 할까요?</span>
          <select
            data-autofocus
            value={taskId}
            onChange={(event) => updateTask(event.target.value)}
          >
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {formatMinutes(task.estimateMinutes)}
              </option>
            ))}
          </select>
        </label>

        <div className="time-block-form__times" aria-label="시간 범위">
          <label className="field">
            <span className="field-label"><Clock3 size={16} /> 시작</span>
            <select value={startMinutes} onChange={(event) => updateStart(Number(event.target.value))}>
              {startOptions.map((time) => <option key={time} value={time}>{formatClock(time)}</option>)}
            </select>
          </label>
          <ArrowRight size={18} aria-hidden="true" />
          <label className="field">
            <span className="field-label"><Clock3 size={16} /> 종료</span>
            <select value={endMinutes} onChange={(event) => setEndMinutes(Number(event.target.value))}>
              {endOptions.map((time) => <option key={time} value={time}>{formatClock(time)}</option>)}
            </select>
          </label>
        </div>

        <div className="duration-presets" aria-label="빠른 시간 선택">
          {[30, 60, 90, 120].map((duration) => (
            <button
              key={duration}
              type="button"
              className={endMinutes - startMinutes === duration ? 'is-selected' : ''}
              disabled={startMinutes + duration > DAY_END_MINUTES}
              onClick={() => setDuration(duration)}
              aria-pressed={endMinutes - startMinutes === duration}
            >
              {formatMinutes(duration)}
            </button>
          ))}
        </div>

        <div className="time-block-preview" aria-live="polite">
          <span className="time-block-preview__icon"><CalendarClock size={18} /></span>
          <span>
            <small>오늘의 계획</small>
            <strong>{formatClock(startMinutes)} – {formatClock(endMinutes)}</strong>
            <em>{selectedTask?.title ?? '할 일을 선택하세요.'}</em>
          </span>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>취소</button>
          <button className="button button--primary" type="submit" disabled={!taskId}>
            <Check size={16} /> 오늘 계획에 추가
          </button>
        </div>
      </form>
    </Modal>
  );
}
