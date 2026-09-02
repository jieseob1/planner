import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react';
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  GripVertical,
  Pause,
  Play,
  Plus,
  Square,
  StickyNote,
  TimerReset
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { SaveStatus } from '../components/SaveStatus';
import { TimeBlockSheet, type TimeBlockEditorValue, type TimeBlockMode } from '../components/TimeBlockSheet';
import { formatClock, formatMinutes, formatTimer } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import type { Task, TimeBlock, TimeEntry } from '../domain/types';
import { getMinuteOfDay, getToday, getWeekDays, isInstantOnLocalDate } from '../lib/calendarDate';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const DAY_START_MINUTES = 0;
const DAY_END_MINUTES = 24 * 60;
const DAY_SLOT_MINUTES = 60;
const DAY_HOUR_HEIGHT = 54;
const MEMO_STORAGE_KEY = 'goals-to-today.today-memo.v1';

function loadTodayMemo() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(MEMO_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

const dayHours = Array.from(
  { length: ((DAY_END_MINUTES - DAY_START_MINUTES) / 60) + 1 },
  (_, index) => DAY_START_MINUTES + (index * 60)
);
const daySlots = Array.from(
  { length: (DAY_END_MINUTES - DAY_START_MINUTES) / DAY_SLOT_MINUTES },
  (_, index) => DAY_START_MINUTES + (index * DAY_SLOT_MINUTES)
);

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

interface TimeBlockDraft {
  blockId?: string;
  taskId: string;
  title: string;
  startMinutes: number;
  durationMinutes: number;
  mode?: TimeBlockMode;
}

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

export function TodayScreen() {
  const { timeZone } = useTimeZone();
  const {
    tasks,
    outcomes,
    timeBlocks,
    timeEntries,
    timer,
    quickCapture,
    addTask,
    updateTask,
    startTimer,
    toggleTimer,
    stopTimer,
    addManualTime,
    removeTimeEntry,
    saveTimeBlock,
    removeTimeBlock
  } = usePlanner();
  const [capture, setCapture] = useState('');
  const [captured, setCaptured] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [manualMinutes, setManualMinutes] = useState('25');
  const [memo, setMemo] = useState(loadTodayMemo);
  const [manualNotice, setManualNotice] = useState<{
    entryId: string;
    taskTitle: string;
    minutes: number;
  } | null>(null);
  const [timeBlockDraft, setTimeBlockDraft] = useState<TimeBlockDraft | null>(null);
  const [timeBlockError, setTimeBlockError] = useState('');
  const [timeBlockNotice, setTimeBlockNotice] = useState('');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetMinutes, setDropTargetMinutes] = useState<number | null>(null);
  const scheduleScrollRef = useRef<HTMLDivElement>(null);

  const calendarNow = new Date();
  const today = getToday(calendarNow, timeZone);
  const todayDate = today.isoDate;
  const currentWeekDays = getWeekDays(0, calendarNow, timeZone);
  const currentMinute = useCurrentMinute(timeZone);
  const currentTimeTop = Math.round(
    (((currentMinute - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT) * 10
  ) / 10;

  useEffect(() => {
    try {
      window.localStorage.setItem(MEMO_STORAGE_KEY, memo);
    } catch {
      // Keep the memo usable in-memory if browser storage is unavailable.
    }
  }, [memo]);

  useEffect(() => {
    const scrollArea = scheduleScrollRef.current;
    if (!scrollArea || scrollArea.dataset.initialized === 'true') return;
    scrollArea.scrollTop = 7 * DAY_HOUR_HEIGHT;
    scrollArea.dataset.initialized = 'true';
  }, []);

  const activeTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const focusTask = timer
    ? tasks.find((task) => task.id === timer.taskId)
    : activeTasks.find((task) => task.pinned) ?? activeTasks[0];
  const focusOutcome = outcomes.find((outcome) => outcome.id === focusTask?.outcomeId);
  const remainingTasks = activeTasks.filter((task) => task.id !== focusTask?.id);
  const todayTasks = remainingTasks.slice(0, 5);
  const laterTasks = remainingTasks.slice(5);
  const todayBlocks = useMemo(
    () => getBlocksForDate(timeBlocks, todayDate),
    [timeBlocks, todayDate]
  );
  const todayCollisionBlocks = useMemo(
    () => todayBlocks.map((block) => ({ ...block, day: today.key, weekOffset: 0 })),
    [today.key, todayBlocks]
  );
  const nextBlock = getNextScheduledBlock(todayBlocks, currentMinute);
  const elapsed = useTimerSeconds(timer?.startedAt ?? null, timer?.accumulatedSeconds ?? 0, timer?.paused ?? true);
  const loggedToday = getLoggedSecondsForDate(timeEntries, todayDate, timeZone);
  const plannedTodayMinutes = todayBlocks
    .filter((block) => !block.external)
    .reduce((sum, block) => sum + block.durationMinutes, 0);

  const captureTask = () => {
    if (!capture.trim()) return;
    quickCapture(capture);
    setCapture('');
    setCaptured(true);
    window.setTimeout(() => setCaptured(false), 1800);
  };

  const onCapture = (event: FormEvent) => {
    event.preventDefault();
    captureTask();
  };

  const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    captureTask();
  };

  const completeTimer = (completion: 'done' | 'continue') => {
    stopTimer(completion, evidence);
    setFinishOpen(false);
    setEvidence('');
  };

  const recordManualTime = (taskId: string, taskTitle: string) => {
    const minutes = Number(manualMinutes);
    const entryId = addManualTime(taskId, minutes);
    setManualNotice({ entryId, taskTitle, minutes });
    window.setTimeout(() => {
      setManualNotice((current) => current?.entryId === entryId ? null : current);
    }, 5000);
  };

  const openTimeBlock = (startMinutes: number, blockId?: string, preferredTaskId?: string) => {
    const block = blockId ? todayBlocks.find((item) => item.id === blockId) : undefined;
    const task = activeTasks.find((item) => item.id === (block?.taskId ?? preferredTaskId))
      ?? focusTask
      ?? activeTasks[0];
    setTimeBlockError('');
    setTimeBlockDraft({
      blockId: block?.id,
      taskId: block ? block.taskId ?? '' : task?.id ?? '',
      title: block?.title ?? '',
      startMinutes,
      durationMinutes: block?.durationMinutes ?? task?.estimateMinutes ?? 30,
      mode: block ? (block.taskId ? 'existing-task' : 'event') : undefined
    });
  };

  const findAvailableStart = (task?: Task) => {
    const durationMinutes = task?.estimateMinutes ?? 30;
    const roundedNow = Math.max(0, Math.ceil(currentMinute / DAY_SLOT_MINUTES) * DAY_SLOT_MINUTES);
    return daySlots.find((startMinutes) => (
      startMinutes >= roundedNow
      && !findTimeBlockConflict(todayCollisionBlocks, {
        day: today.key,
        startMinutes,
        durationMinutes,
        weekOffset: 0
      })
    )) ?? daySlots.find((startMinutes) => !findTimeBlockConflict(todayCollisionBlocks, {
      day: today.key,
      startMinutes,
      durationMinutes,
      weekOffset: 0
    })) ?? 18 * 60;
  };

  const openTaskSchedule = (task: Task) => {
    openTimeBlock(findAvailableStart(task), undefined, task.id);
  };

  const beginTaskDrag = (event: DragEvent<HTMLElement>, task: Task) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    setDraggingTaskId(task.id);
  };

  const dropTaskAt = (event: DragEvent<HTMLButtonElement>, startMinutes: number) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
    setDraggingTaskId(null);
    setDropTargetMinutes(null);
    if (taskId) openTimeBlock(startMinutes, undefined, taskId);
  };

  const saveTimeBlockDraft = (value: TimeBlockEditorValue) => {
    const conflict = findTimeBlockConflict(todayCollisionBlocks, {
      day: today.key,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      weekOffset: 0
    }, { ignoreBlockId: value.blockId });
    if (conflict) {
      setTimeBlockError(`${formatClock(conflict.startMinutes)} ${conflict.title}과 시간이 겹칩니다.`);
      return;
    }

    let taskId = value.taskId;
    if (value.mode === 'new-task') {
      taskId = addTask({
        title: value.title,
        outcomeId: value.outcomeId,
        estimateMinutes: value.durationMinutes
      });
      if (!taskId) {
        setTimeBlockError('새 할 일을 만들지 못했습니다. 제목과 목표 연결을 확인해 주세요.');
        return;
      }
    }

    const saved = saveTimeBlock({
      id: value.blockId,
      taskId: value.mode === 'event' ? null : taskId,
      title: value.title,
      day: today.key,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      date: todayDate,
      weekOffset: 0
    });
    if (!saved) {
      setTimeBlockError('다른 일정과 시간이 겹칩니다. 시작이나 종료 시간을 바꿔주세요.');
      return;
    }

    const endMinutes = value.startMinutes + value.durationMinutes;
    setTimeBlockDraft(null);
    setTimeBlockError('');
    setTimeBlockNotice(`${formatClock(value.startMinutes)}–${formatClock(endMinutes)} · ${value.title}을 계획했어요.`);
    window.setTimeout(() => setTimeBlockNotice(''), 3200);
  };

  const deleteTimeBlock = () => {
    if (!timeBlockDraft?.blockId || !removeTimeBlock(timeBlockDraft.blockId)) return;
    setTimeBlockDraft(null);
    setTimeBlockError('');
    setTimeBlockNotice('일정에서 삭제했어요. 연결된 할 일은 그대로 남아 있습니다.');
    window.setTimeout(() => setTimeBlockNotice(''), 3200);
  };

  const renderTaskRow = (task: Task) => {
    const isRunning = timer?.taskId === task.id;
    const outcome = outcomes.find((item) => item.id === task.outcomeId);
    return (
      <li
        key={task.id}
        className={isRunning ? 'focus-task-row focus-task-row--running' : 'focus-task-row'}
        draggable
        onDragStart={(event) => beginTaskDrag(event, task)}
        onDragEnd={() => {
          setDraggingTaskId(null);
          setDropTargetMinutes(null);
        }}
      >
        <GripVertical className="focus-task-row__grip" size={16} aria-hidden="true" />
        <button
          className="focus-task-row__check"
          type="button"
          aria-label={`${task.title} 완료 처리`}
          onClick={() => updateTask(task.id, { status: 'done' })}
        >
          <Check size={14} aria-hidden="true" />
        </button>
        <div className="focus-task-row__copy">
          <strong>{task.title}</strong>
          <span>{outcome?.title ?? '목표 연결 없음'}</span>
        </div>
        <span className="focus-task-row__duration"><Clock3 size={14} /> {formatMinutes(task.estimateMinutes)}</span>
        <button
          className="focus-task-row__schedule"
          type="button"
          aria-label={`${task.title} 시간 정하기`}
          onClick={() => openTaskSchedule(task)}
        >
          <CalendarPlus size={16} aria-hidden="true" />
          <span>시간</span>
        </button>
        <button
          className="focus-task-row__start"
          type="button"
          disabled={Boolean(timer && !isRunning)}
          onClick={() => isRunning ? toggleTimer() : startTimer(task.id)}
        >
          {isRunning && !timer?.paused
            ? <Pause size={15} fill="currentColor" aria-hidden="true" />
            : <Play size={15} fill="currentColor" aria-hidden="true" />}
          {isRunning ? timer?.paused ? '계속' : '멈춤' : timer ? '실행 중' : '시작'}
        </button>
      </li>
    );
  };

  return (
    <div className="today-focus-page">
      <div className="today-focus-workspace">
        <main className="today-task-pane">
          <header className="today-focus-header">
            <div className="today-focus-header__title">
              <h1 aria-label="오늘 할 일과 일정을 정리합니다."><span aria-hidden="true">오늘</span></h1>
              <p>{todayDate.slice(0, 4)}년 {today.month}월 {today.date}일 {today.long}</p>
            </div>
            <div className="today-week-strip" aria-label="이번 주">
              {currentWeekDays.map((day) => (
                <span key={day.isoDate} className={day.isoDate === todayDate ? 'is-today' : ''}>
                  <small>{day.short}</small>
                  <strong>{day.date}</strong>
                </span>
              ))}
            </div>
            <div className="today-focus-header__actions">
              <SaveStatus />
              <a className="today-focus-header__timeline-link" href="#today-timeline">
                <CalendarClock size={16} aria-hidden="true" /> 시간표 보기
              </a>
            </div>
          </header>

          <form className="today-inline-capture" onSubmit={onCapture}>
            <Plus size={19} aria-hidden="true" />
            <label className="sr-only" htmlFor="quick-capture">빠른 메모</label>
            <input
              id="quick-capture"
              value={capture}
              onChange={(event) => setCapture(event.target.value)}
              onKeyDown={onCaptureKeyDown}
              placeholder="할 일 추가"
              autoComplete="off"
            />
            <span>Enter로 추가</span>
            <button type="submit" disabled={!capture.trim()}>추가</button>
          </form>
          {captured && <p className="today-capture-confirm" role="status"><Check size={14} /> 수집함에 넣었어요.</p>}

          <section className="today-now" aria-labelledby="today-now-title">
            <header className="today-section-heading">
              <div>
                <span className="today-section-kicker"><CircleDot size={13} /> 지금</span>
                <h2 id="today-now-title">가장 먼저 끝낼 일</h2>
              </div>
              <div className="today-plan-status" aria-label="오늘 실행 현황">
                <span>{plannedTodayMinutes > 0 ? `${formatMinutes(plannedTodayMinutes)} 계획` : '계획 없음'}</span>
                <span>기록 {formatTimer(loggedToday)}</span>
              </div>
            </header>

            {focusTask ? (
              <article className={timer ? 'today-now-card today-now-card--running' : 'today-now-card'}>
                <div className="today-now-card__lead">
                  <button
                    type="button"
                    aria-label={`${focusTask.title} 완료 처리`}
                    onClick={() => updateTask(focusTask.id, { status: 'done' })}
                  >
                    <CheckCircle2 size={21} aria-hidden="true" />
                  </button>
                  <div>
                    {timer && <span className="today-now-card__running"><CircleDot size={12} /> 지금 실행 중</span>}
                    <strong>{focusTask.title}</strong>
                    <small>{focusOutcome?.title ?? '목표 연결 없음'} · {formatMinutes(focusTask.estimateMinutes)}</small>
                  </div>
                </div>
                {timer ? (
                  <div className="today-now-card__timer">
                    <strong>{formatTimer(elapsed)}</strong>
                    <button className="button button--secondary button--small" type="button" onClick={toggleTimer}>
                      {timer.paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
                      {timer.paused ? '계속' : '잠시 멈춤'}
                    </button>
                    <button className="button button--primary button--small" type="button" onClick={() => setFinishOpen(true)}>
                      <Square size={14} fill="currentColor" /> 종료
                    </button>
                  </div>
                ) : (
                  <div className="today-now-card__actions">
                    <button className="button button--secondary" type="button" onClick={() => openTaskSchedule(focusTask)}>
                      <CalendarPlus size={16} /> 시간 정하기
                    </button>
                    <button className="button button--primary" type="button" onClick={() => startTimer(focusTask.id)}>
                      <Play size={16} fill="currentColor" /> 지금 시작
                    </button>
                  </div>
                )}
              </article>
            ) : (
              <div className="today-empty-state"><CheckCircle2 size={24} /><strong>오늘 할 일을 모두 마쳤어요.</strong></div>
            )}

            <div className="today-next-line">
              <div>
                <span>다음 일정</span>
                <h3>바로 이어갈 시간</h3>
              </div>
              {nextBlock ? (
                <button type="button" onClick={() => openTimeBlock(nextBlock.startMinutes, nextBlock.external ? undefined : nextBlock.id)}>
                  <time>{formatClock(nextBlock.startMinutes)}</time>
                  <span>{nextBlock.title}</span>
                  <small>{formatClock(nextBlock.startMinutes + nextBlock.durationMinutes)}까지</small>
                </button>
              ) : (
                <button type="button" onClick={() => openTimeBlock(findAvailableStart(focusTask))}>
                  <CalendarPlus size={15} /> 비어 있는 시간에 일정 추가
                </button>
              )}
            </div>
          </section>

          <section className="today-task-section" aria-labelledby="today-list-title">
            <header className="today-section-heading today-section-heading--compact">
              <div><h2 id="today-list-title" aria-label="내가 고르는 실행 순서"><span aria-hidden="true">오늘</span></h2><span>{todayTasks.length}개</span></div>
              <small>끌어서 오른쪽 시간표에 놓을 수 있어요.</small>
            </header>
            {todayTasks.length > 0 ? <ul className="focus-task-list">{todayTasks.map(renderTaskRow)}</ul> : (
              <p className="today-list-empty">추가된 할 일이 없습니다.</p>
            )}
          </section>

          <details className="today-later" open={laterTasks.length > 0}>
            <summary>
              <span><ChevronDown size={16} /> 나중에</span>
              <small>{laterTasks.length}개</small>
            </summary>
            {laterTasks.length > 0 ? <ul className="focus-task-list">{laterTasks.map(renderTaskRow)}</ul> : (
              <p className="today-list-empty">오늘 이후로 미뤄둔 일이 없습니다.</p>
            )}
          </details>

          <details className="today-memo">
            <summary><StickyNote size={16} /> 메모 <small>{memo.trim() ? '저장됨' : '접기/펼치기'}</small></summary>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="떠오른 생각이나 참고할 내용을 적어두세요."
              aria-label="오늘 메모"
            />
          </details>

          {focusTask && (
            <details className="today-manual-time">
              <summary><TimerReset size={16} /> 수동으로 시간 기록</summary>
              <div>
                <select value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} aria-label="기록할 시간">
                  {[10, 15, 25, 40, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes}분</option>)}
                </select>
                <button className="button button--secondary" type="button" onClick={() => recordManualTime(focusTask.id, focusTask.title)}>
                  시간 추가
                </button>
              </div>
            </details>
          )}
        </main>

        <section id="today-timeline" className="today-schedule-pane" aria-label="계획과 실제 흐름">
          <header className="today-schedule-header">
            <div>
              <h2>{todayDate.slice(0, 4)}년 {today.month}월 {today.date}일 {today.long}</h2>
              <p>빈 시간을 누르거나 할 일을 끌어 놓으세요.</p>
            </div>
            <button type="button" onClick={() => openTimeBlock(findAvailableStart(focusTask))}>
              <CalendarPlus size={16} /> 일정 추가
            </button>
          </header>

          <div className="today-schedule-scroll" ref={scheduleScrollRef}>
            <div
              className="day-schedule day-schedule--focus"
              style={{ '--day-schedule-height': `${((DAY_END_MINUTES - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT}px` } as CSSProperties}
            >
              <div className="day-schedule__hours" aria-hidden="true">
                {dayHours.map((hour) => (
                  <div
                    key={hour}
                    className="day-schedule__hour"
                    style={{ '--hour-top': `${((hour - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT}px` } as CSSProperties}
                  >
                    <time>{formatClock(hour)}</time>
                    <span />
                  </div>
                ))}
              </div>

              <div className="day-schedule__slots">
                {daySlots.map((startMinutes) => {
                  const occupied = Boolean(findTimeBlockConflict(todayCollisionBlocks, {
                    day: today.key,
                    startMinutes,
                    durationMinutes: DAY_SLOT_MINUTES,
                    weekOffset: 0
                  }));
                  const isDropTarget = draggingTaskId && dropTargetMinutes === startMinutes;
                  return (
                    <button
                      key={startMinutes}
                      type="button"
                      className={isDropTarget ? 'day-schedule__slot is-drop-target' : 'day-schedule__slot'}
                      disabled={occupied}
                      style={{
                        '--slot-top': `${((startMinutes - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT}px`,
                        '--slot-height': `${(DAY_SLOT_MINUTES / 60) * DAY_HOUR_HEIGHT}px`
                      } as CSSProperties}
                      aria-label={occupied
                        ? `${formatClock(startMinutes)} 이미 일정 있음`
                        : `${formatClock(startMinutes)}부터 ${formatClock(startMinutes + DAY_SLOT_MINUTES)}까지 할 일 또는 일정 추가`}
                      onClick={() => openTimeBlock(startMinutes)}
                      onDragOver={(event) => {
                        if (occupied || !draggingTaskId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDragEnter={() => {
                        if (!occupied && draggingTaskId) setDropTargetMinutes(startMinutes);
                      }}
                      onDrop={(event) => dropTaskAt(event, startMinutes)}
                    >
                      <Plus size={14} aria-hidden="true" />
                      <span>{isDropTarget ? `${formatClock(startMinutes)}에 배치` : '이 시간에 할 일 추가'}</span>
                    </button>
                  );
                })}
              </div>

              <div className="day-schedule__blocks">
                {todayBlocks.map((block) => {
                  const visibleStart = Math.max(DAY_START_MINUTES, block.startMinutes);
                  const visibleEnd = Math.min(DAY_END_MINUTES, block.startMinutes + block.durationMinutes);
                  if (visibleEnd <= visibleStart) return null;
                  const blockStyle = {
                    '--schedule-block-top': `${((visibleStart - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT + 2}px`,
                    '--schedule-block-height': `${Math.max(30, ((visibleEnd - visibleStart) / 60) * DAY_HOUR_HEIGHT - 4)}px`
                  } as CSSProperties;
                  const endMinutes = block.startMinutes + block.durationMinutes;
                  const content = (
                    <>
                      <strong>{block.title}</strong>
                      <span>{formatClock(block.startMinutes)}–{formatClock(endMinutes)}</span>
                    </>
                  );

                  return block.external ? (
                    <article key={block.id} className="day-schedule__block day-schedule__block--external" style={blockStyle}>
                      {content}
                    </article>
                  ) : (
                    <button
                      key={block.id}
                      type="button"
                      className={block.taskId
                        ? 'day-schedule__block day-schedule__block--focus'
                        : 'day-schedule__block day-schedule__block--event'}
                      style={blockStyle}
                      aria-label={`${block.title}, ${formatClock(block.startMinutes)}부터 ${formatClock(endMinutes)}까지, 일정 수정 또는 삭제`}
                      onClick={() => openTimeBlock(block.startMinutes, block.id)}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>

              {currentMinute >= DAY_START_MINUTES && currentMinute <= DAY_END_MINUTES && (
                <div
                  className="day-schedule__now"
                  aria-label={`현재 시각 ${formatClock(currentMinute)}`}
                  style={{ '--now-top': `${currentTimeTop}px` } as CSSProperties}
                >
                  <time dateTime={formatClock(currentMinute)}>{formatClock(currentMinute)}</time>
                  <span />
                </div>
              )}
            </div>
          </div>
          <footer className="today-schedule-footer">
            <span><i /> 예정된 일정</span>
            <span><i /> 빈 시간 — 클릭해서 추가</span>
          </footer>
        </section>

        <aside className="today-memo-pane" aria-label="오늘 메모">
          <header>
            <div><StickyNote size={16} /><h2>메모</h2></div>
            <span>{memo.trim() ? '저장됨' : '자동 저장'}</span>
          </header>
          <textarea
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="메모를 입력하세요"
            aria-label="오늘 메모 입력"
          />
          <footer>오늘 실행 중 참고할 내용을 자유롭게 적어두세요.</footer>
        </aside>
      </div>

      {timeBlockDraft && (
        <TimeBlockSheet
          key={`${timeBlockDraft.blockId ?? 'new'}-${timeBlockDraft.taskId}-${timeBlockDraft.startMinutes}`}
          tasks={activeTasks}
          outcomes={outcomes}
          initialBlockId={timeBlockDraft.blockId}
          initialTaskId={timeBlockDraft.taskId}
          initialTitle={timeBlockDraft.title}
          initialDay={today.key}
          initialStartMinutes={timeBlockDraft.startMinutes}
          initialDurationMinutes={timeBlockDraft.durationMinutes}
          initialMode={timeBlockDraft.mode}
          error={timeBlockError}
          onClose={() => {
            setTimeBlockDraft(null);
            setTimeBlockError('');
          }}
          onSave={saveTimeBlockDraft}
          onDelete={timeBlockDraft.blockId ? deleteTimeBlock : undefined}
        />
      )}

      {timeBlockNotice && <div className="toast" role="status"><Check size={15} /> {timeBlockNotice}</div>}

      {finishOpen && focusTask && (
        <Modal
          title="이번 실행을 정리할까요?"
          description={`타이머 ${formatTimer(elapsed)}의 결과를 기록합니다.`}
          onClose={() => setFinishOpen(false)}
          className="finish-modal finish-panel"
        >
          <div className="finish-panel__elapsed" aria-label="종료할 실행 시간">
            <span>기록된 실행</span>
            <strong>{formatTimer(elapsed)}</strong>
          </div>
          <label className="field">
            <span className="field-label">남길 근거 또는 한 줄 메모 <small>선택</small></span>
            <textarea
              data-autofocus
              rows={3}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="예: 다이어그램 초안 링크, 확인한 실패 케이스"
            />
          </label>
          <div className="finish-options">
            <button className="finish-option" type="button" onClick={() => completeTimer('continue')}>
              <ArrowRight size={20} />
              <span><strong>다음에도 이어서</strong><small>진행 중으로 유지합니다.</small></span>
            </button>
            <button className="finish-option finish-option--done" type="button" onClick={() => completeTimer('done')}>
              <Check size={20} />
              <span><strong>이 작업은 완료</strong><small>완료 목록으로 옮깁니다.</small></span>
            </button>
          </div>
        </Modal>
      )}

      {manualNotice && (
        <div className="toast toast--action" role="status">
          <span><TimerReset size={17} /> {manualNotice.taskTitle}에 {manualNotice.minutes}분을 기록했어요.</span>
          <button
            type="button"
            onClick={() => {
              removeTimeEntry(manualNotice.entryId);
              setManualNotice(null);
            }}
          >
            실행 취소
          </button>
        </div>
      )}
    </div>
  );
}
