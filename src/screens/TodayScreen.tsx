import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
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
import { formatClock, formatMinutes, formatTimer } from '../lib/format';
import { usePlanner } from '../state/PlannerProvider';
import { getToday, getWeekDays } from '../lib/calendarDate';

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

export function TodayScreen() {
  const {
    tasks,
    outcomes,
    timeBlocks,
    timeEntries,
    timer,
    quickCapture,
    startTimer,
    toggleTimer,
    stopTimer,
    addManualTime,
    removeTimeEntry
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
  const today = getToday();
  const currentWeekDays = getWeekDays(0);

  const activeTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const focusTask = timer
    ? tasks.find((task) => task.id === timer.taskId)
    : activeTasks.find((task) => task.pinned) ?? activeTasks[0];
  const focusOutcome = outcomes.find((outcome) => outcome.id === focusTask?.outcomeId);
  const topTasks = focusTask
    ? [focusTask, ...activeTasks.filter((task) => task.id !== focusTask.id).slice(0, 2)]
    : [];
  const carryoverTask = activeTasks.find((task) => task.carryCount > 0);
  const todayBlocks = useMemo(
    () => timeBlocks
      .filter((block) => block.day === today.key && (block.weekOffset ?? 0) === 0)
      .sort((a, b) => a.startMinutes - b.startMinutes),
    [timeBlocks, today.key]
  );
  const remainingWeek = useMemo(
    () => currentWeekDays.slice(today.index + 1, 5).map((day) => {
      const blocks = timeBlocks.filter((block) => (
        block.day === day.key && !block.external && (block.weekOffset ?? 0) === 0
      ));
      return {
        ...day,
        blockCount: blocks.length,
        plannedMinutes: blocks.reduce((sum, block) => sum + block.durationMinutes, 0)
      };
    }),
    [currentWeekDays, timeBlocks, today.index]
  );
  const nextBlock = todayBlocks.find((block) => block.taskId === focusTask?.id)
    ?? todayBlocks.find((block) => !block.external)
    ?? todayBlocks[0];
  const elapsed = useTimerSeconds(timer?.startedAt ?? null, timer?.accumulatedSeconds ?? 0, timer?.paused ?? true);
  const loggedToday = timeEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const plannedTodayMinutes = todayBlocks
    .filter((block) => !block.external)
    .reduce((sum, block) => sum + block.durationMinutes, 0);
  const executionPercentage = plannedTodayMinutes > 0
    ? Math.min(100, Math.round((loggedToday / (plannedTodayMinutes * 60)) * 100))
    : loggedToday > 0 ? 100 : 0;

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

  return (
    <div className="page page--today today-nowline">
      <header className="page-header page-header--compact today-header">
        <div className="today-header__title">
          <p className="eyebrow">오늘 · {today.month}월 {today.date}일 {today.long}</p>
          <h1>오늘은 하나를 끝냅니다.</h1>
          <p className="page-header__description">계획보다 실행을 먼저 봅니다. 다음 한 줄을 끝내세요.</p>
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
              <span><small>실행률</small>{executionPercentage}%</span>
            </div>
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

      <section className="today-priorities" aria-labelledby="today-top-three-title">
        <header className="section-heading section-heading--rule">
          <div>
            <p className="eyebrow">오늘의 Top 3</p>
            <h2 id="today-top-three-title">끝낼 순서</h2>
          </div>
          <span className="section-heading__hint">한 번에 하나만 기록합니다.</span>
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

      <div className="today-plan-overview">
        <section className="next-block" aria-labelledby="next-block-title">
          <header>
            <div>
              <p className="eyebrow">다음 블록</p>
              <h2 id="next-block-title">바로 이어갈 시간</h2>
            </div>
            <CalendarClock size={18} aria-hidden="true" />
          </header>
          {nextBlock ? (
            <div className={nextBlock.external ? 'next-block__body next-block__body--external' : 'next-block__body'}>
              <time>{formatClock(nextBlock.startMinutes)}</time>
              <div>
                <span>{nextBlock.external ? '외부 일정 · 읽기 전용' : '집중 블록'}</span>
                <strong>{nextBlock.title}</strong>
              </div>
              <span>{formatMinutes(nextBlock.durationMinutes)}</span>
            </div>
          ) : (
            <p className="next-block__empty">오늘 배치된 시간이 없습니다.</p>
          )}
        </section>

        <section className="remaining-week" aria-labelledby="remaining-week-title">
          <header>
            <p className="eyebrow">남은 주</p>
            <h2 id="remaining-week-title">집중 시간 배치</h2>
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
      </div>

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

      <section className="today-timeline" aria-labelledby="today-timeline-title">
        <header className="section-heading section-heading--rule">
          <div>
            <p className="eyebrow">오늘의 타임라인</p>
            <h2 id="today-timeline-title">계획과 실제 흐름</h2>
          </div>
          <span className="section-heading__hint">줄무늬는 외부 일정 · 파란 블록은 직접 계획</span>
        </header>
        <ol className="timeline timeline--day">
          {todayBlocks.map((block) => (
            <li key={block.id} className={block.external ? 'timeline__item timeline__item--external' : 'timeline__item'}>
              <time>{formatClock(block.startMinutes)}</time>
              <span className="timeline__dot" aria-hidden="true" />
              <div className="timeline__body">
                <span className="timeline__type">{block.external ? '외부 일정 · 읽기 전용' : '집중 블록'}</span>
                <strong>{block.title}</strong>
                <span>{formatMinutes(block.durationMinutes)}</span>
              </div>
            </li>
          ))}
          {todayBlocks.length === 0 && <li className="timeline__empty">오늘 배치된 시간이 없습니다.</li>}
        </ol>
        <footer className="day-close">
          <div>
            <strong>오늘을 닫기 전에</strong>
            <span>완료, 이월, 중단을 정리하면 내일의 Top 3가 선명해집니다.</span>
          </div>
          <Link className="button button--secondary" to="/review">하루 마감 <ArrowRight size={16} /></Link>
        </footer>
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
