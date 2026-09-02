import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarClock, CalendarDays, Check, Clock3, ListChecks, Plus, Trash2 } from 'lucide-react';
import type { DayKey, Outcome, Task } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { Modal } from './Modal';

export type TimeBlockMode = 'existing-task' | 'new-task' | 'event';

export interface TimeBlockEditorValue {
  blockId?: string;
  mode: TimeBlockMode;
  taskId: string | null;
  title: string;
  outcomeId: string | null;
  day: DayKey;
  startMinutes: number;
  durationMinutes: number;
}

interface TimeBlockSheetProps {
  tasks: Task[];
  outcomes?: Outcome[];
  days?: Array<{ key: DayKey; short: string; date: string }>;
  initialBlockId?: string;
  initialTaskId?: string;
  initialTitle?: string;
  initialDay: DayKey;
  initialStartMinutes: number;
  initialDurationMinutes: number;
  initialMode?: TimeBlockMode;
  error?: string;
  onClose: () => void;
  onSave: (value: TimeBlockEditorValue) => void;
  onDelete?: () => void;
}

const DAY_START_MINUTES = 0;
const DAY_END_MINUTES = 24 * 60;
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
  outcomes = [],
  days,
  initialBlockId,
  initialTaskId = '',
  initialTitle = '',
  initialDay,
  initialStartMinutes,
  initialDurationMinutes,
  initialMode,
  error,
  onClose,
  onSave,
  onDelete
}: TimeBlockSheetProps) {
  const fallbackMode: TimeBlockMode = initialTaskId
    ? 'existing-task'
    : initialBlockId
      ? 'event'
      : tasks.length > 0
        ? 'existing-task'
        : 'new-task';
  const [mode, setMode] = useState<TimeBlockMode>(initialMode ?? fallbackMode);
  const [taskId, setTaskId] = useState(initialTaskId || tasks[0]?.id || '');
  const [title, setTitle] = useState(initialTitle);
  const [outcomeId, setOutcomeId] = useState('');
  const [day, setDay] = useState<DayKey>(initialDay);
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [endMinutes, setEndMinutes] = useState(() => Math.min(
    DAY_END_MINUTES,
    initialStartMinutes + roundDuration(initialDurationMinutes)
  ));

  const selectedTask = tasks.find((task) => task.id === taskId);
  const selectedTitle = mode === 'existing-task' ? selectedTask?.title ?? '' : title.trim();
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
    const currentDuration = Math.max(SLOT_MINUTES, endMinutes - startMinutes);
    setStartMinutes(nextStart);
    setEndMinutes(Math.min(DAY_END_MINUTES, nextStart + currentDuration));
  };

  const setDuration = (durationMinutes: number) => {
    setEndMinutes(Math.min(DAY_END_MINUTES, startMinutes + durationMinutes));
  };

  const chooseMode = (nextMode: TimeBlockMode) => {
    if (nextMode === 'existing-task' && tasks.length === 0) return;
    setMode(nextMode);
    if (nextMode !== 'existing-task') {
      if (mode === 'existing-task') setTitle('');
      if (mode === 'existing-task') setEndMinutes(Math.min(DAY_END_MINUTES, startMinutes + 60));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTitle || endMinutes <= startMinutes) return;
    onSave({
      blockId: initialBlockId,
      mode,
      taskId: mode === 'existing-task' ? taskId : null,
      title: selectedTitle,
      outcomeId: mode === 'new-task' ? outcomeId || null : null,
      day,
      startMinutes,
      durationMinutes: endMinutes - startMinutes
    });
  };

  return (
    <Modal
      title={initialBlockId ? '일정 수정' : '할 일 또는 일정 추가'}
      description="목표가 없어도 새 할 일이나 일정부터 바로 만들 수 있습니다."
      onClose={onClose}
      className="time-block-sheet"
    >
      <form className="time-block-form" onSubmit={submit}>
        <div className="entry-mode" aria-label="등록할 항목 종류">
          <button
            type="button"
            className={mode === 'existing-task' ? 'is-selected' : ''}
            disabled={tasks.length === 0}
            aria-pressed={mode === 'existing-task'}
            onClick={() => chooseMode('existing-task')}
          >
            <ListChecks size={16} /> 기존 할 일
          </button>
          <button
            type="button"
            className={mode === 'new-task' ? 'is-selected' : ''}
            aria-pressed={mode === 'new-task'}
            onClick={() => chooseMode('new-task')}
          >
            <Plus size={16} /> 새 할 일
          </button>
          <button
            type="button"
            className={mode === 'event' ? 'is-selected' : ''}
            aria-pressed={mode === 'event'}
            onClick={() => chooseMode('event')}
          >
            <CalendarClock size={16} /> 일정만
          </button>
        </div>

        {mode === 'existing-task' ? (
          <label className="field time-block-form__task">
            <span className="field-label"><ListChecks size={16} /> 할 일 선택</span>
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
        ) : (
          <div className="time-block-form__details">
            <label className="field">
              <span className="field-label">{mode === 'new-task' ? '새 할 일' : '일정 제목'}</span>
              <input
                data-autofocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={mode === 'new-task' ? '예: 병원 예약 전화하기' : '예: 치과 진료'}
                required
              />
            </label>
            {mode === 'new-task' && (
              <label className="field">
                <span className="field-label">목표 연결 <small>선택</small></span>
                <select value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
                  <option value="">연결하지 않음</option>
                  {outcomes.map((outcome) => (
                    <option key={outcome.id} value={outcome.id}>{outcome.title}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {days && days.length > 1 && (
          <div className="field-group">
            <span className="field-label"><CalendarDays size={16} /> 날짜</span>
            <div className="segmented segmented--days time-block-days">
              {days.map((item) => (
                <button
                  key={item.key}
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
        )}

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
            <small>{mode === 'event' ? '내 일정' : '할 일과 시간'}</small>
            <strong>{formatClock(startMinutes)} – {formatClock(endMinutes)}</strong>
            <em>{selectedTitle || '제목을 입력하세요.'}</em>
          </span>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal__actions time-block-actions">
          {initialBlockId && onDelete && (
            <button className="button button--delete" type="button" onClick={onDelete}>
              <Trash2 size={16} /> 삭제
            </button>
          )}
          <span className="time-block-actions__spacer" />
          <button className="button button--secondary" type="button" onClick={onClose}>취소</button>
          <button className="button button--primary" type="submit" disabled={!selectedTitle}>
            <Check size={16} /> {initialBlockId ? '변경 저장' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
