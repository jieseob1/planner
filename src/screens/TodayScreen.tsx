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
  canRecordManualTime: boolean;
  draggingTaskId: string | null;
  mobile?: boolean;
  memo: string;
  manualMinutes: string;
  manualTaskId: string;
  runningTaskId: string | null;
  timerPaused: boolean;
  unscheduledTasks: Task[];
  onAddTask: (title: string) => void;
  onComplete: (taskId: string) => void;
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
  canRecordManualTime,
  draggingTaskId,
  mobile = false,
  memo,
  manualMinutes,
  manualTaskId,
  runningTaskId,
  timerPaused,
  unscheduledTasks,
  onAddTask,
  onComplete,
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
          <span className="today-direct-kicker">시간 미정</span>
          <h2>아직 배치하지 않은 할 일</h2>
        </div>
        <strong aria-label={`미배치 할 일 ${unscheduledTasks.length}개`}>{unscheduledTasks.length}</strong>
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
          placeholder="할 일 추가"
          autoComplete="off"
        />
        <button type="submit" disabled={!title.trim()}>추가</button>
      </form>

      {unscheduledTasks.length > 0 ? (
        <ul className="today-direct-todo-list">
          {unscheduledTasks.map((task) => {
            const isRunning = runningTaskId === task.id;
            const isPaused = isRunning && timerPaused;
            const timerAction = isRunning ? (isPaused ? '계속' : '멈춤') : '시작';
            const otherTimerStatus = timerPaused ? '다른 할 일 일시정지 중' : '다른 할 일 실행 중';
            const timerLabel = isRunning ? `타이머 ${timerAction}` : runningTaskId ? otherTimerStatus : '타이머 시작';
            return (
              <li
                key={task.id}
                draggable={!mobile}
                className={draggingTaskId === task.id ? 'is-dragging' : ''}
                onDragStart={(event) => onDragStart(event, task)}
                onDragEnd={onDragEnd}
              >
                <GripVertical className="today-direct-todo__grip" size={16} aria-hidden="true" />
                <button className="today-direct-todo__check" type="button" aria-label={`${task.title} 완료 처리`} title="완료" onClick={() => onComplete(task.id)}>
                  <Check size={14} aria-hidden="true" />
                </button>
                <div className="today-direct-todo__copy">
                  <strong title={task.title}>
                    {task.pinned && <Star size={13} fill="currentColor" aria-label="Top 3" />}
                    <span>{task.title}</span>
                  </strong>
                  <small>
                    <Clock3 size={13} aria-hidden="true" /> {formatMinutes(task.estimateMinutes)}
                    {task.carryCount > 0 && <span> · 이월 {task.carryCount}회</span>}
                  </small>
                </div>
                <button className="today-direct-todo__schedule" type="button" aria-label={`${task.title} 다음 빈 시간에 배치`} title="다음 빈 시간에 배치" onClick={() => onScheduleNext(task)}>
                  <CalendarDays size={15} aria-hidden="true" /><span>배치</span>
                </button>
                <button
                  className="today-direct-todo__start"
                  type="button"
                  aria-label={`${task.title} ${timerLabel}`}
                  title={timerLabel}
                  disabled={Boolean(runningTaskId && !isRunning)}
                  onClick={() => onStart(task.id)}
                >
                  {isRunning && !isPaused ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  <span>{isRunning ? timerAction : runningTaskId ? timerPaused ? '일시정지 중' : '실행 중' : '시작'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="today-direct-todos__empty">모든 할 일의 시간을 정했어요. 새 할 일을 추가하거나 시간표의 빈 곳을 누르세요.</p>
      )}

      <p className="today-direct-todos__hint">데스크톱에서는 할 일을 시간표로 끌어 원하는 시각에 바로 놓을 수 있습니다.</p>

      <details className="today-direct-utility">
        <summary><StickyNote size={15} /> 오늘 메모</summary>
        <textarea value={memo} onChange={(event) => onMemoChange(event.target.value)} placeholder="실행 중 참고할 내용을 적어두세요." aria-label="오늘 메모" />
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
    timeBlocks,
    timeEntries,
    timer,
    addTask,
    updateTask,
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
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [memo, setMemo] = useState(loadTodayMemo);
  const [manualMinutes, setManualMinutes] = useState('25');
  const [manualTaskId, setManualTaskId] = useState('');
  const [manualNotice, setManualNotice] = useState<{ entryId: string; label: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [removedBlock, setRemovedBlock] = useState<TimeBlock | null>(null);
  const [mobileTodosOpen, setMobileTodosOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const isCompact = useCompactLayout();
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const mobileTodoSheetRef = useRef<HTMLElement>(null);
  const mobileTodoTriggerRef = useRef<HTMLButtonElement>(null);
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
  const unscheduledTasks = useMemo(() => activeTasks.filter((task) => !scheduledTaskIds.has(task.id)), [activeTasks, scheduledTaskIds]);
  const selectedWeekOffset = getWeekOffsetForDate(selectedDate, new Date(), timeZone);
  const selectedWeekDays = getWeekDays(selectedWeekOffset, new Date(), timeZone);
  const selectedDay = getDayKeyForDate(selectedDate);
  const runningTask = timer ? tasks.find((task) => task.id === timer.taskId) : undefined;
  const elapsed = useTimerSeconds(timer?.startedAt ?? null, timer?.accumulatedSeconds ?? 0, timer?.paused ?? true);
  const plannedMinutes = selectedBlocks.filter((block) => !block.external).reduce((sum, block) => sum + block.durationMinutes, 0);
  const loggedSeconds = getLoggedSecondsForDate(timeEntries, selectedDate, timeZone);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEMO_STORAGE_KEY, memo);
    } catch {
      // The memo stays available in memory when storage is unavailable.
    }
  }, [memo]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  useEffect(() => {
    let focusFrame: number | null = null;
    const focusQuickCapture = () => {
      if (isCompact) setMobileTodosOpen(true);
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
      if (!scrollArea) return;
      const targetMinute = selectedDate === todayDate ? currentMinuteRef.current : 8 * 60;
      const targetTop = (targetMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
      scrollArea.scrollTop = Math.max(0, Math.min(targetTop - (scrollArea.clientHeight / 2), scrollArea.scrollHeight - scrollArea.clientHeight));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, todayDate]);

  useEffect(() => {
    if (!mobileTodosOpen || !isCompact) return undefined;
    const sheet = mobileTodoSheetRef.current;
    const closeOnBack = () => setMobileTodosOpen(false);
    const handleDialogKeys = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.history.back();
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => {
        const closedDetails = element.closest<HTMLDetailsElement>('details:not([open])');
        if (closedDetails && element !== closedDetails.querySelector(':scope > summary')) return false;
        return element.getClientRects().length > 0;
      });
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        sheet.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.history.pushState({ ...window.history.state, todayTodosOpen: true }, '');
    window.addEventListener('popstate', closeOnBack);
    window.addEventListener('keydown', handleDialogKeys);
    const frame = window.requestAnimationFrame(() => {
      sheet?.querySelector<HTMLInputElement>('input')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('popstate', closeOnBack);
      window.removeEventListener('keydown', handleDialogKeys);
      mobileTodoTriggerRef.current?.focus();
    };
  }, [isCompact, mobileTodosOpen]);

  useEffect(() => {
    if (isCompact || !mobileTodosOpen) return;
    setMobileTodosOpen(false);
    if (window.history.state?.todayTodosOpen) window.history.back();
  }, [isCompact, mobileTodosOpen]);

  const closeMobileTodos = () => {
    if (window.history.state?.todayTodosOpen) window.history.back();
    else setMobileTodosOpen(false);
  };

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
      taskId = addTask({ title: input.title, outcomeId: null, estimateMinutes: durationMinutes });
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

  const scheduleAtNextAvailableTime = (task: Task) => {
    const range = findAvailableRange(task);
    if (!range) {
      showNotice('이 날짜에는 배치할 수 있는 빈 시간이 없습니다.');
      return false;
    }
    return scheduleTaskAt(task, range);
  };

  const addUnscheduledTask = (title: string) => {
    const taskId = addTask({ title, outcomeId: null, estimateMinutes: 30 });
    if (taskId) showNotice(`${title.trim()}을 시간 미정 목록에 추가했습니다.`);
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
      canRecordManualTime={selectedDate === todayDate}
      draggingTaskId={draggingTask?.id ?? null}
      mobile={isCompact}
      memo={memo}
      manualMinutes={manualMinutes}
      manualTaskId={manualTaskId}
      runningTaskId={timer?.taskId ?? null}
      timerPaused={timer?.paused ?? false}
      unscheduledTasks={unscheduledTasks}
      onAddTask={addUnscheduledTask}
      onComplete={(taskId) => updateTask(taskId, { status: 'done' })}
      onDragEnd={() => setDraggingTask(null)}
      onDragStart={beginTaskDrag}
      onMemoChange={setMemo}
      onManualMinutesChange={setManualMinutes}
      onManualTaskChange={setManualTaskId}
      onRecordManualTime={recordManualTime}
      onScheduleNext={scheduleAtNextAvailableTime}
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

      <div className="today-direct-workspace">
        <section className="today-direct-timeline-column" aria-label={`${formatDateLabel(selectedDate)} 24시간 시간표`}>
          <div className="today-direct-timeline-heading">
            <div>
              <span className="today-direct-kicker">일간 시간표</span>
              <h2>{selectedDate === todayDate ? '오늘을 시간 위에 놓아보세요' : `${formatDateLabel(selectedDate)} 일정`}</h2>
              <p>빈 시간을 누르거나 드래그해 바로 만들고, 블록을 움직여 시간을 바꿀 수 있습니다.</p>
            </div>
            {isCompact ? (
              <button
                ref={mobileTodoTriggerRef}
                type="button"
                className="today-direct-mobile-todos"
                aria-label={`시간 미정 할 일 ${unscheduledTasks.length}개 열기`}
                aria-expanded={mobileTodosOpen}
                aria-controls="today-mobile-todo-sheet"
                onClick={() => setMobileTodosOpen(true)}
              >
                <CalendarDays aria-hidden="true" /> <span>미배치</span> <strong>{unscheduledTasks.length}</strong>
              </button>
            ) : (
              <span className="today-direct-timeline-heading__count">{selectedBlocks.length}개 일정</span>
            )}
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
            onCompleteTask={(taskId) => updateTask(taskId, { status: 'done' })}
            onCreate={createTimelineItem}
            onDragTaskEnd={() => setDraggingTask(null)}
            onRemoveBlock={removeBlockFromSchedule}
            onScheduleTask={scheduleTaskAt}
            onScheduleTaskAgain={beginTaskPlacement}
            onStartTask={startOrToggleTask}
            onUpdateBlock={updateBlockRange}
          />
        </section>

        {!isCompact && <aside className="today-direct-sidebar" aria-label="미배치 할 일">{todoPanel}</aside>}
      </div>

      {isCompact && (
        <>
          {mobileTodosOpen && (
            <div className="today-direct-sheet-layer">
              <button className="today-direct-sheet-backdrop" type="button" aria-label="할 일 목록 닫기" onClick={closeMobileTodos} />
              <section
                ref={mobileTodoSheetRef}
                id="today-mobile-todo-sheet"
                className="today-direct-sheet"
                role="dialog"
                aria-label="시간 미정 할 일"
                aria-modal="true"
                tabIndex={-1}
              >
                <header><span>다음 빈 시간에 바로 배치하거나 새 할 일을 추가하세요.</span><button type="button" aria-label="할 일 목록 닫기" onClick={closeMobileTodos}><X /></button></header>
                {todoPanel}
              </section>
            </div>
          )}
        </>
      )}

      {removedBlock && <div className="today-direct-snackbar" role="status"><span>시간표에서 제거했습니다.</span><button type="button" onClick={undoRemoveBlock}>실행 취소</button></div>}
      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}
      {manualNotice && (
        <div className="toast toast--action" role="status"><span><TimerReset size={16} /> {manualNotice.label}</span><button type="button" onClick={() => { removeTimeEntry(manualNotice.entryId); setManualNotice(null); }}>실행 취소</button></div>
      )}

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
