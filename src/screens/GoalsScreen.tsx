import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Edit3,
  Gauge,
  PauseCircle,
  Plus,
  ShieldAlert,
  Target,
  Trash2,
  TrendingUp
} from 'lucide-react';
import clsx from 'clsx';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { formatInstantInTimeZone } from '../lib/calendarDate';
import { confidenceLabels } from '../lib/format';
import { usePlanner } from '../state/PlannerProvider';
import type { LinkedTaskDisposition, Outcome, OutcomeInput } from '../domain/types';
import { useTimeZone } from '../timezone/TimeZoneProvider';

// `savePlan` remains the provider's backward-compatible combined-edit contract;
// this screen uses granular plan and outcome mutations so either can be managed independently.

type Quarter = 1 | 2 | 3 | 4;
type OutcomeEditorMode = 'add' | 'edit';
type LifecycleAction = 'stop' | 'remove';

interface PlanDraft {
  year: number;
  annualDirection: string;
  quarter: Quarter;
  quarterFocus: string;
  quarterEndDate: string;
}

interface OutcomeDraft {
  title: string;
  current: string;
  target: string;
  unit: string;
  confidence: Outcome['confidence'];
  evidenceLabel: string;
  nextCheckDate: string;
  neededHours: string;
  availableHours: string;
}

interface LifecycleRequest {
  action: LifecycleAction;
  outcomeId: string;
}

const attentionCopy: Record<Outcome['attention'], { label: string; reason: string }> = {
  none: { label: '정상', reason: '현재 계획대로 진행할 수 있습니다.' },
  stale: { label: '수치 갱신 필요', reason: '현재 수치를 확인한 지 오래됐습니다. 판단 전에 최신 값을 확인하세요.' },
  'time-shortage': { label: '시간 위험', reason: '완료에 필요한 시간보다 이번 분기에 쓸 수 있는 시간이 적습니다.' },
  stalled: { label: '변화 정체', reason: '시간을 썼지만 결과 지표가 움직이지 않았습니다.' },
  'no-evidence': { label: '근거 없음', reason: '실행이나 결과를 확인할 근거가 없습니다.' }
};

const attentionPriority: Record<Outcome['attention'], number> = {
  stale: 0,
  'time-shortage': 1,
  'no-evidence': 2,
  stalled: 3,
  none: 4
};

const decisions: Array<{ value: NonNullable<Outcome['decision']>; label: string }> = [
  { value: 'keep', label: '유지' },
  { value: 'reduce', label: '축소' },
  { value: 'extend', label: '기한 연장' },
  { value: 'stop', label: '중단' }
];

const createOutcomeDraft = (outcome?: Outcome): OutcomeDraft => ({
  title: outcome?.title ?? '',
  current: outcome?.current === null || outcome?.current === undefined ? '' : String(outcome.current),
  target: outcome ? String(outcome.target) : '',
  unit: outcome?.unit ?? '',
  confidence: outcome?.confidence ?? 'unknown',
  evidenceLabel: outcome?.evidenceLabel ?? '',
  nextCheckDate: outcome?.nextCheckDate ?? '',
  neededHours: outcome ? String(outcome.neededHours) : '',
  availableHours: outcome ? String(outcome.availableHours) : ''
});

function formatPlanDate(value: string) {
  const [, month, day] = value.split('-').map(Number);
  return month && day ? `${month}월 ${day}일` : value;
}

function nextCheckLabel(outcome: Outcome) {
  if (!outcome.nextCheckDate) return '점검일 미설정';
  return formatPlanDate(outcome.nextCheckDate);
}

function metricUpdatedLabel(outcome: Outcome) {
  if (!outcome.metricUpdatedAt) return '갱신 시각 미확인';
  if (outcome.lastUpdatedDays === 0) return '오늘 갱신';
  if (outcome.lastUpdatedDays === null) return '갱신 시각 미확인';
  return `${outcome.lastUpdatedDays}일 전 갱신`;
}

function formatMetricTimestamp(value: string, timeZone: string) {
  return formatInstantInTimeZone(value, timeZone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function OutcomeProgress({ outcome }: { outcome: Outcome }) {
  const progress = outcome.current === null || outcome.target <= 0
    ? null
    : Math.min(100, Math.max(0, (outcome.current / outcome.target) * 100));
  const roundedProgress = progress === null ? null : Math.round(progress);

  return (
    <div className={clsx('outcome-progress', progress === null && 'outcome-progress--unavailable')}>
      <div className="outcome-progress__numbers">
        <strong>
          {outcome.current === null ? '측정값 없음' : outcome.current}
          {outcome.current === null ? null : <small> / {outcome.target}{outcome.unit}</small>}
        </strong>
        <span>{roundedProgress === null ? '측정 필요' : `${roundedProgress}%`}</span>
      </div>
      <div
        className="outcome-progress__track"
        role="progressbar"
        aria-label={`${outcome.title} 진척`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedProgress ?? undefined}
        aria-valuetext={roundedProgress === null ? '측정값 없음' : `${roundedProgress}%`}
      >
        <i style={{ width: `${roundedProgress ?? 0}%` }} />
      </div>
    </div>
  );
}

export function GoalsScreen() {
  const { timeZone } = useTimeZone();
  const {
    plan,
    tasks,
    outcomes,
    setOutcomeDecision,
    updatePlan,
    addOutcome,
    updateOutcome,
    stopOutcome,
    removeOutcome
  } = usePlanner();
  const [searchParams, setSearchParams] = useSearchParams();
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => ({ ...plan }));
  const [planError, setPlanError] = useState('');
  const [outcomeEditorMode, setOutcomeEditorMode] = useState<OutcomeEditorMode | null>(null);
  const [editingOutcomeId, setEditingOutcomeId] = useState<string | null>(null);
  const [outcomeDraft, setOutcomeDraft] = useState<OutcomeDraft>(() => createOutcomeDraft());
  const [outcomeError, setOutcomeError] = useState('');
  const [lifecycleRequest, setLifecycleRequest] = useState<LifecycleRequest | null>(null);
  const [taskDisposition, setTaskDisposition] = useState<LinkedTaskDisposition | null>(null);
  const [feedback, setFeedback] = useState('');

  const attentionOutcomes = [...outcomes]
    .sort((left, right) => attentionPriority[left.attention] - attentionPriority[right.attention]);
  const decidedCount = attentionOutcomes.filter((outcome) => outcome.decision).length;
  const stopTask = searchParams.get('action') === 'stop'
    ? tasks.find((task) => task.id === searchParams.get('task'))
    : undefined;
  const queriedStopOutcome = stopTask?.outcomeId
    ? outcomes.find((outcome) => outcome.id === stopTask.outcomeId)
    : undefined;
  const lifecycleOutcome = outcomes.find((outcome) => (
    outcome.id === (lifecycleRequest?.outcomeId ?? queriedStopOutcome?.id)
  ));
  const lifecycleAction = lifecycleRequest?.action ?? (queriedStopOutcome ? 'stop' : null);
  const linkedTasks = lifecycleOutcome
    ? tasks.filter((task) => task.outcomeId === lifecycleOutcome.id)
    : [];
  const listedLinkedTasks = linkedTasks.filter((task) => task.id !== stopTask?.id);
  const editingOutcome = editingOutcomeId
    ? outcomes.find((outcome) => outcome.id === editingOutcomeId)
    : undefined;

  const selectOutcomeDraft = (outcome?: Outcome) => {
    setEditingOutcomeId(outcome?.id ?? null);
    setOutcomeDraft(createOutcomeDraft(outcome));
    setOutcomeError('');
  };

  const openPlanEditor = () => {
    selectOutcomeDraft(editingOutcome ?? outcomes[0]);
    setPlanDraft({ ...plan });
    setPlanError('');
    setPlanEditorOpen(true);
  };

  const openOutcomeEditor = (outcome?: Outcome) => {
    selectOutcomeDraft(outcome);
    setOutcomeEditorMode(outcome ? 'edit' : 'add');
  };

  const submitPlan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!planDraft.annualDirection.trim() || !planDraft.quarterFocus.trim() || !planDraft.quarterEndDate) {
      setPlanError('연간 방향, 분기 초점, 마감일을 모두 입력하세요.');
      return;
    }
    if (!Number.isFinite(planDraft.year) || planDraft.year < 1900 || planDraft.year > 9999) {
      setPlanError('연도는 1900~9999 사이로 입력하세요.');
      return;
    }
    const current = outcomeDraft.current.trim() === '' ? null : Number(outcomeDraft.current);
    const outcomeInput: OutcomeInput | null = editingOutcomeId ? {
      title: outcomeDraft.title,
      current,
      target: Number(outcomeDraft.target),
      unit: outcomeDraft.unit,
      confidence: outcomeDraft.confidence,
      evidenceLabel: outcomeDraft.evidenceLabel,
      nextCheckDate: outcomeDraft.nextCheckDate || null,
      neededHours: Number(outcomeDraft.neededHours),
      availableHours: Number(outcomeDraft.availableHours)
    } : null;
    if (
      outcomeInput
      && (
        !outcomeInput.title.trim()
        || !outcomeInput.unit.trim()
        || !outcomeInput.evidenceLabel.trim()
        || (outcomeInput.current !== null && (!Number.isFinite(outcomeInput.current) || outcomeInput.current < 0))
        || !Number.isFinite(outcomeInput.target)
        || outcomeInput.target <= 0
        || !Number.isFinite(outcomeInput.neededHours)
        || outcomeInput.neededHours < 0
        || !Number.isFinite(outcomeInput.availableHours)
        || outcomeInput.availableHours < 0
      )
    ) {
      setPlanError('선택한 결과의 이름, 단위, 근거, 수치와 시간을 확인하세요.');
      return;
    }
    if (!updatePlan(planDraft) || (editingOutcomeId && outcomeInput && !updateOutcome(editingOutcomeId, outcomeInput))) {
      setPlanError('입력값을 확인한 뒤 다시 시도하세요.');
      return;
    }
    setPlanEditorOpen(false);
    setFeedback('연간·분기 계획을 저장했습니다.');
  };

  const submitOutcome = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = outcomeDraft.current.trim() === '' ? null : Number(outcomeDraft.current);
    const target = Number(outcomeDraft.target);
    const neededHours = Number(outcomeDraft.neededHours);
    const availableHours = Number(outcomeDraft.availableHours);
    if (!outcomeDraft.title.trim() || !outcomeDraft.unit.trim() || !outcomeDraft.evidenceLabel.trim()) {
      setOutcomeError('결과 이름, 측정 단위, 판단 근거를 입력하세요.');
      return;
    }
    if (
      (current !== null && (!Number.isFinite(current) || current < 0))
      || !Number.isFinite(target)
      || target <= 0
      || !Number.isFinite(neededHours)
      || neededHours < 0
      || !Number.isFinite(availableHours)
      || availableHours < 0
    ) {
      setOutcomeError('현재값은 비워두거나 0 이상, 목표는 0보다 크게, 시간은 0 이상으로 입력하세요.');
      return;
    }

    const input: OutcomeInput = {
      title: outcomeDraft.title,
      current,
      target,
      unit: outcomeDraft.unit,
      confidence: outcomeDraft.confidence,
      evidenceLabel: outcomeDraft.evidenceLabel,
      nextCheckDate: outcomeDraft.nextCheckDate || null,
      neededHours,
      availableHours
    };
    const saved = outcomeEditorMode === 'add'
      ? Boolean(addOutcome(input))
      : Boolean(editingOutcomeId && updateOutcome(editingOutcomeId, input));
    if (!saved) {
      setOutcomeError('결과를 저장하지 못했습니다. 입력값을 확인하세요.');
      return;
    }
    setOutcomeEditorMode(null);
    setFeedback(outcomeEditorMode === 'add' ? '새 분기 결과를 추가했습니다.' : '결과의 관리 기준을 저장했습니다.');
  };

  const clearStopQuery = () => {
    if (searchParams.get('action') !== 'stop') return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    nextParams.delete('task');
    setSearchParams(nextParams, { replace: true });
  };

  const closeLifecycle = () => {
    setLifecycleRequest(null);
    setTaskDisposition(null);
    clearStopQuery();
  };

  const requestLifecycle = (action: LifecycleAction, outcomeId: string) => {
    setOutcomeEditorMode(null);
    setLifecycleRequest({ action, outcomeId });
    setTaskDisposition(null);
  };

  const confirmLifecycle = () => {
    if (!lifecycleOutcome || !lifecycleAction || !taskDisposition) return;
    const affectedCount = linkedTasks.length;
    const completed = lifecycleAction === 'remove'
      ? removeOutcome(lifecycleOutcome.id, taskDisposition)
      : stopOutcome(lifecycleOutcome.id, taskDisposition);
    if (!completed) {
      setFeedback('요청을 반영하지 못했습니다. 다시 시도하세요.');
      closeLifecycle();
      return;
    }
    const actionLabel = lifecycleAction === 'remove' ? '삭제' : '중단';
    const taskLabel = taskDisposition === 'detach'
      ? `연결된 작업 ${affectedCount}개는 독립 작업으로 유지했습니다.`
      : `연결된 미완료 작업을 취소했습니다. 완료 작업, 과거 일정, 실행 기록은 보존했습니다.`;
    setFeedback(`결과를 ${actionLabel}했습니다. ${taskLabel}`);
    closeLifecycle();
  };

  const chooseDecision = (outcome: Outcome, decision: NonNullable<Outcome['decision']>) => {
    if (decision === 'stop') {
      requestLifecycle('stop', outcome.id);
      return;
    }
    setOutcomeDecision(outcome.id, decision);
    setFeedback(`${outcome.title} 결과를 '${decisions.find((item) => item.value === decision)?.label}'로 결정했습니다.`);
  };

  return (
    <div className="page page--goals">
      <header className="page-header goals-header">
        <div>
          <p className="eyebrow">GOALS · {plan.year} Q{plan.quarter}</p>
          <h1>결과와 결정을 한 화면에서 봅니다.</h1>
          <p className="page-header__description">분기 결과를 자유롭게 추가하고 수치·근거·투입 시간을 계속 관리하세요.</p>
        </div>
        <div className="goals-header__actions">
          <button className="button button--primary" type="button" onClick={() => openOutcomeEditor()}>
            <Plus size={16} aria-hidden="true" /> 결과 추가
          </button>
          <button className="button button--secondary" type="button" aria-label="계획과 결과 편집" onClick={openPlanEditor}>
            <Edit3 size={16} aria-hidden="true" /> 계획 편집
          </button>
        </div>
      </header>

      {feedback ? <p className="outcome-feedback" role="status">{feedback}</p> : null}

      <section className="goals-year-strip" aria-label="연간 계획과 분기 계획">
        <div className="goals-year-strip__period goals-year-strip__period--year">
          <span>YEAR {plan.year}</span>
          <strong>{plan.annualDirection}</strong>
          <small>{plan.year}.01—12</small>
        </div>
        <ChevronRight className="goals-year-strip__arrow" size={18} aria-hidden="true" />
        <div className="goals-year-strip__period goals-year-strip__period--quarter">
          <span>Q{plan.quarter} · 현재 분기</span>
          <strong>{plan.quarterFocus}</strong>
          <small>{formatPlanDate(plan.quarterEndDate)}까지</small>
        </div>
        <div className="goals-year-strip__checkpoint">
          <CalendarClock size={17} aria-hidden="true" />
          <span><small>분기 마감</small><strong>{formatPlanDate(plan.quarterEndDate)}</strong></span>
        </div>
      </section>

      <section className="goals-table-section quarter-outcomes">
        <div className="section-heading quarter-outcomes__heading">
          <div><p className="eyebrow">QUARTER OUTCOMES</p><h2>{plan.quarter}분기 결과</h2></div>
          <span className="section-heading__hint">현재 / 목표 · 확신 · 실제 / 계획 시간 · 다음 점검</span>
        </div>
        <p className="horizontal-scroll-hint" id="goals-scroll-hint">표를 좌우로 밀어 모든 열을 확인하세요.</p>
        <div className="goals-table-wrap" tabIndex={0} aria-describedby="goals-scroll-hint">
          <table className="goals-table quarter-outcomes__table">
            <thead>
              <tr>
                <th scope="col">결과</th><th scope="col">현재 / 목표</th><th scope="col">확신</th>
                <th scope="col">실제 / 계획 시간</th><th scope="col">다음 점검</th><th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome) => (
                <tr key={outcome.id}>
                  <td className="goals-table__outcome">
                    <strong>{outcome.title}</strong>
                    <span>{outcome.parentTitle}</span>
                    <button
                      className="button button--small button--secondary goals-table__edit"
                      type="button"
                      onClick={() => openOutcomeEditor(outcome)}
                      aria-label={`${outcome.title} 결과 수정`}
                    >
                      <Edit3 size={14} aria-hidden="true" /> 수정
                    </button>
                    <details className="metric-history">
                      <summary>지표 이력 {outcome.metricHistory.length}건</summary>
                      {outcome.metricHistory.length > 0 ? (
                        <ol>
                          {outcome.metricHistory.slice(-3).reverse().map((entry) => (
                            <li key={entry.id}>
                              <strong>{entry.value === null ? '측정값 없음' : `${entry.value}${outcome.unit}`}</strong>
                              <span>{formatMetricTimestamp(entry.observedAt, timeZone)}</span>
                              <small>{entry.evidence}</small>
                            </li>
                          ))}
                        </ol>
                      ) : <p>아직 기록된 지표 갱신이 없습니다.</p>}
                    </details>
                  </td>
                  <td><OutcomeProgress outcome={outcome} /></td>
                  <td>
                    <span className={`confidence confidence--${outcome.confidence}`}>
                      {outcome.confidence === 'unknown' ? <CircleHelp size={13} /> : <Target size={13} />}
                      {confidenceLabels[outcome.confidence]}
                    </span>
                  </td>
                  <td className={outcome.neededHours > outcome.availableHours ? 'is-danger' : ''}>
                    <strong>{outcome.actualHours}h / {outcome.neededHours}h</strong><span>가용 {outcome.availableHours}h</span>
                  </td>
                  <td><strong>{nextCheckLabel(outcome)}</strong><span>{metricUpdatedLabel(outcome)}</span></td>
                  <td>
                    <span className={`attention-badge attention-badge--${outcome.attention}`}>
                      {outcome.attention === 'none' ? <Check size={13} /> : outcome.decision === 'stop' ? <PauseCircle size={13} /> : <AlertCircle size={13} />}
                      {outcome.decision ? decisions.find((item) => item.value === outcome.decision)?.label : attentionCopy[outcome.attention].label}
                    </span>
                  </td>
                </tr>
              ))}
              {outcomes.length === 0 ? (
                <tr className="goals-table__empty">
                  <td colSpan={6}>
                    <span>관리할 분기 결과가 없습니다.</span>
                    <button className="button button--primary" type="button" onClick={() => openOutcomeEditor()}>
                      <Plus size={15} aria-hidden="true" /> 첫 결과 추가
                    </button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="decision-section decision-queue">
        <div className="section-heading decision-section__heading">
          <div><p className="eyebrow">DECISION QUEUE</p><h2>오래된 수치와 시간 위험부터 결정합니다.</h2></div>
          <span className="decision-progress"><Check size={15} /> <span>{decidedCount}/{attentionOutcomes.length} 결정</span></span>
        </div>
        <div className="decision-grid decision-list">
          {attentionOutcomes.map((outcome, index) => {
            const copy = attentionCopy[outcome.attention];
            return (
              <article
                key={outcome.id}
                className={clsx('decision-card', 'decision-row', outcome.decision && 'decision-card--decided', index < 2 && 'decision-row--priority')}
              >
                <div className="decision-row__summary">
                  <header className="decision-card__header">
                    <span className={`attention-badge attention-badge--${outcome.attention}`}><ShieldAlert size={14} /> {copy.label}</span>
                    <span className="decision-card__parent">{outcome.parentTitle}</span>
                  </header>
                  <h3>결정 · {outcome.title}</h3><p className="decision-card__reason">{copy.reason}</p>
                </div>
                <dl className="evidence-grid decision-row__signals">
                  <div><dt><Gauge size={14} /> 근거</dt><dd>{outcome.evidenceLabel}</dd></div>
                  <div><dt><TrendingUp size={14} /> 변화</dt><dd>{outcome.changeLabel}</dd></div>
                  <div className={outcome.neededHours > outcome.availableHours ? 'is-danger' : ''}>
                    <dt><Clock3 size={14} /> 시간</dt><dd>필요 {outcome.neededHours}h · 가능 {outcome.availableHours}h</dd>
                  </div>
                </dl>
                <div className="decision-actions decision-row__actions" role="group" aria-label={`${outcome.title} 결정`}>
                  {decisions.map((decision) => (
                    <button
                      key={decision.value}
                      type="button"
                      className={outcome.decision === decision.value ? 'is-selected' : ''}
                      aria-pressed={outcome.decision === decision.value}
                      onClick={() => chooseDecision(outcome, decision.value)}
                    >
                      {decision.label}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
          {attentionOutcomes.length === 0 ? <p className="decision-list__empty">지금 바로 결정할 위험 신호가 없습니다.</p> : null}
        </div>
      </section>

      {planEditorOpen ? (
        <Modal
          eyebrow="계획 관리"
          title="계획 편집"
          description="계획의 방향과 현재 분기 기준을 수정합니다. 결과는 별도로 추가하고 관리할 수 있습니다."
          className="plan-editor-modal"
          onClose={() => setPlanEditorOpen(false)}
        >
          <form className="plan-editor form-grid" onSubmit={submitPlan}>
            <label className="field">
              <span className="field-label">연간 방향</span>
              <textarea
                data-autofocus
                value={planDraft.annualDirection}
                onChange={(event) => setPlanDraft((current) => ({ ...current, annualDirection: event.target.value }))}
              />
            </label>
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field-label">연도</span><input type="number" min="1900" max="9999" value={planDraft.year} onChange={(event) => setPlanDraft((current) => ({ ...current, year: Number(event.target.value) }))} /></label>
              <label className="field">
                <span className="field-label">분기</span>
                <select value={planDraft.quarter} onChange={(event) => setPlanDraft((current) => ({ ...current, quarter: Number(event.target.value) as Quarter }))}>
                  {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>{quarter}분기</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span className="field-label">분기 초점</span><input value={planDraft.quarterFocus} onChange={(event) => setPlanDraft((current) => ({ ...current, quarterFocus: event.target.value }))} /></label>
            <label className="field"><span className="field-label">분기 마감일</span><input type="date" value={planDraft.quarterEndDate} onChange={(event) => setPlanDraft((current) => ({ ...current, quarterEndDate: event.target.value }))} /></label>
            {editingOutcome ? (
              <section className="plan-editor__section form-grid">
                <h3>함께 편집할 결과</h3>
                <label className="field">
                  <span className="field-label">수정할 결과</span>
                  <select value={editingOutcome.id} onChange={(event) => selectOutcomeDraft(outcomes.find((outcome) => outcome.id === event.target.value))}>
                    {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">결과 이름</span><input value={outcomeDraft.title} onChange={(event) => setOutcomeDraft((currentDraft) => ({ ...currentDraft, title: event.target.value }))} /></label>
                <div className="form-grid form-grid--two">
                  <label className="field"><span className="field-label">목표값</span><input type="number" min="0" step="any" value={outcomeDraft.target} onChange={(event) => setOutcomeDraft((currentDraft) => ({ ...currentDraft, target: event.target.value }))} /></label>
                  <label className="field"><span className="field-label">측정 단위</span><input value={outcomeDraft.unit} onChange={(event) => setOutcomeDraft((currentDraft) => ({ ...currentDraft, unit: event.target.value }))} /></label>
                </div>
              </section>
            ) : null}
            {planError ? <p className="form-error field-error" role="alert">{planError}</p> : null}
            <div className="modal__actions">
              <button className="button button--secondary" type="button" onClick={() => setPlanEditorOpen(false)}>취소</button>
              <button className="button button--primary" type="submit">계획 반영</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {outcomeEditorMode ? (
        <Modal
          eyebrow="결과 관리"
          title={outcomeEditorMode === 'add' ? '분기 결과 추가' : '계획 편집'}
          description={`‘${plan.quarterFocus}’ 아래에서 수치, 근거, 시간을 한 번에 관리합니다.`}
          className="outcome-editor-modal"
          onClose={() => setOutcomeEditorMode(null)}
        >
          <form className="outcome-editor form-grid" onSubmit={submitOutcome}>
            {outcomeEditorMode === 'edit' ? (
              <label className="field">
                <span className="field-label">수정할 결과</span>
                <select
                  value={editingOutcomeId ?? ''}
                  onChange={(event) => selectOutcomeDraft(outcomes.find((outcome) => outcome.id === event.target.value))}
                >
                  {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span className="field-label">결과 이름</span>
              <input data-autofocus value={outcomeDraft.title} onChange={(event) => setOutcomeDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field-label">현재값 <small>측정 전이면 비워두기</small></span><input type="number" min="0" step="any" value={outcomeDraft.current} onChange={(event) => setOutcomeDraft((current) => ({ ...current, current: event.target.value }))} /></label>
              <label className="field"><span className="field-label">목표값</span><input type="number" min="0" step="any" value={outcomeDraft.target} onChange={(event) => setOutcomeDraft((current) => ({ ...current, target: event.target.value }))} /></label>
              <label className="field"><span className="field-label">측정 단위</span><input placeholder="예: 명, 편, 만원" value={outcomeDraft.unit} onChange={(event) => setOutcomeDraft((current) => ({ ...current, unit: event.target.value }))} /></label>
              <label className="field">
                <span className="field-label">달성 확신</span>
                <select value={outcomeDraft.confidence} onChange={(event) => setOutcomeDraft((current) => ({ ...current, confidence: event.target.value as Outcome['confidence'] }))}>
                  {(Object.keys(confidenceLabels) as Outcome['confidence'][]).map((confidence) => (
                    <option key={confidence} value={confidence}>{confidenceLabels[confidence]}</option>
                  ))}
                </select>
              </label>
              <label className="field"><span className="field-label">필요 시간</span><input type="number" min="0" step="any" value={outcomeDraft.neededHours} onChange={(event) => setOutcomeDraft((current) => ({ ...current, neededHours: event.target.value }))} /></label>
              <label className="field"><span className="field-label">가용 시간</span><input type="number" min="0" step="any" value={outcomeDraft.availableHours} onChange={(event) => setOutcomeDraft((current) => ({ ...current, availableHours: event.target.value }))} /></label>
              <label className="field"><span className="field-label">다음 점검일 <small>선택</small></span><input type="date" value={outcomeDraft.nextCheckDate} onChange={(event) => setOutcomeDraft((current) => ({ ...current, nextCheckDate: event.target.value }))} /></label>
            </div>
            <label className="field">
              <span className="field-label">판단 근거</span>
              <input placeholder="예: 대시보드 9월 2일 확인" value={outcomeDraft.evidenceLabel} onChange={(event) => setOutcomeDraft((current) => ({ ...current, evidenceLabel: event.target.value }))} />
            </label>
            {editingOutcome ? (
              <div className="outcome-editor-context" aria-label="선택한 결과의 현재 관리 정보">
                <span>연결 작업 <strong>{tasks.filter((task) => task.outcomeId === editingOutcome.id).length}개</strong></span>
                <span>실제 투입 <strong>{editingOutcome.actualHours}시간</strong></span>
                <span>현재 결정 <strong>{editingOutcome.decision ? decisions.find((item) => item.value === editingOutcome.decision)?.label : '결정 전'}</strong></span>
              </div>
            ) : null}
            {outcomeError ? <p className="form-error field-error" role="alert">{outcomeError}</p> : null}
            <div className="modal__actions outcome-editor__actions">
              {editingOutcome ? (
                <button className="button button--warning outcome-editor__delete" type="button" onClick={() => requestLifecycle('remove', editingOutcome.id)}>
                  <Trash2 size={15} aria-hidden="true" /> 결과 삭제
                </button>
              ) : null}
              <span className="outcome-editor__action-spacer" />
              <button className="button button--secondary" type="button" onClick={() => setOutcomeEditorMode(null)}>취소</button>
              <button className="button button--primary" type="submit">{outcomeEditorMode === 'add' ? '결과 추가' : '결과 저장'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {lifecycleOutcome && lifecycleAction ? (
        <Modal
          eyebrow="연결 작업 확인"
          title={`${lifecycleOutcome.title} ${lifecycleAction === 'remove' ? '삭제 확인' : '중단 확인'}`}
          description="결과만 없애거나 멈추기 전에, 연결된 작업을 어떻게 처리할지 직접 선택하세요."
          className="outcome-lifecycle-modal"
          onClose={closeLifecycle}
        >
          <div className="outcome-lifecycle">
            {stopTask && stopTask.outcomeId === lifecycleOutcome.id ? (
              <p><strong>{stopTask.title}</strong>의 상위 결과는 <strong>{lifecycleOutcome.title}</strong>입니다.</p>
            ) : null}
            <div className="outcome-linked-summary">
              <strong>연결된 작업 {linkedTasks.length}개</strong>
              {listedLinkedTasks.length > 0 ? (
                <ul>
                  {listedLinkedTasks.slice(0, 4).map((task) => <li key={task.id}>{task.title}</li>)}
                </ul>
              ) : <p>{linkedTasks.length > 0 ? '위에서 확인한 작업 외 추가 연결 작업은 없습니다.' : '연결된 작업이 없습니다.'}</p>}
              {listedLinkedTasks.length > 4 ? <small>외 {listedLinkedTasks.length - 4}개</small> : null}
            </div>
            <fieldset className="outcome-lifecycle-options">
              <legend>연결 작업 처리 방식</legend>
              <label className={clsx('outcome-lifecycle-option', taskDisposition === 'detach' && 'is-selected')}>
                <input type="radio" name="task-disposition" value="detach" checked={taskDisposition === 'detach'} onChange={() => setTaskDisposition('detach')} />
                <span><strong>연결만 해제하고 작업 유지</strong><small>작업, 일정, 실행 기록은 남기고 결과와의 연결만 끊습니다.</small></span>
              </label>
              <label className={clsx('outcome-lifecycle-option', taskDisposition === 'cancel' && 'is-selected')}>
                <input type="radio" name="task-disposition" value="cancel" checked={taskDisposition === 'cancel'} onChange={() => setTaskDisposition('cancel')} />
                <span><strong>연결된 미완료 작업 취소</strong><small>미완료 작업과 앞으로의 시간 블록만 취소합니다. 완료 작업, 과거 일정, 실행 기록은 보존합니다.</small></span>
              </label>
            </fieldset>
            {!taskDisposition ? <p className="field-hint" role="status">계속하려면 작업 처리 방식을 선택하세요.</p> : null}
            <div className="modal__actions">
              <button className="button button--secondary" type="button" data-autofocus onClick={closeLifecycle}>돌아가기</button>
              <button className="button button--warning" type="button" disabled={!taskDisposition} onClick={confirmLifecycle}>
                {lifecycleAction === 'remove' ? '선택대로 삭제' : '선택대로 중단'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
