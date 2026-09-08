import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarClock, CalendarDays, Check, Clock3, ListChecks, Plus, Trash2 } from 'lucide-react';
import type { DayKey, Outcome, Task, Subtask } from '../domain/types';
import { SubtaskEditor } from './SubtaskEditor';
import { validSubtasks } from '../domain/subtasks';
import { formatClock, formatMinutes } from '../lib/format';
import { getDayKeyForDate, isLocalDate } from '../lib/calendarDate';
import { Modal } from './Modal';

export type TimeBlockMode = 'existing-task' | 'new-task' | 'event';

export interface TimeBlockEditorValue {
  blockId?: string;
  mode: TimeBlockMode;
  taskId: string | null;
  title: string;
  outcomeId: string | null;
  day: DayKey;
  date?: string;
  startMinutes: number;
  durationMinutes: number;
  subtasks?: Subtask[];
}

interface TimeBlockSheetProps {
  tasks: Task[];
  outcomes?: Outcome[];
  days?: Array<{ key: DayKey; short: string; date: string }>;
  initialBlockId?: string;
  initialTaskId?: string;
  initialTitle?: string;
  initialDay: DayKey;
  /** Enables absolute-date editing without changing legacy week-only callers. */
  initialDate?: string;
  minDate?: string;
  maxDate?: string;
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
const SLOT_MINUTES = 15;

const buildTimes = (start: number, end: number) => Array.from(
  { length: Math.floor((end - start) / SLOT_MINUTES) + 1 },
  (_, index) => start + (index * SLOT_MINUTES)
);

const startOptions = buildTimes(DAY_START_MINUTES, DAY_END_MINUTES - SLOT_MINUTES);

const minimumDuration = (minutes: number) => Math.max(SLOT_MINUTES, minutes);
const includeExactTime = (options: number[], value: number) => [...new Set([...options, value])].sort((a, b) => a - b);

export function TimeBlockSheet({
  tasks,
  outcomes = [],
  days,
  initialBlockId,
  initialTaskId = '',
  initialTitle = '',
  initialDay,
  initialDate,
  minDate,
  maxDate,
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
  const firstTask = tasks.find((task) => task.id === (initialTaskId || tasks[0]?.id));
  const [title, setTitle] = useState((initialMode ?? fallbackMode) === 'existing-task' ? firstTask?.title ?? '' : initialTitle);
  const [outcomeId, setOutcomeId] = useState((initialMode ?? fallbackMode) === 'existing-task' ? firstTask?.outcomeId ?? '' : '');
  const [taskSubtasks, setTaskSubtasks] = useState<Record<string, Subtask[]>>({});
  const [newSubtasks, setNewSubtasks] = useState<Subtask[]>([]);
  const [day, setDay] = useState<DayKey>(initialDay);
  const [date, setDate] = useState(initialDate ?? '');
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [endMinutes, setEndMinutes] = useState(() => Math.min(
    DAY_END_MINUTES,
    initialStartMinutes + minimumDuration(initialDurationMinutes)
  ));

  const selectedTask = tasks.find((task) => task.id === taskId);
  const subtasks = mode === 'existing-task' ? taskSubtasks[taskId] ?? selectedTask?.subtasks ?? [] : newSubtasks;
  const selectedTitle = title.trim();
  const endOptions = useMemo(
    () => includeExactTime(buildTimes(startMinutes + SLOT_MINUTES, DAY_END_MINUTES), endMinutes),
    [startMinutes, endMinutes]
  );

  const updateTask = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    const nextTask = tasks.find((task) => task.id === nextTaskId);
    if (!nextTask) return;
    setTitle(nextTask.title);
    setOutcomeId(nextTask.outcomeId ?? '');
    setEndMinutes(Math.min(DAY_END_MINUTES, startMinutes + minimumDuration(nextTask.estimateMinutes)));
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
    if (nextMode === 'existing-task') {
      setTitle(selectedTask?.title ?? '');
      setOutcomeId(selectedTask?.outcomeId ?? '');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTitle || endMinutes <= startMinutes || (mode === 'existing-task' && !selectedTask) || (mode !== 'event' && !validSubtasks(subtasks))) return;
    if (initialDate !== undefined && (!isLocalDate(date) || (minDate && date < minDate) || (maxDate && date > maxDate))) return;
    onSave({
      blockId: initialBlockId,
      mode,
      taskId: mode === 'existing-task' ? taskId : null,
      title: selectedTitle,
      outcomeId: mode !== 'event' ? outcomeId || null : null,
      day: initialDate !== undefined ? getDayKeyForDate(date) : day,
      ...(initialDate !== undefined ? { date } : {}),
      startMinutes,
      durationMinutes: endMinutes - startMinutes,
      ...(mode !== 'event' ? { subtasks } : {})
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
              aria-label="할 일 선택"
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
        ) : null}
          <div className="time-block-form__details">
            <label className="field">
              <span className="field-label">{mode === 'existing-task' ? '할 일 제목' : mode === 'new-task' ? '새 할 일' : '일정 제목'}</span>
              <input
                data-autofocus={mode !== 'existing-task' || undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={mode === 'new-task' ? '예: 병원 예약 전화하기' : '예: 치과 진료'}
                maxLength={500}
                required
              />
            </label>
            {mode !== 'event' && (
              <label className="field">
                <span className="field-label">목표 연결 <small>선택</small></span>
                <select aria-label="목표 연결" value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
                  <option value="">연결하지 않음</option>
                  {outcomes.map((outcome) => (
                    <option key={outcome.id} value={outcome.id}>{outcome.title}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'existing-task' && <p className="field-help">제목과 목표 연결은 원래 할 일에도 반영됩니다. 시간 변경은 이 일정에만 적용됩니다.</p>}
          </div>

        {mode !== 'event' && <SubtaskEditor key={mode === 'existing-task' ? taskId : 'new-task'} value={subtasks} onChange={items => mode === 'existing-task' ? setTaskSubtasks(current => ({ ...current, [taskId]: items })) : setNewSubtasks(items)} />}
        {initialDate !== undefined && <label className="field"><span className="field-label"><CalendarDays size={16} /> 날짜</span><input type="date" aria-label="일정 날짜" required min={minDate} max={maxDate} value={date} onChange={event => setDate(event.target.value)} /><small className="field-help">다른 주나 달로도 일정을 옮길 수 있어요.</small></label>}
        {initialDate === undefined && days && days.length > 1 && (
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
            <select aria-label="시작" value={startMinutes} onChange={(event) => updateStart(Number(event.target.value))}>
              {includeExactTime(startOptions, startMinutes).map((time) => <option key={time} value={time}>{formatClock(time)}</option>)}
            </select>
          </label>
          <ArrowRight size={18} aria-hidden="true" />
          <label className="field">
            <span className="field-label"><Clock3 size={16} /> 종료</span>
            <select aria-label="종료" value={endMinutes} onChange={(event) => setEndMinutes(Number(event.target.value))}>
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
              <Trash2 size={16} /> 일정에서 삭제
            </button>
          )}
          <span className="time-block-actions__spacer" />
          <button className="button button--secondary" type="button" onClick={onClose}>취소</button>
          <button className="button button--primary" type="submit" disabled={!selectedTitle || (mode !== 'event' && !validSubtasks(subtasks))}>
            <Check size={16} /> {initialBlockId ? '변경 저장' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
