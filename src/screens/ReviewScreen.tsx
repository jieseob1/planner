import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Target
} from 'lucide-react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import {
  addLocalDateDays,
  getWeekStartDate,
  isInstantWithinLocalDateRange,
  parseLocalDate,
  toLocalDate
} from '../lib/calendarDate';
import { formatMinutes } from '../lib/format';
import { usePlanner } from '../state/PlannerProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const blockerOptions = [
  { value: 'time', label: '시간이 부족했어요', hint: '예상보다 외부 일정이 많았음' },
  { value: 'scope', label: '일이 너무 컸어요', hint: '다음 행동으로 더 잘게 나눠야 함' },
  { value: 'unclear', label: '완료 기준이 모호했어요', hint: '근거와 종료 조건을 먼저 정해야 함' },
  { value: 'none', label: '특별한 방해가 없었어요', hint: '현재 방식을 다음 주에도 유지' }
];

const formatReviewDate = (value: string) => {
  const [, month, day] = value.split('-').map(Number);
  return `${month}월 ${day}일`;
};

export const getReviewWeekPeriod = (reference = new Date(), timeZone?: string) => {
  const safeReference = Number.isFinite(reference.getTime()) ? reference : new Date();
  const startDate = getWeekStartDate(toLocalDate(safeReference, timeZone));
  const endDate = addLocalDateDays(startDate, 7);
  const finalDate = addLocalDateDays(endDate, -1);
  const start = parseLocalDate(startDate) as Date;
  const end = parseLocalDate(endDate) as Date;
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return {
    start,
    end,
    startDate,
    endDate,
    label: `${formatReviewDate(startDate)}—${formatReviewDate(finalDate)}`
  };
};

export function ReviewScreen() {
  const {
    tasks,
    outcomes,
    timeBlocks,
    timeEntries,
    review,
    updateReview,
    updateOutcomeMetric,
    completeReview,
    setPlannerWeekOffset
  } = usePlanner();
  const { timeZone } = useTimeZone();
  const {
    startDate: weekStartDate,
    endDate: weekEndDate,
    label: reviewPeriod
  } = getReviewWeekPeriod(new Date(), timeZone);
  const weekFinalDate = addLocalDateDays(weekEndDate, -1);
  const reviewCompletedThisWeek = Boolean(
    review.completedAt
    && isInstantWithinLocalDateRange(
      review.completedAt,
      weekStartDate,
      weekFinalDate,
      timeZone
    )
  );
  const currentReview = review.completedAt && !reviewCompletedThisWeek
    ? { blocker: null, selectedTopTaskIds: [], metricDraft: '', completedAt: null }
    : review;
  const nextWeekStartDate = weekEndDate;
  const nextWeekEndDate = addLocalDateDays(nextWeekStartDate, 7);
  const reviewableOutcomes = outcomes
    .filter((outcome) => (
      outcome.current === null
      || outcome.attention === 'stale'
      || outcome.lastUpdatedDays === null
      || outcome.lastUpdatedDays >= 7
    ))
    .sort((left, right) => {
      const leftPriority = left.attention === 'stale' ? 0 : left.current === null ? 1 : 2;
      const rightPriority = right.attention === 'stale' ? 0 : right.current === null ? 1 : 2;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return (right.lastUpdatedDays ?? 0) - (left.lastUpdatedDays ?? 0);
    });
  const initialMetricOutcome = reviewableOutcomes[0] ?? outcomes[0];
  const [metricOutcomeId, setMetricOutcomeId] = useState(initialMetricOutcome?.id ?? '');
  const selectedMetricOutcome = outcomes.find((outcome) => outcome.id === metricOutcomeId) ?? initialMetricOutcome;
  const metricOptions = selectedMetricOutcome && !reviewableOutcomes.some((outcome) => outcome.id === selectedMetricOutcome.id)
    ? [selectedMetricOutcome, ...reviewableOutcomes]
    : reviewableOutcomes.length > 0 ? reviewableOutcomes : outcomes;
  const [metricValue, setMetricValue] = useState(() => {
    const draftValue = Number(currentReview.metricDraft);
    if (currentReview.metricDraft.trim() && Number.isFinite(draftValue) && draftValue >= 0) return currentReview.metricDraft;
    return initialMetricOutcome?.current === null || initialMetricOutcome?.current === undefined
      ? ''
      : String(initialMetricOutcome.current);
  });
  const [metricTouched, setMetricTouched] = useState(false);
  const [metricEvidence, setMetricEvidence] = useState('');
  const [metricEvidenceTouched, setMetricEvidenceTouched] = useState(false);
  const [metricUnchanged, setMetricUnchanged] = useState(false);
  const [appliedMetricKey, setAppliedMetricKey] = useState<string | null>(null);
  const activeTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const selectedActiveTaskIds = currentReview.selectedTopTaskIds.filter((taskId) => activeTaskIds.has(taskId));
  const carryoverTasks = activeTasks.filter((task) => task.carryCount > 0);
  const weeklyEntries = timeEntries.filter((entry) => isInstantWithinLocalDateRange(
    entry.observedAt,
    weekStartDate,
    weekFinalDate,
    timeZone
  ));
  const totalSeconds = weeklyEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const weeklyTaskIds = new Set(weeklyEntries.map((entry) => entry.taskId));
  const completedTasks = tasks.filter((task) => task.status === 'done' && weeklyTaskIds.has(task.id)).length;
  const nextWeekTaskIds = new Set(
    timeBlocks
      .filter((block) => !block.external && block.taskId && (
        block.date
          ? block.date >= nextWeekStartDate && block.date < nextWeekEndDate
          : (block.weekOffset ?? 0) === 1
      ))
      .map((block) => block.taskId)
  );
  const unresolvedCarryovers = carryoverTasks.filter((task) => !nextWeekTaskIds.has(task.id));
  const decisionCount = outcomes.filter((outcome) => outcome.decision).length;
  const parsedMetric = metricValue.trim() === '' ? null : Number(metricValue);
  const validMetric = parsedMetric !== null && Number.isFinite(parsedMetric) && parsedMetric >= 0;
  const metricError = metricTouched && !metricUnchanged && !validMetric;
  const validMetricEvidence = metricEvidence.trim().length > 0;
  const metricEvidenceError = metricEvidenceTouched && !validMetricEvidence;
  const hasMetric = !selectedMetricOutcome || metricUnchanged || (validMetric && validMetricEvidence);
  const hasBlocker = Boolean(currentReview.blocker);
  const hasTopTasks = activeTasks.length === 0 || selectedActiveTaskIds.length > 0;
  const ready = hasMetric && hasBlocker && hasTopTasks;
  const currentMetricKey = selectedMetricOutcome && validMetric && validMetricEvidence
    ? `${selectedMetricOutcome.id}:${parsedMetric}:${metricEvidence.trim()}`
    : null;
  const metricApplied = currentMetricKey !== null && appliedMetricKey === currentMetricKey;

  useEffect(() => {
    if (!review.completedAt || reviewCompletedThisWeek) return;
    updateReview({ blocker: null, selectedTopTaskIds: [], metricDraft: '', completedAt: null });
  }, [review.completedAt, reviewCompletedThisWeek, updateReview]);

  const selectedMinutes = useMemo(
    () => tasks
      .filter((task) => task.status !== 'done' && task.status !== 'cancelled' && currentReview.selectedTopTaskIds.includes(task.id))
      .reduce((sum, task) => sum + task.estimateMinutes, 0),
    [currentReview.selectedTopTaskIds, tasks]
  );

  const toggleTopTask = (taskId: string) => {
    const selected = selectedActiveTaskIds.includes(taskId);
    if (!selected && selectedActiveTaskIds.length >= 3) return;
    updateReview({
      selectedTopTaskIds: selected
        ? selectedActiveTaskIds.filter((id) => id !== taskId)
        : [...selectedActiveTaskIds, taskId]
    });
  };

  const selectMetricOutcome = (outcomeId: string) => {
    const outcome = outcomes.find((item) => item.id === outcomeId);
    setMetricOutcomeId(outcomeId);
    setMetricValue(outcome?.current === null || outcome?.current === undefined ? '' : String(outcome.current));
    setMetricTouched(false);
    setMetricEvidence('');
    setMetricEvidenceTouched(false);
    setMetricUnchanged(false);
    setAppliedMetricKey(null);
  };

  const applyMetric = () => {
    setMetricTouched(true);
    setMetricEvidenceTouched(true);
    if (!selectedMetricOutcome || !validMetric || parsedMetric === null || !validMetricEvidence) return;
    if (!updateOutcomeMetric(selectedMetricOutcome.id, parsedMetric, metricEvidence.trim())) return;
    updateReview({ metricDraft: metricValue.trim() });
    setMetricUnchanged(false);
    setAppliedMetricKey(`${selectedMetricOutcome.id}:${parsedMetric}:${metricEvidence.trim()}`);
  };

  const markMetricUnchanged = () => {
    if (!selectedMetricOutcome || selectedMetricOutcome.current === null) return;
    if (!updateOutcomeMetric(selectedMetricOutcome.id, selectedMetricOutcome.current, '주간 점검에서 변화 없음 확인')) return;
    updateReview({ metricDraft: '변화 없음' });
    setMetricValue(String(selectedMetricOutcome.current));
    setMetricTouched(false);
    setMetricEvidence('');
    setMetricEvidenceTouched(false);
    setMetricUnchanged(true);
    setAppliedMetricKey(`${selectedMetricOutcome.id}:${selectedMetricOutcome.current}`);
  };

  const finishReview = () => {
    setMetricTouched(true);
    if (!metricUnchanged) setMetricEvidenceTouched(true);
    if (!ready) return;
    if (selectedMetricOutcome && !metricUnchanged && !metricApplied && validMetric && parsedMetric !== null) {
      if (!updateOutcomeMetric(selectedMetricOutcome.id, parsedMetric, metricEvidence.trim())) return;
      updateReview({ metricDraft: metricValue.trim() });
    }
    setPlannerWeekOffset(1);
    completeReview();
  };

  if (reviewCompletedThisWeek) {
    return (
      <div className="page page--review review-complete-page">
        <section className="review-complete card">
          <span className="review-complete__icon"><CheckCircle2 size={34} /></span>
          <p className="eyebrow">WEEK CLOSED · {reviewPeriod}</p>
          <h1>다음 주의 기준이 정해졌습니다.</h1>
          <p>선택한 결과 수치와 방해 요인, Top 3를 현재 계획에 반영했습니다.</p>
          <div className="review-complete__summary">
            <div><strong>{selectedActiveTaskIds.length}</strong><span>우선 실행</span></div>
            <div><strong>{formatMinutes(selectedMinutes)}</strong><span>계획 시간</span></div>
            <div><strong>{decisionCount}</strong><span>목표 결정</span></div>
          </div>
          <div className="review-complete__actions">
            <Link className="button button--primary" to="/planner" onClick={() => setPlannerWeekOffset(1)}>
              다음 주 시간 배치 <ArrowRight size={17} />
            </Link>
            <button className="button button--secondary" type="button" onClick={() => updateReview({ completedAt: null })}>
              <RotateCcw size={16} /> 다시 점검
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--review">
      <header className="page-header review-header">
        <div>
          <p className="eyebrow">WEEKLY REVIEW · {reviewPeriod}</p>
          <h1>한 주를 닫고, 다음 주를 고릅니다.</h1>
          <p className="page-header__description">달라진 수치와 가장 큰 방해만 확인한 뒤, 다음 주 Top 3를 시간에 연결하세요.</p>
        </div>
        <div className="review-header__status"><span>자동 저장 · 5단계 · 약 5분</span></div>
      </header>

      <section className="review-overview" aria-label="이번 주 요약과 점검 진행 상황">
        <div className="review-stats" aria-label="이번 주 요약">
          <div><Clock3 size={17} /><span><strong>{(totalSeconds / 3600).toFixed(1)}h</strong><small>실제 실행</small></span></div>
          <div><Check size={17} /><span><strong>{completedTasks}</strong><small>이번 주 실행 후 완료</small></span></div>
          <div><Target size={17} /><span><strong>{decisionCount}</strong><small>현재 목표 결정</small></span></div>
        </div>
        <div className="review-progress" aria-label="주간 점검 진행 상황">
          <span className={clsx('is-active', hasMetric && 'is-done')}>{hasMetric ? <Check size={13} /> : 1}</span>
          <i />
          <span className={clsx(hasMetric && 'is-active', hasBlocker && 'is-done')}>{hasBlocker ? <Check size={13} /> : 2}</span>
          <i />
          <span className={clsx(hasBlocker && 'is-active')}>3</span>
          <i />
          <span className={clsx(hasBlocker && 'is-active', hasTopTasks && 'is-done')}>{hasTopTasks ? <Check size={13} /> : 4}</span>
          <i />
          <span className={ready ? 'is-active' : ''}>5</span>
        </div>
      </section>

      <div className="review-flow review-flow--continuous">
        <section className={clsx('review-step', 'review-stage', hasMetric && 'is-complete')}>
          <header className="review-step__header">
            <span className="review-step__number">01</span>
            <div><p className="eyebrow">METRIC UPDATE</p><h2>누락되거나 오래된 결과 수치를 확인합니다.</h2></div>
            <span className="review-step__time">약 1분</span>
          </header>
          <div className="review-step__body">
            {selectedMetricOutcome ? (
              <div className="metric-update">
                <div className="metric-update__context">
                  <label className="metric-outcome-select field">
                    <span className="field-label">갱신할 결과</span>
                    <select value={selectedMetricOutcome.id} onChange={(event) => selectMetricOutcome(event.target.value)}>
                      {metricOptions.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                    </select>
                  </label>
                  <span className="attention-badge attention-badge--stale">
                    <AlertTriangle size={13} />
                    {selectedMetricOutcome.current === null ? '측정값 없음' : `${selectedMetricOutcome.lastUpdatedDays ?? 0}일 전 갱신`}
                  </span>
                  <strong>{selectedMetricOutcome.title}</strong>
                  <small>{selectedMetricOutcome.evidenceLabel}</small>
                </div>
                <label className="metric-input">
                  <span>현재 확인된 값</span>
                  <div>
                    <input
                      value={metricValue}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      aria-invalid={metricError}
                      aria-describedby={metricError ? 'metric-value-error' : 'metric-value-help'}
                      onBlur={() => setMetricTouched(true)}
                      onChange={(event) => {
                        setMetricValue(event.target.value);
                        setMetricTouched(true);
                        setMetricUnchanged(false);
                        setAppliedMetricKey(null);
                      }}
                      placeholder="예: 24"
                    />
                    <span>{selectedMetricOutcome.unit}</span>
                  </div>
                  {metricError
                    ? <small id="metric-value-error" className="form-error field-error" role="alert">0 이상의 숫자를 입력하세요.</small>
                    : <small id="metric-value-help">측정값이 없으면 빈칸으로 두고 실제 값을 확인하세요.</small>}
                </label>
                <label className="metric-input metric-input--evidence">
                  <span>확인 근거</span>
                  <input
                    value={metricEvidence}
                    maxLength={500}
                    aria-invalid={metricEvidenceError}
                    aria-describedby={metricEvidenceError ? 'metric-evidence-error' : 'metric-evidence-help'}
                    onBlur={() => setMetricEvidenceTouched(true)}
                    onChange={(event) => {
                      setMetricEvidence(event.target.value);
                      setMetricEvidenceTouched(true);
                      setMetricUnchanged(false);
                      setAppliedMetricKey(null);
                    }}
                    placeholder="예: 결제 대시보드 9월 2일 확인"
                  />
                  {metricEvidenceError
                    ? <small id="metric-evidence-error" className="form-error field-error" role="alert">확인한 자료나 관찰 근거를 입력하세요.</small>
                    : <small id="metric-evidence-help">이번 값이 어디서 확인됐는지 남깁니다.</small>}
                </label>
                <button className="button button--secondary" type="button" disabled={!validMetric || !validMetricEvidence} onClick={applyMetric}>
                  {metricApplied ? <Check size={16} /> : <BarChart3 size={16} />} {metricApplied ? '반영됨' : '반영'}
                </button>
              </div>
            ) : <p className="empty-state" role="status">갱신할 결과가 없습니다.</p>}
            <button
              className="review-skip"
              type="button"
              disabled={!selectedMetricOutcome || selectedMetricOutcome.current === null}
              onClick={markMetricUnchanged}
            >
              변화 없음으로 기록 <ChevronRight size={15} />
            </button>
          </div>
        </section>

        <section className={clsx('review-step', 'review-stage', hasBlocker && 'is-complete')}>
          <header className="review-step__header">
            <span className="review-step__number">02</span>
            <div><p className="eyebrow">BLOCKER</p><h2>가장 크게 막은 것 하나를 고릅니다.</h2></div>
            <span className="review-step__time">약 1분</span>
          </header>
          <div className="review-step__body">
            <div className="blocker-options" role="radiogroup" aria-label="가장 큰 방해 요인">
              {blockerOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={currentReview.blocker === option.value ? 'is-selected' : ''}
                  role="radio"
                  aria-checked={currentReview.blocker === option.value}
                  onClick={() => updateReview({ blocker: option.value })}
                >
                  {currentReview.blocker === option.value ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={clsx('review-step', 'review-stage', 'review-step--carryover', unresolvedCarryovers.length === 0 && 'is-complete')}>
          <header className="review-step__header">
            <span className="review-step__number">03</span>
            <div><p className="eyebrow">CARRYOVER DECISION</p><h2>끝내지 못한 일을 다음 계획의 근거로 바꿉니다.</h2></div>
            <span className="review-step__time">약 1분</span>
          </header>
          <div className="review-step__body">
            {carryoverTasks.length > 0 ? (
              <div className="review-carryover-list">
                {carryoverTasks.map((task) => {
                  const outcome = outcomes.find((item) => item.id === task.outcomeId);
                  return (
                    <article key={task.id}>
                      <div><small>{outcome?.title ?? '연결되지 않은 할 일'} · {task.carryCount}회 이월</small><strong>{task.title}</strong></div>
                      <div>
                        <Link
                          to={`/planner?action=reschedule&task=${encodeURIComponent(task.id)}`}
                          onClick={() => setPlannerWeekOffset(1)}
                        >
                          {nextWeekTaskIds.has(task.id) ? '다음 주 배치됨' : '다음 주로'}
                        </Link>
                        <Link to={`/planner?action=split&task=${encodeURIComponent(task.id)}`}>나누기</Link>
                        <Link to={`/goals?action=stop&task=${encodeURIComponent(task.id)}`}>중단</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <p className="review-carryover-empty"><Check size={16} /> 결정이 필요한 이월 작업이 없습니다.</p>}
            {unresolvedCarryovers.length > 0 ? (
              <p className="inline-alert" role="status">
                이월 작업 {unresolvedCarryovers.length}개가 아직 다음 주에 배치되지 않았습니다. 그대로 완료하면 미결정 상태로 남습니다.
              </p>
            ) : null}
          </div>
        </section>

        <section className={clsx('review-step', 'review-stage', 'review-step--tasks', hasTopTasks && 'is-complete')}>
          <header className="review-step__header">
            <span className="review-step__number">04</span>
            <div><p className="eyebrow">NEXT WEEK TOP 3</p><h2>먼저 시간을 줄 실행을 최대 3개 고릅니다.</h2></div>
            <span className="review-step__time">약 2분</span>
          </header>
          <div className="review-step__body">
            <div className="top-task-list">
              {activeTasks.map((task) => {
                const selected = currentReview.selectedTopTaskIds.includes(task.id);
                const outcome = outcomes.find((item) => item.id === task.outcomeId);
                const disabled = !selected && selectedActiveTaskIds.length >= 3;
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={clsx('top-task', selected && 'is-selected')}
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => toggleTopTask(task.id)}
                  >
                    <span className="top-task__check">{selected ? <Check size={15} /> : null}</span>
                    <span><small>{outcome?.title ?? '수집함'}</small><strong>{task.title}</strong></span>
                    <em>{formatMinutes(task.estimateMinutes)}</em>
                  </button>
                );
              })}
              {activeTasks.length === 0 ? (
                <p className="review-carryover-empty"><Check size={16} /> 진행 중인 일이 없습니다. Top 3 없이 회고를 마칠 수 있습니다.</p>
              ) : null}
            </div>
            <div className="selection-summary"><ListChecks size={17} /><span><strong>{selectedActiveTaskIds.length}/3 선택</strong> · 예상 {formatMinutes(selectedMinutes)}</span></div>
          </div>
        </section>

        <section className={clsx('review-step', 'review-stage', 'review-stage--confirm', ready && 'is-complete')}>
          <header className="review-step__header">
            <span className="review-step__number">05</span>
            <div><p className="eyebrow">CONFIRM PLAN</p><h2>선택을 현재 계획에 반영하고 다음 주로 넘깁니다.</h2></div>
            <span className="review-step__time">마지막</span>
          </header>
          <div className="review-step__body">
            <div className={clsx('review-submit', 'review-confirmation', ready && 'review-submit--ready')}>
              <div>
                <ShieldCheck size={22} />
                <span>
                  <strong>{ready ? '필수 선택이 모두 준비됐습니다.' : '앞의 네 단계를 먼저 완료하세요.'}</strong>
                  <small>
                    {ready
                      ? `Top ${selectedActiveTaskIds.length} · ${formatMinutes(selectedMinutes)} · ${unresolvedCarryovers.length > 0 ? `미결정 이월 ${unresolvedCarryovers.length}개 유지` : '이월 결정 완료'}`
                      : `결과 수치 · 방해 요인 · ${activeTasks.length === 0 ? '완료 주 확인' : 'Top 3'}`}
                  </small>
                </span>
              </div>
              <button className="button button--primary" type="button" disabled={!ready} onClick={finishReview}>
                주간 점검 완료{unresolvedCarryovers.length > 0 ? ` · 이월 ${unresolvedCarryovers.length}개 남김` : ''} <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
