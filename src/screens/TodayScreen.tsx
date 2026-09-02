import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Pause,
  Play,
  Plus,
  Square,
  TimerReset
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { TimeBlockSheet, type TimeBlockEditorValue, type TimeBlockMode } from '../components/TimeBlockSheet';
import { formatClock, formatMinutes, formatTimer } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import type { TimeBlock, TimeEntry } from '../domain/types';
import { getMinuteOfDay, getToday, getWeekDays, isInstantOnLocalDate } from '../lib/calendarDate';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const DAY_START_MINUTES = 0;
const DAY_END_MINUTES = 24 * 60;
const DAY_SLOT_MINUTES = 60;
const DAY_HOUR_HEIGHT = 54;
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
  const [manualNotice, setManualNotice] = useState<{
    entryId: string;
    taskTitle: string;
    minutes: number;
  } | null>(null);
  const calendarNow = new Date();
  const today = getToday(calendarNow, timeZone);
  const todayDate = today.isoDate;
  const currentWeekDays = getWeekDays(0, calendarNow, timeZone);
  const [timeBlockDraft, setTimeBlockDraft] = useState<TimeBlockDraft | null>(null);
  const [timeBlockError, setTimeBlockError] = useState('');
  const [timeBlockNotice, setTimeBlockNotice] = useState('');
  const currentMinute = useCurrentMinute(timeZone);
  const currentTimeTop = Math.round(
    (((currentMinute - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT) * 10
  ) / 10;

  const activeTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const focusTask = timer
    ? tasks.find((task) => task.id === timer.taskId)
    : activeTasks.find((task) => task.pinned) ?? activeTasks[0];
  const focusOutcome = outcomes.find((outcome) => outcome.id === focusTask?.outcomeId);
  const topTasks = focusTask
    ? [focusTask, ...activeTasks.filter((task) => task.id !== focusTask.id)]
    : [];
  const carryoverTask = activeTasks.find((task) => task.carryCount > 0);
  const todayBlocks = useMemo(
    () => getBlocksForDate(timeBlocks, todayDate),
    [timeBlocks, todayDate]
  );
  const todayCollisionBlocks = useMemo(
    () => todayBlocks.map((block) => ({ ...block, day: today.key, weekOffset: 0 })),
    [today.key, todayBlocks]
  );
  const remainingWeek = useMemo(
    () => currentWeekDays.slice(today.index + 1, 5).map((day) => {
      const blocks = timeBlocks.filter((block) => (
        block.date === day.isoDate && !block.external
      ));
      return {
        ...day,
        blockCount: blocks.length,
        plannedMinutes: blocks.reduce((sum, block) => sum + block.durationMinutes, 0)
      };
    }),
    [currentWeekDays, timeBlocks, today.index]
  );
  const nextBlock = getNextScheduledBlock(todayBlocks, currentMinute);
  const elapsed = useTimerSeconds(timer?.startedAt ?? null, timer?.accumulatedSeconds ?? 0, timer?.paused ?? true);
  const loggedToday = getLoggedSecondsForDate(timeEntries, todayDate, timeZone);
  const plannedTodayMinutes = todayBlocks
    .filter((block) => !block.external)
    .reduce((sum, block) => sum + block.durationMinutes, 0);
  const executionPercentage = plannedTodayMinutes > 0
    ? Math.min(100, Math.round((loggedToday / (plannedTodayMinutes * 60)) * 100))
    : null;

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

  const openTimeBlock = (startMinutes: number, blockId?: string) => {
    const block = blockId ? todayBlocks.find((item) => item.id === blockId) : undefined;
    const task = activeTasks.find((item) => item.id === block?.taskId)
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

  return (
    <div className="page page--today today-nowline">
      <header className="page-header page-header--compact today-header">
        <div className="today-header__title">
          <p className="eyebrow">오늘 · {today.month}월 {today.date}일 {today.long}</p>
          <h1>오늘 할 일과 일정을 정리합니다.</h1>
          <p className="page-header__description">목표와 상관없이 할 일을 적고, 원하는 시간에 일정처럼 배치하세요.</p>
        </div>

        {timer && focusTask ? (
          <section className="running-summary" aria-label="지금 할 일">
            <div className="running-summary__context">
              <span className="running-summary__status"><CircleDot size={13} /> 지금 실행 중</span>
              <span>{focusOutcome?.title ?? '수집함'}</span>
              <strong>{focusTask.title}</strong>
            </div>
            <span className="running-summary__timer" aria-label={`경과 시간 ${formatTimer(elapsed)}`}>
              {formatTimer(elapsed)}
            </span>
            <div className="running-summary__actions">
              <button className="button button--secondary" type="button" onClick={toggleTimer}>
                {timer.paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
                {timer.paused ? '계속' : '잠시 멈춤'}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => recordManualTime(focusTask.id, focusTask.title)}
              >
                <TimerReset size={16} /> {manualMinutes}분 추가
              </button>
              <button className="button button--primary" type="button" onClick={() => setFinishOpen(true)}>
                <Square size={15} fill="currentColor" /> 종료
              </button>
            </div>
          </section>
        ) : (
          <section className="today-execution" aria-label="오늘 실행 현황">
            <div className="today-execution__metrics">
              <span><small>계획</small>{formatMinutes(plannedTodayMinutes)}</span>
              <span><small>실제</small>기록 {formatTimer(loggedToday)}</span>
              <span><small>실행률</small>{executionPercentage === null ? '계획 없음' : `${executionPercentage}%`}</span>
            </div>
            {executionPercentage === null ? (
              <div className="today-execution__track" role="status" aria-label={`오늘 계획 없음, 기록 ${formatTimer(loggedToday)}`}>
                <i style={{ width: '0%' }} />
              </div>
            ) : (
              <div
                className="today-execution__track"
                role="progressbar"
                aria-label={`오늘 실행률 ${executionPercentage}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={executionPercentage}
              >
                <i style={{ width: `${executionPercentage}%` }} />
              </div>
            )}
          </section>
        )}
      </header>

      {carryoverTask && (
        <aside className="carryover-strip" aria-label="이월 작업 경고">
          <AlertTriangle size={17} aria-hidden="true" />
          <div className="carryover-strip__copy">
            <strong>{carryoverTask.carryCount}회 이월 · {carryoverTask.title}</strong>
            <span>그대로 미루기보다 범위를 줄이거나 날짜를 바꾸거나 중단을 결정하세요.</span>
          </div>
          <div className="carryover-strip__actions">
            <Link className="button button--warning button--small" to={`/planner?action=split&task=${encodeURIComponent(carryoverTask.id)}`}>나누기</Link>
            <Link className="button button--warning button--small" to={`/planner?action=reschedule&task=${encodeURIComponent(carryoverTask.id)}`}>날짜 변경</Link>
            <Link className="button button--warning button--small" to={`/goals?action=stop&task=${encodeURIComponent(carryoverTask.id)}`}>중단</Link>
          </div>
        </aside>
      )}

        <div className="today-workspace">
          <div className="today-command-column">
          <section className="next-block" aria-labelledby="next-block-title">
            <header>
              <div>
                <p className="eyebrow">다음 일정</p>
                <h2 id="next-block-title">바로 이어갈 시간</h2>
              </div>
              <a className="button button--secondary button--small" href="#today-timeline">
                <CalendarClock size={16} aria-hidden="true" /> 시간표 보기
              </a>
            </header>
            {nextBlock ? (
              <div className={nextBlock.external ? 'next-block__body next-block__body--external' : 'next-block__body'}>
                <time>{formatClock(nextBlock.startMinutes)}</time>
                <div>
                  <span>{nextBlock.external ? '외부 일정 · 읽기 전용' : nextBlock.taskId ? '할 일' : '내 일정'}</span>
                  <strong>{nextBlock.title}</strong>
                </div>
                <span>{formatMinutes(nextBlock.durationMinutes)}</span>
              </div>
            ) : (
              <button className="next-block__empty-button" type="button" onClick={() => openTimeBlock(18 * 60)}>
                <CalendarPlus size={17} /> 오늘 첫 시간을 잡아보세요.
              </button>
            )}
          </section>

          <section className="today-priorities" aria-labelledby="today-top-three-title">
            <header className="section-heading section-heading--rule">
              <div>
                <p className="eyebrow">오늘 할 일 · {activeTasks.length}개</p>
                <h2 id="today-top-three-title">내가 고르는 실행 순서</h2>
              </div>
              <span className="section-heading__hint">지금 필요한 일부터 자유롭게 시작하세요.</span>
            </header>

            {topTasks.length > 0 ? (
              <ol className="priority-list">
                {topTasks.map((task, index) => {
                  const outcome = outcomes.find((item) => item.id === task.outcomeId);
                  const isRunning = timer?.taskId === task.id;
                  return (
                    <li key={task.id} className={isRunning ? 'priority-row priority-row--running' : 'priority-row'}>
                      <span className="priority-row__rank">{index + 1}</span>
                      <div className="priority-row__body">
                        <span>{outcome?.title ?? '연결되지 않은 할 일'}</span>
                        <strong>{task.title}</strong>
                      </div>
                      <span className="priority-row__estimate"><Clock3 size={14} /> {formatMinutes(task.estimateMinutes)}</span>
                      {task.carryCount > 0 && (
                        <span className="priority-row__carry"><AlertTriangle size={13} /> {task.carryCount}회 이월</span>
                      )}
                      <button
                        className="button button--quiet button--small priority-row__action"
                        type="button"
                        disabled={Boolean(timer && !isRunning)}
                        onClick={() => isRunning ? toggleTimer() : startTimer(task.id)}
                      >
                        {isRunning && !timer?.paused ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                        {isRunning
                          ? timer?.paused ? '계속' : '잠시 멈춤'
                          : timer ? '실행 중' : index === 0 ? '지금 시작' : '시작'}
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="empty-state today-priorities__empty">
                <span className="empty-state__icon"><Check size={25} /></span>
                <h2>오늘의 실행을 모두 마쳤어요.</h2>
                <p>빠른 메모에 다음 행동을 적거나 Planner에서 내일 시간을 잡아보세요.</p>
              </div>
            )}
          </section>

          <section className="quick-capture quick-capture--row">
            <div className="quick-capture__label">
              <Plus size={18} />
              <span><strong id="quick-capture-title">빠른 메모</strong><small>떠오른 일은 수집함에 두고 지금 흐름을 지키세요.</small></span>
            </div>
            <form onSubmit={onCapture}>
              <label className="sr-only" htmlFor="quick-capture">빠른 메모</label>
              <input
                id="quick-capture"
                value={capture}
                onChange={(event) => setCapture(event.target.value)}
                onKeyDown={onCaptureKeyDown}
                placeholder="예: API 응답 비교하기"
              />
              <button type="submit" aria-label="수집함에 추가" disabled={!capture.trim()}><ArrowRight size={19} /></button>
            </form>
            {captured && <span className="capture-confirm" role="status"><Check size={14} /> 수집함에 넣었어요.</span>}
          </section>
        </div>

        <section id="today-timeline" className="today-timeline today-timeline--interactive" aria-labelledby="today-timeline-title">
          <header className="section-heading section-heading--rule">
            <div>
              <p className="eyebrow">오늘의 시간표</p>
              <h2 id="today-timeline-title">계획과 실제 흐름</h2>
            </div>
            <button className="button button--primary button--small" type="button" onClick={() => openTimeBlock(18 * 60)}>
              <CalendarPlus size={15} /> 시간 블록 추가
            </button>
          </header>

          <div className="day-schedule__guide">
            <span>빈 시간을 누르면 추가하고, 내 일정을 누르면 수정·삭제할 수 있어요.</span>
            <span className="day-schedule__legend"><i /> 내 계획 <i /> 외부 일정</span>
          </div>

          <div
            className="day-schedule"
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
                return (
                  <button
                    key={startMinutes}
                    type="button"
                    className="day-schedule__slot"
                    disabled={occupied}
                    style={{
                      '--slot-top': `${((startMinutes - DAY_START_MINUTES) / 60) * DAY_HOUR_HEIGHT}px`,
                      '--slot-height': `${(DAY_SLOT_MINUTES / 60) * DAY_HOUR_HEIGHT}px`
                    } as CSSProperties}
                    aria-label={occupied
                      ? `${formatClock(startMinutes)} 이미 일정 있음`
                      : `${formatClock(startMinutes)}부터 ${formatClock(startMinutes + DAY_SLOT_MINUTES)}까지 할 일 또는 일정 추가`}
                    onClick={() => openTimeBlock(startMinutes)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>이 시간에 할 일</span>
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
                    <span>{block.external ? '외부 일정 · 읽기 전용' : block.taskId ? '할 일' : '내 일정'} · {formatClock(block.startMinutes)}–{formatClock(endMinutes)}</span>
                    <strong>{block.title}</strong>
                    <small>{formatMinutes(block.durationMinutes)}</small>
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
                style={{
                  '--now-top': `${currentTimeTop}px`
                } as CSSProperties}
              >
                <time dateTime={formatClock(currentMinute)}>{formatClock(currentMinute)}</time>
                <span />
              </div>
            )}
          </div>

          <footer className="day-close">
            <div>
              <strong>오늘을 닫기 전에</strong>
              <span>완료, 이월, 중단을 정리하면 내일의 Top 3가 선명해집니다.</span>
            </div>
            <Link className="button button--secondary" to="/review">하루 마감 <ArrowRight size={16} /></Link>
          </footer>
        </section>
      </div>

      <section className="remaining-week remaining-week--strip" aria-labelledby="remaining-week-title">
        <header>
          <div>
            <p className="eyebrow">남은 주</p>
            <h2 id="remaining-week-title">집중 시간 배치</h2>
          </div>
          <Link className="text-button" to="/planner">주간 계획 열기 <ArrowRight size={14} /></Link>
        </header>
        <div className="remaining-week__table-wrap">
          <table>
            <thead>
              <tr>
                {remainingWeek.map((day) => <th key={day.key} scope="col">{day.short} {day.date}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                {remainingWeek.map((day) => (
                  <td key={day.key}>
                    <strong>{formatMinutes(day.plannedMinutes)}</strong>
                    <span>{day.blockCount > 0 ? `${day.blockCount}개 블록` : '비어 있음'}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {focusTask && (
        <details className="details-panel">
          <summary><ChevronDown size={17} /> 세부 기록과 수동 시간 입력</summary>
          <div className="details-panel__content">
            <p>타이머를 쓰지 못한 시간도 같은 실행 기록으로 남길 수 있습니다.</p>
            <div className="manual-time-form">
              <label>
                <span>기록할 시간</span>
                <select value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)}>
                  {[10, 15, 25, 40, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes}분</option>)}
                </select>
              </label>
              <button className="button button--secondary" type="button" onClick={() => recordManualTime(focusTask.id, focusTask.title)}>
                <TimerReset size={17} /> 시간 추가
              </button>
            </div>
          </div>
        </details>
      )}

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

      {timeBlockNotice && (
        <div className="toast" role="status"><Check size={15} /> {timeBlockNotice}</div>
      )}

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
