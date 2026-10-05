import { useLocale, tr } from '../i18n';
import { useMemo, useRef, useState, type FormEvent } from 'react';
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
  taskPatch?: Partial<Pick<Task, 'title' | 'outcomeId' | 'subtasks'>>;
}

interface TimeBlockSheetProps {
  taskOnly?: boolean;
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
  taskOnly = false,
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
  useLocale();
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
  const originalTasks = useRef(new Map(tasks.map(task => [task.id, task])));
  const [draftError, setDraftError] = useState('');
  const [day, setDay] = useState<DayKey>(initialDay);
  const [date, setDate] = useState(initialDate ?? '');
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [endMinutes, setEndMinutes] = useState(() => Math.min(
    DAY_END_MINUTES,
    initialStartMinutes + minimumDuration(initialDurationMinutes)
  ));

  const selectedTask = tasks.find((task) => task.id === taskId);
  const subtasks = mode === 'existing-task' ? taskSubtasks[taskId] ?? selectedTask?.subtasks ?? [] : newSubtasks;
  const originalTask = originalTasks.current.get(taskId);
  const titleChanged = title.trim() !== (originalTask?.title ?? '');
  const selectedTitle = mode === 'existing-task' && !titleChanged ? selectedTask?.title ?? title.trim() : title.trim();
  const endOptions = useMemo(
    () => includeExactTime(buildTimes(startMinutes + SLOT_MINUTES, DAY_END_MINUTES), endMinutes),
    [startMinutes, endMinutes]
  );

  const updateTask = (nextTaskId: string) => {
    setTaskId(nextTaskId);
    const nextTask = tasks.find((task) => task.id === nextTaskId);
    if (!nextTask) return;
    originalTasks.current.set(nextTaskId, nextTask);
    setDraftError('');
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
    const taskPatch: TimeBlockEditorValue['taskPatch'] = {};
    if (mode === 'existing-task' && selectedTask && originalTask) {
      const outcomeChanged = (outcomeId || null) !== (originalTask.outcomeId ?? null);
      const subtasksChanged = JSON.stringify(subtasks) !== JSON.stringify(originalTask.subtasks ?? []);
      if ((titleChanged && selectedTask.title !== originalTask.title && selectedTask.title !== selectedTitle)
        || (outcomeChanged && selectedTask.outcomeId !== originalTask.outcomeId && (selectedTask.outcomeId ?? null) !== (outcomeId || null))
        || (subtasksChanged && JSON.stringify(selectedTask.subtasks ?? []) !== JSON.stringify(originalTask.subtasks ?? []) && JSON.stringify(selectedTask.subtasks ?? []) !== JSON.stringify(subtasks))) {
        setDraftError(tr("수정 중인 항목이 다른 기기에서도 변경됐습니다. 입력은 유지됩니다. 최신 내용을 확인한 뒤 다시 열어 주세요."));
        return;
      }
      if (titleChanged) taskPatch.title = selectedTitle;
      if (outcomeChanged) taskPatch.outcomeId = outcomeId || null;
      if (subtasksChanged) taskPatch.subtasks = subtasks;
    }
    onSave({
      blockId: initialBlockId,
      mode,
      taskId: mode === 'existing-task' ? taskId : null,
      title: selectedTitle,
      outcomeId: mode === 'existing-task' && taskPatch.outcomeId === undefined ? selectedTask?.outcomeId ?? null : mode !== 'event' ? outcomeId || null : null,
      day: initialDate !== undefined ? getDayKeyForDate(date) : day,
      ...(initialDate !== undefined ? { date } : {}),
      startMinutes,
      durationMinutes: endMinutes - startMinutes,
      ...(mode !== 'event' ? { subtasks } : {}),
      ...(mode === 'existing-task' ? { taskPatch } : {})
    });
  };

  return (
    <Modal
      title={taskOnly ? initialBlockId ? tr("시간 수정") : tr("시간 지정") : initialBlockId ? tr("일정 수정") : tr("할 일 또는 일정 추가")}
      description={taskOnly ? tr("시작과 종료 시간을 정한 뒤 저장하세요. 같은 할 일이 목록과 시간표에 연결됩니다.") : tr("목표가 없어도 새 할 일이나 일정부터 바로 만들 수 있습니다.")}
      onClose={onClose}
      className="time-block-sheet"
    >
      <form className="time-block-form" onSubmit={submit}>
        {!taskOnly && <div className="entry-mode" aria-label={tr("등록할 항목 종류")}>
          <button
            type="button"
            className={mode === 'existing-task' ? 'is-selected' : ''}
            disabled={tasks.length === 0}
            aria-pressed={mode === 'existing-task'}
            onClick={() => chooseMode('existing-task')}
          >
            <ListChecks size={16} /> {tr("기존 할 일")}</button>
          <button
            type="button"
            className={mode === 'new-task' ? 'is-selected' : ''}
            aria-pressed={mode === 'new-task'}
            onClick={() => chooseMode('new-task')}
          >
            <Plus size={16} /> {tr("새 할 일")}</button>
          <button
            type="button"
            className={mode === 'event' ? 'is-selected' : ''}
            aria-pressed={mode === 'event'}
            onClick={() => chooseMode('event')}
          >
            <CalendarClock size={16} /> {tr("일정만")}</button>
        </div>}

        {taskOnly && <strong className="task-only-title">{selectedTask?.title}</strong>}
        {mode === 'existing-task' && !taskOnly ? (
          <label className="field time-block-form__task">
            <span className="field-label"><ListChecks size={16} /> {' '}{tr("할 일 선택")}</span>
            <select
              data-autofocus
              aria-label={tr("할 일 선택")}
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
          <details className="time-block-extra" open={taskOnly ? undefined : true}>
          {taskOnly && <summary>{tr("제목·목표·하위 할 일 수정")}{' '}<small>{tr("선택")}</small></summary>}
          <div className="time-block-form__details">
            <label className="field">
              <span className="field-label">{mode === 'existing-task' ? tr("할 일 제목") : mode === 'new-task' ? tr("새 할 일") : tr("일정 제목")}</span>
              <input
                data-autofocus={mode !== 'existing-task' || undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={mode === 'new-task' ? tr("예: 병원 예약 전화하기") : tr("예: 치과 진료")}
                maxLength={500}
                required
              />
            </label>
            {mode !== 'event' && (
              <label className="field">
                <span className="field-label">{tr("목표 연결")}{' '}<small>{tr("선택")}</small></span>
                <select aria-label={tr("목표 연결")} value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
                  <option value="">{tr("연결하지 않음")}</option>
                  {outcomes.map((outcome) => (
                    <option key={outcome.id} value={outcome.id}>{outcome.title}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'existing-task' && <p className="field-help">{tr("제목과 목표 연결은 원래 할 일에도 반영됩니다. 시간 변경은 이 일정에만 적용됩니다.")}</p>}
          </div>

        {mode !== 'event' && <SubtaskEditor key={mode === 'existing-task' ? taskId : 'new-task'} value={subtasks} onChange={items => mode === 'existing-task' ? setTaskSubtasks(current => ({ ...current, [taskId]: items })) : setNewSubtasks(items)} />}
          </details>
        {initialDate !== undefined && <label className="field"><span className="field-label"><CalendarDays size={16} /> {' '}{tr("날짜")}</span><input type="date" aria-label={tr("일정 날짜")} required min={minDate} max={maxDate} value={date} onChange={event => setDate(event.target.value)} /><small className="field-help">{tr("다른 주나 달로도 일정을 옮길 수 있어요.")}</small></label>}
        {initialDate === undefined && days && days.length > 1 && (
          <div className="field-group">
            <span className="field-label"><CalendarDays size={16} /> {' '}{tr("날짜")}</span>
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

        <div className="time-block-form__times" aria-label={tr("시간 범위")}>
          <label className="field">
            <span className="field-label"><Clock3 size={16} /> {' '}{tr("시작")}</span>
            <select data-autofocus={taskOnly || undefined} aria-label={tr("시작")} value={startMinutes} onChange={(event) => updateStart(Number(event.target.value))}>
              {includeExactTime(startOptions, startMinutes).map((time) => <option key={time} value={time}>{formatClock(time)}</option>)}
            </select>
          </label>
          <ArrowRight size={18} aria-hidden="true" />
          <label className="field">
            <span className="field-label"><Clock3 size={16} /> {' '}{tr("종료")}</span>
            <select aria-label={tr("종료")} value={endMinutes} onChange={(event) => setEndMinutes(Number(event.target.value))}>
              {endOptions.map((time) => <option key={time} value={time}>{formatClock(time)}</option>)}
            </select>
          </label>
        </div>

        <div className="duration-presets" aria-label={tr("빠른 시간 선택")}>
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
            <small>{mode === 'event' ? tr("내 일정") : tr("할 일과 시간")}</small>
            <strong>{formatClock(startMinutes)} – {formatClock(endMinutes)}</strong>
            <em>{selectedTitle || tr("제목을 입력하세요.")}</em>
          </span>
        </div>

        {(draftError || error) && <p className="form-error" role="alert">{draftError || error}</p>}

        <div className="modal__actions time-block-actions">
          {initialBlockId && onDelete && (
            <button className="button button--delete" type="button" onClick={onDelete}>
              <Trash2 size={16} /> {tr("일정에서 삭제")}</button>
          )}
          <span className="time-block-actions__spacer" />
          <button className="button button--secondary" type="button" onClick={onClose}>{tr("취소")}</button>
          <button className="button button--primary" type="submit" disabled={!selectedTitle || (mode !== 'event' && !validSubtasks(subtasks))}>
            <Check size={16} /> {taskOnly ? tr("시간 저장") : initialBlockId ? tr("변경 저장") : tr("추가")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
