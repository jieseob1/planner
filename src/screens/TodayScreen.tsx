import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Pause,
  Play,
  Plus,
  Square,
  Star,
  StickyNote,
  TimerReset,
  X
} from 'lucide-react';
import { DayTimeline, DAY_TIMELINE_HOUR_HEIGHT, type TimelineCreateInput } from '../components/DayTimeline';
import { Modal } from '../components/Modal';
import { SaveStatus } from '../components/SaveStatus';
import { TaskEditorSheet } from '../components/TaskEditorSheet';
import { TimeBlockSheet, type TimeBlockEditorValue } from '../components/TimeBlockSheet';
import { SubtaskProgress } from '../components/SubtaskEditor';
import type { Task, TimeBlock, TimeEntry } from '../domain/types';
import {
  addLocalDateDays,
  getDayKeyForDate,
  getMinuteOfDay,
  getToday,
  getWeekDays,
  getWeekOffsetForDate,
  isInstantOnLocalDate,
  parseLocalDate
} from '../lib/calendarDate';
import { formatClock, formatMinutes, formatTimer } from '../lib/format';
import type { DayMinuteRange } from '../lib/dayTimeline';
import { QUICK_CAPTURE_EVENT } from '../lib/quickCapture';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { TodayGoalStrip, TodayReview } from '../components/TodayPeriodContext';
import { useSearchParams } from 'react-router-dom';
import { isLocalDate } from '../lib/calendarDate';

const DAY_END_MINUTES = 24 * 60;
const MEMO_STORAGE_KEY = 'goals-to-today.today-memo.v1';
const MOBILE_LAYOUT_QUERY = '(max-width: 800px)';

function loadTodayMemo() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(MEMO_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export const getBlocksForDate = (blocks: readonly TimeBlock[], date: string) => (
  blocks
    .filter((block) => block.date === date)
    .slice()
    .sort((left, right) => left.startMinutes - right.startMinutes)
);

export const getLoggedSecondsForDate = (entries: readonly TimeEntry[], date: string, timeZone?: string) => (
  entries.reduce((total, entry) => (
    isInstantOnLocalDate(entry.observedAt, date, timeZone) ? total + entry.durationSeconds : total
  ), 0)
);

export const getNextScheduledBlock = (blocks: readonly TimeBlock[], currentMinute: number) => (
  blocks
    .filter((block) => block.startMinutes + block.durationMinutes > currentMinute)
    .slice()
    .sort((left, right) => left.startMinutes - right.startMinutes)[0]
);

function useTimerSeconds(startedAt: number | null, accumulatedSeconds: number, paused: boolean) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (paused || startedAt === null) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [paused, startedAt]);

  if (paused || startedAt === null) return accumulatedSeconds;
  return accumulatedSeconds + Math.max(0, Math.floor((now - startedAt) / 1000));
}

function useCurrentMinute(timeZone: string) {
  const [currentMinute, setCurrentMinute] = useState(() => getMinuteOfDay(new Date(), timeZone));

  useEffect(() => {
    const update = () => setCurrentMinute(getMinuteOfDay(new Date(), timeZone));
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, [timeZone]);

  return currentMinute;
}

function useCompactLayout() {
  const [isCompact, setIsCompact] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const update = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    setIsCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isCompact;
}

const formatDateLabel = (date: string) => {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(parsed);
};

interface TodoPanelProps {
  activeTasks: Task[];
  completedTasks: Task[];
  canRecordManualTime: boolean;
  draggingTaskId: string | null;
  mobile?: boolean;
  memo: string;
  manualMinutes: string;
  manualTaskId: string;
  runningTaskId: string | null;
  timerPaused: boolean;
  unscheduledTasks: Task[];
  inboxTasks: Task[];
  selectedBlocks: TimeBlock[];
  onAddTask: (title: string) => void;
  onComplete: (taskId: string) => void;
  onPostpone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLLIElement>, task: Task) => void;
  onMemoChange: (memo: string) => void;
  onManualMinutesChange: (minutes: string) => void;
  onManualTaskChange: (taskId: string) => void;
  onRecordManualTime: () => void;
  onScheduleNext: (task: Task) => void;
  onStart: (taskId: string) => void;
}

function TodoPanel({
  activeTasks,
  completedTasks,
  canRecordManualTime,
  draggingTaskId,
  mobile = false,
  memo,
  manualMinutes,
  manualTaskId,
  runningTaskId,
  timerPaused,
  unscheduledTasks,
  inboxTasks,
  selectedBlocks,
  onAddTask,
  onComplete,
  onPostpone,
  onEdit,
  onDragEnd,
  onDragStart,
  onMemoChange,
  onManualMinutesChange,
  onManualTaskChange,
  onRecordManualTime,
  onScheduleNext,
  onStart
}: TodoPanelProps) {
  const [title, setTitle] = useState('');
  const [list, setList] = useState<'day' | 'inbox'>('day');
  const visibleTasks = list === 'day' ? unscheduledTasks : inboxTasks;
  const composingRef = useRef(false);

  const saveTask = () => {
    if (!title.trim()) return;
    onAddTask(title);
    setTitle('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composingRef.current) return;
    saveTask();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.nativeEvent.isComposing || composingRef.current) return;
    saveTask();
  };

  return (
    <div className={mobile ? 'today-direct-todos is-mobile' : 'today-direct-todos'}>
      <header className="today-direct-todos__header">
        <div>
          <span className="today-direct-kicker">하나씩, 가볍게</span>
          <h2>{canRecordManualTime ? '오늘 할 일' : '이 날짜의 할 일'}</h2>
        </div>
        <strong aria-label={`${canRecordManualTime ? '오늘 할 일' : '이 날짜의 할 일'} ${unscheduledTasks.length}개`}>{unscheduledTasks.filter(task => task.status === 'done').length}/{unscheduledTasks.length}</strong>
      </header>

      <form className="today-direct-quick-add" onSubmit={submit}>
        <Plus size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="quick-capture">빠른 메모</label>
        <input
          id="quick-capture"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={handleKeyDown}
          placeholder="이 날짜에 할 일 추가"
          maxLength={500}
          autoComplete="off"
        />
        <button type="submit" disabled={!title.trim()}>추가</button>
      </form>

      <div className="today-task-filters" aria-label="할 일 목록 선택">
        <button type="button" aria-pressed={list === 'day'} onClick={() => setList('day')}>선택한 날짜 <span>{unscheduledTasks.length}</span></button>
        <button type="button" aria-pressed={list === 'inbox'} onClick={() => setList('inbox')}>나중에 <span>{inboxTasks.length}</span></button>
      </div>

      {visibleTasks.length > 0 ? (
        <ul className="today-direct-todo-list">
          {visibleTasks.map((task) => {
            const taskBlocks = selectedBlocks.filter(block => block.taskId === task.id && !block.external);
            const isDone = task.status === 'done';
            const isRunning = runningTaskId === task.id;
            const isPaused = isRunning && timerPaused;
            const timerAction = isRunning ? (isPaused ? '계속' : '멈춤') : '시작';
            const otherTimerStatus = timerPaused ? '다른 할 일 일시정지 중' : '다른 할 일 실행 중';
            const timerLabel = isRunning ? `타이머 ${timerAction}` : runningTaskId ? otherTimerStatus : '타이머 시작';
            return (
              <li
                key={task.id}
                draggable={!mobile}
                className={`${draggingTaskId === task.id ? 'is-dragging' : ''}${isDone ? ' is-done' : ''}`}
                onDragStart={(event) => onDragStart(event, task)}
                onDragEnd={onDragEnd}
              >
                <GripVertical className="today-direct-todo__grip" size={16} aria-hidden="true" />
                <button className="today-direct-todo__check" type="button" aria-pressed={isDone} aria-label={`${task.title} ${isDone ? '완료 취소' : '완료 처리'}`} title={isDone ? '완료 취소' : '완료'} onClick={() => onComplete(task.id)}>
                  <Check size={14} aria-hidden="true" />
                </button>
                <div className="today-direct-todo__copy">
                  <button className="today-direct-todo__edit" type="button" title="할 일 수정" aria-label={`${task.title} 수정`} onClick={() => onEdit(task)}>
                    {task.pinned && <Star size={13} fill="currentColor" aria-label="Top 3" />}
                    <span>{task.title}</span>
                    <SubtaskProgress items={task.subtasks} />
                  </button>
                  <small>
                    <Clock3 size={13} aria-hidden="true" /> {isDone ? '완료' : taskBlocks.length ? taskBlocks.map(block => `${formatClock(block.startMinutes)}–${formatClock(block.startMinutes + block.durationMinutes)}`).join(' · ') : list === 'inbox' ? '날짜 미정' : `시간 미정 · 예상 ${formatMinutes(task.estimateMinutes)}`}
                  </small>
                </div>
                <div className="today-task-actions">
                <button className="today-direct-todo__schedule" type="button" disabled={isDone} aria-label={`${task.title} 시간 지정`} onClick={() => onScheduleNext(task)}>
                  <Clock3 size={15} aria-hidden="true" /><span>{taskBlocks.length ? '시간 수정' : '시간 지정'}</span>
                </button>
                <button className="today-direct-todo__schedule" type="button" aria-label={`${task.title} 날짜 변경`} onClick={() => onPostpone(task)}><CalendarDays size={15} /><span>날짜 변경</span></button>
                <button
                  className="today-direct-todo__start"
                  type="button"
                  aria-label={`${task.title} ${timerLabel}`}
                  title={timerLabel}
                  disabled={isDone || Boolean(runningTaskId && !isRunning)}
                  onClick={() => onStart(task.id)}
                >
                  {isRunning && !isPaused ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  <span>{isRunning ? timerAction : runningTaskId ? timerPaused ? '일시정지 중' : '실행 중' : '시작'}</span>
                </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="today-direct-todos__empty">{list === 'inbox' ? '날짜가 정해지지 않은 할 일이 없어요.' : '위에 할 일을 적어보세요. 시간은 나중에 정해도 괜찮아요.'}</p>
      )}

      <p className="today-direct-todos__hint">체크하면 완료. 시간을 정하면 같은 할 일이 시간표에도 표시돼요.</p>

      {completedTasks.length > 0 && (
        <details className="today-direct-utility">
          <summary>완료·취소한 할 일 ({completedTasks.length})</summary>
          <p className="field-help">전체 기간의 할 일입니다. 눌러서 수정하거나 다시 열 수 있습니다.</p>
          <ul className="today-direct-completed-list">{completedTasks.map((task) => (
            <li key={task.id}><button type="button" onClick={() => onEdit(task)} aria-label={`${task.title} 수정`}><span>{task.title}</span><small>{task.status === 'done' ? '완료' : '취소'} · 수정</small></button></li>
          ))}</ul>
        </details>
      )}

      <details className="today-direct-utility">
        <summary><StickyNote size={15} /> 이전 기기 메모</summary>
        <p>기존 메모에는 계정·날짜 정보가 없습니다. 자동으로 회고에 옮기지 않습니다. 새 메모는 아래 하루 마무리에 남겨주세요.</p>
        <button type="button" onClick={() => onMemoChange(loadTodayMemo())}>이 기기의 이전 메모 확인</button>
        {memo && <textarea value={memo} readOnly aria-label="이전 기기 메모 (읽기 전용)" />}
      </details>

      {canRecordManualTime && activeTasks.length > 0 && (
        <details className="today-direct-utility">
          <summary><TimerReset size={15} /> 수동으로 시간 기록</summary>
          <div className="today-direct-manual-time">
            <select value={manualTaskId || activeTasks[0].id} onChange={(event) => onManualTaskChange(event.target.value)} aria-label="시간을 기록할 할 일">
              {activeTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
            <select value={manualMinutes} onChange={(event) => onManualMinutesChange(event.target.value)} aria-label="기록할 시간">
              {[10, 15, 25, 40, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes}분</option>)}
            </select>
            <button type="button" onClick={onRecordManualTime}>기록</button>
          </div>
        </details>
      )}
    </div>
  );
}

export function TodayScreen() {
  const { timeZone } = useTimeZone();
  const {
    tasks,
    outcomes,
    timeBlocks,
    timeEntries,
    timer,
    addTask,
    updateTask,
    rescheduleTask,
    removeTask,
    startTimer,
    toggleTimer,
    stopTimer,
    addManualTime,
    removeTimeEntry,
    saveTimeBlock,
    removeTimeBlock,
    restoreTimeBlock
  } = usePlanner();
  const today = getToday(new Date(), timeZone);
  const todayDate = today.isoDate;
  const [dateParams, setDateParams] = useSearchParams();
  const requestedDate = dateParams.get('date');
  const selectedDate = isLocalDate(requestedDate) ? requestedDate : todayDate;
  const setSelectedDate = (date: string | ((current: string) => string)) => setDateParams((previous) => {
    const next = new URLSearchParams(previous);
    const current = previous.get('date');
    next.set('date', typeof date === 'function' ? date(isLocalDate(current) ? current : todayDate) : date);
    return next;
  });
  const [memo, setMemo] = useState('');
  const [manualMinutes, setManualMinutes] = useState('25');
  const [manualTaskId, setManualTaskId] = useState('');
  const [manualNotice, setManualNotice] = useState<{ entryId: string; label: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [removedBlock, setRemovedBlock] = useState<TimeBlock | null>(null);
  const [mobileView, setMobileView] = useState<'tasks' | 'timeline'>('tasks');
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);
  const [scheduleDate, setScheduleDate] = useState(selectedDate);
  const [scheduleError, setScheduleError] = useState('');
  const [dateTask, setDateTask] = useState<Task | null>(null);
  const [targetDate, setTargetDate] = useState(selectedDate);
  const [dateError, setDateError] = useState('');
  const [completedNotice, setCompletedNotice] = useState<{ taskId: string; title: string; status: Task['status'] } | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask = tasks.find((task) => task.id === editingTaskId);
  const editTask = (task: Task) => {
    setNotice('');
    setEditingTaskId(task.id);
  };
  const [evidence, setEvidence] = useState('');
  const isCompact = useCompactLayout();
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineInitializedDate = useRef<string | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const currentMinute = useCurrentMinute(timeZone);
  const currentMinuteRef = useRef(currentMinute);
  currentMinuteRef.current = currentMinute;

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled'), [tasks]);
  const selectedBlocks = useMemo(() => getBlocksForDate(timeBlocks, selectedDate), [selectedDate, timeBlocks]);
  const scheduledTaskIds = useMemo(
    () => new Set(selectedBlocks.flatMap((block) => block.taskId && !block.external ? [block.taskId] : [])),
    [selectedBlocks]
  );
  const unscheduledTasks = useMemo(() => tasks.filter(task => task.status !== 'cancelled' && (task.plannedDate === selectedDate || scheduledTaskIds.has(task.id))), [tasks, selectedDate, scheduledTaskIds]);
  const inboxTasks = useMemo(() => activeTasks.filter(task => (!task.plannedDate || task.plannedDate === 'later') && !timeBlocks.some(block => block.taskId === task.id && !block.external)), [activeTasks, timeBlocks]);
  const selectedWeekOffset = getWeekOffsetForDate(selectedDate, new Date(), timeZone);
  const selectedWeekDays = getWeekDays(selectedWeekOffset, new Date(), timeZone);
  const selectedDay = getDayKeyForDate(selectedDate);
  const runningTask = timer ? tasks.find((task) => task.id === timer.taskId) : undefined;
  const elapsed = useTimerSeconds(timer?.startedAt ?? null, timer?.accumulatedSeconds ?? 0, timer?.paused ?? true);
  const plannedMinutes = selectedBlocks.filter((block) => !block.external).reduce((sum, block) => sum + block.durationMinutes, 0);
  const loggedSeconds = getLoggedSecondsForDate(timeEntries, selectedDate, timeZone);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  useEffect(() => {
    let focusFrame: number | null = null;
    const focusQuickCapture = () => {
      if (isCompact) setMobileView('tasks');
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        document.getElementById('quick-capture')?.focus();
      });
    };
    window.addEventListener(QUICK_CAPTURE_EVENT, focusQuickCapture);
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      window.removeEventListener(QUICK_CAPTURE_EVENT, focusQuickCapture);
    };
  }, [isCompact]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollArea = timelineScrollRef.current;
      if (!scrollArea || scrollArea.clientHeight === 0 || timelineInitializedDate.current === selectedDate) return;
      timelineInitializedDate.current = selectedDate;
      const targetMinute = selectedDate === todayDate ? currentMinuteRef.current : 8 * 60;
      const targetTop = (targetMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
      scrollArea.scrollTop = Math.max(0, Math.min(targetTop - (scrollArea.clientHeight / 2), scrollArea.scrollHeight - scrollArea.clientHeight));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, todayDate, mobileView, isCompact]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 3600);
  };

  const comparableBlocks = selectedBlocks.map((block) => ({ ...block, day: selectedDay, weekOffset: selectedWeekOffset }));
  const rangeConflicts = (range: DayMinuteRange, ignoreBlockId?: string) => findTimeBlockConflict(
    comparableBlocks,
    {
      day: selectedDay,
      startMinutes: range.startMinutes,
      durationMinutes: range.endMinutes - range.startMinutes,
      weekOffset: selectedWeekOffset
    },
    { ignoreBlockId }
  );

  const createTimelineItem = (input: TimelineCreateInput) => {
    if (!input.title.trim() || rangeConflicts(input.range)) return false;
    const durationMinutes = input.range.endMinutes - input.range.startMinutes;
    let taskId: string | null = null;
    if (input.kind === 'todo') {
      taskId = addTask({ title: input.title, outcomeId: null, estimateMinutes: durationMinutes, plannedDate: selectedDate });
      if (!taskId) return false;
    }
    const saved = saveTimeBlock({
      taskId,
      title: input.title,
      day: selectedDay,
      startMinutes: input.range.startMinutes,
      durationMinutes,
      date: selectedDate,
      weekOffset: selectedWeekOffset
    });
    if (!saved && taskId) removeTask(taskId);
    if (saved) showNotice(`${formatClock(input.range.startMinutes)}–${formatClock(input.range.endMinutes)}에 ${input.title.trim()}을 추가했습니다.`);
    return saved;
  };

  const scheduleTaskAt = (task: Task, range: DayMinuteRange) => {
    if (rangeConflicts(range)) return false;
    const saved = saveTimeBlock({
      taskId: task.id,
      taskPatch: { plannedDate: task.plannedDate && task.plannedDate !== 'later' ? task.plannedDate : selectedDate },
      title: task.title,
      day: selectedDay,
      startMinutes: range.startMinutes,
      durationMinutes: range.endMinutes - range.startMinutes,
      date: selectedDate,
      weekOffset: selectedWeekOffset
    });
    if (saved) showNotice(`${task.title}을 ${formatClock(range.startMinutes)}에 배치했습니다.`);
    return saved;
  };

  const updateBlockRange = (block: TimeBlock, range: DayMinuteRange, date = selectedDate, title = block.title) => {
    if (block.external) return false;
    const nextTitle = title.trim();
    const saved = saveTimeBlock({
      id: block.id,
      taskId: block.taskId,
      title: nextTitle,
      ...(block.taskId && nextTitle !== block.title ? { taskPatch: { title: nextTitle } } : {}),
      day: getDayKeyForDate(date),
      startMinutes: range.startMinutes,
      durationMinutes: range.endMinutes - range.startMinutes,
      date,
      weekOffset: getWeekOffsetForDate(date, new Date(), timeZone)
    });
    if (saved) showNotice(`${nextTitle}을 ${formatClock(range.startMinutes)}–${formatClock(range.endMinutes)}로 변경했습니다.`);
    return saved;
  };

  const removeBlockFromSchedule = (block: TimeBlock) => {
    if (!removeTimeBlock(block.id)) return;
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    setRemovedBlock(block);
    undoTimerRef.current = window.setTimeout(() => {
      setRemovedBlock((current) => current?.id === block.id ? null : current);
      undoTimerRef.current = null;
    }, 10_000);
  };

  const undoRemoveBlock = () => {
    if (!removedBlock) return;
    if (!restoreTimeBlock(removedBlock)) {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
      setRemovedBlock(null);
      showNotice('실행 취소 시간이 지났거나 일정·동기화 변경으로 복원할 수 없습니다.');
      return;
    }
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setRemovedBlock(null);
    showNotice(`${removedBlock.title} 일정을 같은 시간으로 복원했습니다.`);
  };

  const findAvailableRange = (task: Task): DayMinuteRange | null => {
    const durationMinutes = Math.max(15, task.estimateMinutes || 30);
    const preferredStart = selectedDate === todayDate ? Math.min(DAY_END_MINUTES, Math.ceil(currentMinute / 15) * 15) : 9 * 60;
    const futureStarts = Array.from(
      { length: Math.max(0, Math.floor((DAY_END_MINUTES - durationMinutes - preferredStart) / 15) + 1) },
      (_, index) => preferredStart + (index * 15)
    );
    const earlierStarts = selectedDate === todayDate
      ? []
      : Array.from(
        {
          length: Math.max(
            0,
            Math.floor(Math.min(preferredStart - 15, DAY_END_MINUTES - durationMinutes) / 15) + 1
          )
        },
        (_, index) => index * 15
      );
    const starts = [...futureStarts, ...earlierStarts];
    const startMinutes = starts.find((start) => !rangeConflicts({ startMinutes: start, endMinutes: start + durationMinutes }));
    return startMinutes === undefined ? null : { startMinutes, endMinutes: startMinutes + durationMinutes };
  };

  const addUnscheduledTask = (title: string) => {
    const taskId = addTask({ title, outcomeId: null, estimateMinutes: 30, plannedDate: selectedDate });
    if (taskId) showNotice(`${title.trim()}을 선택한 날짜에 추가했습니다. 시간은 아직 미정입니다.`);
  };

  const completeTask = (taskId: string) => {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    if (timer?.taskId === taskId) { setFinishOpen(true); return; }
    const status = task.status === 'done' ? 'todo' : 'done';
    if (updateTask(taskId, { status })) setCompletedNotice({ taskId, title: task.title, status: task.status });
  };

  const openSchedule = (task: Task) => {
    const existing = selectedBlocks.some(block => block.taskId === task.id && !block.external);
    setScheduleDate(!existing && !findAvailableRange(task) && selectedDate === todayDate ? addLocalDateDays(selectedDate, 1) : selectedDate);
    setScheduleError(''); setScheduleTask(task);
  };
  const saveTaskSchedule = (value: TimeBlockEditorValue) => {
    if (!scheduleTask) return;
    const saved = saveTimeBlock({ id: value.blockId, taskId: scheduleTask.id, title: value.title,
      taskPatch: { ...value.taskPatch, plannedDate: value.date ?? selectedDate },
      day: value.day, date: value.date, startMinutes: value.startMinutes, durationMinutes: value.durationMinutes });
    if (!saved) { setScheduleError('다른 일정과 겹치거나 저장할 수 없는 값입니다. 시간을 확인해 주세요.'); return; }
    setScheduleTask(null);
    showNotice('할 일과 시간표에 같은 일정이 반영됐습니다.');
  };
  const moveTaskDate = (date: string | null) => {
    if (!dateTask) return;
    if (!rescheduleTask(dateTask.id, selectedDate, date)) { setDateError('옮길 날짜에 겹치는 일정이 있거나 타이머가 실행 중입니다. 시간표를 확인해 주세요.'); return; }
    setDateTask(null);
    showNotice(date ? `${dateTask.title}을 ${date}로 옮겼습니다.` : '나중에 목록으로 옮기고 이 날짜의 시간 배치를 해제했습니다.');
  };

  const beginTaskDrag = (event: DragEvent<HTMLLIElement>, task: Task) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-goals-to-today-task', task.id);
    event.dataTransfer.setData('text/plain', task.id);
    setDraggingTask(task);
  };

  const beginTaskPlacement = (task: Task) => {
    setDraggingTask(task);
    showNotice(`${task.title}을 다시 배치할 빈 시간을 선택하세요.`);
  };

  const startOrToggleTask = (taskId: string) => {
    if (timer?.taskId === taskId) toggleTimer();
    else if (!timer) startTimer(taskId);
  };

  const recordManualTime = () => {
    const task = activeTasks.find((item) => item.id === (manualTaskId || activeTasks[0]?.id));
    const minutes = Number(manualMinutes);
    if (!task || !Number.isFinite(minutes) || minutes <= 0) return;
    const entryId = addManualTime(task.id, minutes);
    setManualNotice({ entryId, label: `${task.title}에 ${minutes}분을 기록했습니다.` });
    window.setTimeout(() => setManualNotice((current) => current?.entryId === entryId ? null : current), 5000);
  };

  const completeTimer = (completion: 'done' | 'continue') => {
    stopTimer(completion, evidence);
    setFinishOpen(false);
    setEvidence('');
  };

  const todoPanel = (
    <TodoPanel
      activeTasks={activeTasks}
      completedTasks={tasks.filter(task => (task.status === 'done' || task.status === 'cancelled') && !unscheduledTasks.some(item => item.id === task.id))}
      canRecordManualTime={selectedDate === todayDate}
      draggingTaskId={draggingTask?.id ?? null}
      mobile={isCompact}
      memo={memo}
      manualMinutes={manualMinutes}
      manualTaskId={manualTaskId}
      runningTaskId={timer?.taskId ?? null}
      timerPaused={timer?.paused ?? false}
      unscheduledTasks={unscheduledTasks}
      inboxTasks={inboxTasks}
      selectedBlocks={selectedBlocks}
      onAddTask={addUnscheduledTask}
      onComplete={completeTask}
      onPostpone={task => { setDateTask(task); setTargetDate(selectedDate); setDateError(''); }}
      onEdit={editTask}
      onDragEnd={() => setDraggingTask(null)}
      onDragStart={beginTaskDrag}
      onMemoChange={setMemo}
      onManualMinutesChange={setManualMinutes}
      onManualTaskChange={setManualTaskId}
      onRecordManualTime={recordManualTime}
      onScheduleNext={openSchedule}
      onStart={startOrToggleTask}
    />
  );

  return (
    <div className="today-direct-page">
      <header className="today-direct-header">
        <div className="today-direct-header__date">
          <span className="today-direct-kicker">TODAY</span>
          <h1>{formatDateLabel(selectedDate)}</h1>
        </div>
        <div className="today-direct-header__controls">
          <button type="button" aria-label="이전 날짜" onClick={() => setSelectedDate((date) => addLocalDateDays(date, -1))}><ChevronLeft /></button>
          <button type="button" onClick={() => setSelectedDate(todayDate)} disabled={selectedDate === todayDate}>오늘</button>
          <button type="button" aria-label="다음 날짜" onClick={() => setSelectedDate((date) => addLocalDateDays(date, 1))}><ChevronRight /></button>
        </div>
        <div className="today-direct-header__status">
          <span>{plannedMinutes > 0 ? `${formatMinutes(plannedMinutes)} 계획` : '계획 없음'}</span>
          <span>기록 {formatTimer(loggedSeconds)}</span>
          <SaveStatus />
        </div>
        <nav className="today-direct-week" aria-label="선택한 주">
          {selectedWeekDays.map((day) => (
            <button key={day.isoDate} type="button" className={day.isoDate === selectedDate ? 'is-selected' : day.isoDate === todayDate ? 'is-today' : ''} aria-current={day.isoDate === selectedDate ? 'date' : undefined} onClick={() => setSelectedDate(day.isoDate)}>
              <small>{day.short}</small><strong>{day.date}</strong>
            </button>
          ))}
        </nav>
      </header>

      {timer && runningTask && (
        <section className={`today-direct-timer${timer.paused ? ' is-paused' : ''}`} aria-label={timer.paused ? '현재 일시정지됨' : '현재 실행 중'}>
          <span><span className="today-direct-timer__pulse" /> {timer.paused ? '일시정지' : '지금 실행 중'}</span>
          <strong title={runningTask.title}>{runningTask.title}</strong>
          <time>{formatTimer(elapsed)}</time>
          <button type="button" onClick={toggleTimer}>{timer.paused ? <Play /> : <Pause />}{timer.paused ? '계속' : '멈춤'}</button>
          <button type="button" onClick={() => setFinishOpen(true)}><Square />종료</button>
        </section>
      )}

      <TodayGoalStrip date={selectedDate} />

      <div className="today-direct-workspace">
        {isCompact && <div className="today-mobile-views" aria-label="오늘 보기 선택">
          <button type="button" aria-pressed={mobileView === 'tasks'} onClick={() => setMobileView('tasks')}>할 일 <span>{unscheduledTasks.length}</span></button>
          <button type="button" aria-pressed={mobileView === 'timeline'} onClick={() => setMobileView('timeline')}>시간표 <span>{selectedBlocks.length}</span></button>
        </div>}
        <aside className="today-direct-sidebar" aria-label="선택한 날짜의 할 일" hidden={isCompact && mobileView !== 'tasks'}>{todoPanel}{!isCompact && <TodayReview date={selectedDate} />}</aside>
        <section className="today-direct-timeline-column" hidden={isCompact && mobileView !== 'timeline'} aria-label={`${formatDateLabel(selectedDate)} 24시간 시간표`}>
          <div className="today-direct-timeline-heading">
            <div>
              <span className="today-direct-kicker">일간 시간표</span>
              <h2>언제 할까요?</h2>
              <p>빈 시간을 눌러 시작·종료를 정하세요. 일정은 눌러 수정할 수 있어요.</p>
            </div>
            <span className="today-direct-timeline-heading__count">{selectedBlocks.length}개 일정</span>
          </div>
          <DayTimeline
            key={selectedDate}
            blocks={selectedBlocks}
            currentMinute={selectedDate === todayDate ? currentMinute : null}
            date={selectedDate}
            day={selectedDay}
            draggingTask={draggingTask}
            mobile={isCompact}
            runningTaskId={timer?.taskId ?? null}
            timerPaused={timer?.paused ?? false}
            scrollRef={timelineScrollRef}
            tasks={tasks}
            onCompleteTask={completeTask}
            onEditTask={editTask}
            onUpdateTask={updateTask}
            onCreate={createTimelineItem}
            onDragTaskEnd={() => setDraggingTask(null)}
            onRemoveBlock={removeBlockFromSchedule}
            onScheduleTask={scheduleTaskAt}
            onScheduleTaskAgain={beginTaskPlacement}
            onStartTask={startOrToggleTask}
            onUpdateBlock={updateBlockRange}
          />
        </section>

      </div>

      {isCompact && <TodayReview date={selectedDate} />}

      {removedBlock && <div className="today-direct-snackbar" role="status"><span>시간표에서 제거했습니다.</span><button type="button" onClick={undoRemoveBlock}>실행 취소</button></div>}
      {completedNotice && <div className="today-direct-snackbar" role="status"><span>{completedNotice.title} · {completedNotice.status === 'done' ? '다시 열었습니다' : '완료했습니다'}</span><button type="button" onClick={() => { updateTask(completedNotice.taskId, { status: completedNotice.status }); setCompletedNotice(null); }}>완료 실행 취소</button><button type="button" aria-label="완료 안내 닫기" onClick={() => setCompletedNotice(null)}><X size={16} /></button></div>}
      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}
      {manualNotice && (
        <div className="toast toast--action" role="status"><span><TimerReset size={16} /> {manualNotice.label}</span><button type="button" onClick={() => { removeTimeEntry(manualNotice.entryId); setManualNotice(null); }}>실행 취소</button></div>
      )}

      {editingTask && (
        <TaskEditorSheet key={editingTask.id} task={editingTask} outcomes={outcomes}
          contextual onSchedule={() => { setEditingTaskId(null); openSchedule(editingTask); }}
          onChangeDate={() => { setEditingTaskId(null); setDateTask(editingTask); setTargetDate(selectedDate); setDateError(''); }}
          blockCount={timeBlocks.filter((block) => block.taskId === editingTask.id).length}
          entryCount={timeEntries.filter((entry) => entry.taskId === editingTask.id).length}
          onSave={(input) => {
            const saved = updateTask(editingTask.id, input);
            if (saved) showNotice('할 일을 수정했습니다.');
            return saved;
          }}
          onDelete={() => {
            const removed = removeTask(editingTask.id);
            if (removed) showNotice('할 일과 연결 기록을 삭제했습니다.');
            return removed;
          }}
          onClose={() => setEditingTaskId(null)} />
      )}

      {scheduleTask && <TimeBlockSheet tasks={tasks.filter(task => task.id === scheduleTask.id)} outcomes={outcomes}
        taskOnly
        initialTaskId={scheduleTask.id} initialBlockId={selectedBlocks.find(block => block.taskId === scheduleTask.id && !block.external)?.id}
        initialDay={getDayKeyForDate(scheduleDate)} initialDate={scheduleDate}
        initialStartMinutes={selectedBlocks.find(block => block.taskId === scheduleTask.id && !block.external)?.startMinutes ?? (scheduleDate === selectedDate ? findAvailableRange(scheduleTask)?.startMinutes : null) ?? 9 * 60}
        initialDurationMinutes={selectedBlocks.find(block => block.taskId === scheduleTask.id && !block.external)?.durationMinutes ?? Math.min(scheduleTask.estimateMinutes, 120)}
        error={scheduleError} onSave={saveTaskSchedule} onClose={() => setScheduleTask(null)} />}

      {dateTask && <Modal title="언제 할 일인가요?" description={`${dateTask.title} · 이 날짜의 시간 블록도 함께 옮깁니다. 다른 날짜의 블록과 실행 기록은 유지됩니다.`} onClose={() => setDateTask(null)} className="task-date-sheet">
        <div className="task-date-shortcuts">
          <button type="button" onClick={() => moveTaskDate(addLocalDateDays(selectedDate, 1))}>내일로 미루기</button>
          <button type="button" onClick={() => { const day = parseLocalDate(selectedDate)?.getDay() ?? 0; moveTaskDate(addLocalDateDays(selectedDate, day === 1 ? 7 : (8 - day) % 7)); }}>다음 월요일</button>
          <button type="button" onClick={() => moveTaskDate(null)}>나중에 · 시간 해제</button>
        </div>
        <form onSubmit={event => { event.preventDefault(); moveTaskDate(targetDate); }}>
          <label className="field"><span className="field-label">날짜 선택</span><input aria-label="할 일 날짜" type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} required /></label>
          {dateError && <p className="form-error" role="alert">{dateError}</p>}
          <div className="modal__actions"><button className="button button--secondary" type="button" onClick={() => setDateTask(null)}>취소</button><button className="button button--primary" type="submit">이 날짜로 이동</button></div>
        </form>
      </Modal>}

      {finishOpen && timer && runningTask && (
        <Modal title="이번 실행을 정리할까요?" description={`타이머 ${formatTimer(elapsed)}의 결과를 기록합니다.`} onClose={() => setFinishOpen(false)} className="finish-modal finish-panel">
          <div className="finish-panel__elapsed" aria-label="종료할 실행 시간"><span>기록된 실행</span><strong>{formatTimer(elapsed)}</strong></div>
          <label className="field"><span className="field-label">남길 근거 또는 한 줄 메모 <small>선택</small></span><textarea data-autofocus rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="예: 완료한 결과나 이어서 할 일" /></label>
          <div className="finish-options">
            <button className="finish-option" type="button" onClick={() => completeTimer('continue')}><Play size={20} /><span><strong>다음에도 이어서</strong><small>진행 중으로 유지합니다.</small></span></button>
            <button className="finish-option finish-option--done" type="button" onClick={() => completeTimer('done')}><Check size={20} /><span><strong>이 작업은 완료</strong><small>완료 목록으로 옮깁니다.</small></span></button>
          </div>
        </Modal>
      )}
    </div>
  );
}
