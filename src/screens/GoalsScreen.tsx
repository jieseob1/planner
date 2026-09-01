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
  ShieldAlert,
  Target,
  TrendingUp
} from 'lucide-react';
import clsx from 'clsx';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { confidenceLabels } from '../lib/format';
import { usePlanner } from '../state/PlannerProvider';
import type { Outcome } from '../domain/types';

type Quarter = 1 | 2 | 3 | 4;

interface PlanDraft {
  year: number;
  annualDirection: string;
  quarter: Quarter;
  quarterFocus: string;
  quarterEndDate: string;
}

interface OutcomeDraft {
  title: string;
  target: string;
  neededHours: string;
  availableHours: string;
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

function createOutcomeDraft(outcome: Outcome | undefined): OutcomeDraft {
  return {
    title: outcome?.title ?? '',
    target: outcome ? String(outcome.target) : '',
    neededHours: outcome ? String(outcome.neededHours) : '',
    availableHours: outcome ? String(outcome.availableHours) : ''
  };
}

function formatPlanDate(value: string) {
  const [, month, day] = value.split('-').map(Number);
  return month && day ? `${month}월 ${day}일` : value;
}

function nextCheckLabel(outcome: Outcome) {
  if (outcome.lastUpdatedDays === null) return '오늘 · 기준 설정';
  if (outcome.lastUpdatedDays >= 7) return `오늘 · ${outcome.lastUpdatedDays}일 지연`;
  return `금요일 · ${outcome.lastUpdatedDays}일 전 갱신`;
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
  const { plan, tasks, outcomes, setOutcomeDecision, savePlan } = usePlanner();
  const [searchParams, setSearchParams] = useSearchParams();
  const firstOutcome = outcomes[0];
  const [editorOpen, setEditorOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => ({ ...plan }));
  const [editOutcomeId, setEditOutcomeId] = useState(firstOutcome?.id ?? '');
  const [outcomeDraft, setOutcomeDraft] = useState<OutcomeDraft>(() => createOutcomeDraft(firstOutcome));
  const [editorError, setEditorError] = useState('');
  const [manualStopOutcomeId, setManualStopOutcomeId] = useState<string | null>(null);
  const attentionOutcomes = outcomes
    .filter((outcome) => outcome.attention !== 'none')
    .sort((left, right) => attentionPriority[left.attention] - attentionPriority[right.attention]);
  const decidedCount = attentionOutcomes.filter((outcome) => outcome.decision).length;
  const stopTask = searchParams.get('action') === 'stop'
    ? tasks.find((task) => task.id === searchParams.get('task'))
    : undefined;
  const queriedStopOutcome = stopTask?.outcomeId
    ? outcomes.find((outcome) => outcome.id === stopTask.outcomeId)
    : undefined;
  const stopOutcome = outcomes.find((outcome) => outcome.id === manualStopOutcomeId) ?? queriedStopOutcome;

  const openPlanEditor = () => {
    const selectedOutcome = outcomes.find((outcome) => outcome.id === editOutcomeId) ?? outcomes[0];
    setPlanDraft({ ...plan });
    setEditOutcomeId(selectedOutcome?.id ?? '');
    setOutcomeDraft(createOutcomeDraft(selectedOutcome));
    setEditorError('');
    setEditorOpen(true);
  };

  const selectEditOutcome = (outcomeId: string) => {
    const outcome = outcomes.find((item) => item.id === outcomeId);
    setEditOutcomeId(outcomeId);
    setOutcomeDraft(createOutcomeDraft(outcome));
    setEditorError('');
  };

  const submitPlan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(outcomeDraft.target);
    const neededHours = Number(outcomeDraft.neededHours);
    const availableHours = Number(outcomeDraft.availableHours);
    if (!planDraft.annualDirection.trim() || !planDraft.quarterFocus.trim() || !planDraft.quarterEndDate || !outcomeDraft.title.trim()) {
      setEditorError('연간 방향, 분기 초점, 마감일, 결과 이름을 모두 입력하세요.');
      return;
    }
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(neededHours) || neededHours < 0 || !Number.isFinite(availableHours) || availableHours < 0) {
      setEditorError('목표는 0보다 크게, 필요·가용 시간은 0 이상으로 입력하세요.');
      return;
    }
    if (!editOutcomeId) {
      setEditorError('수정할 결과를 선택하세요.');
      return;
    }
    savePlan({
      plan: {
        ...planDraft,
        annualDirection: planDraft.annualDirection.trim(),
        quarterFocus: planDraft.quarterFocus.trim()
      },
      outcomeId: editOutcomeId,
      outcomePatch: {
        title: outcomeDraft.title.trim(),
        target,
        neededHours,
        availableHours
      }
    });
    setEditorOpen(false);
  };

  const clearStopQuery = () => {
    if (searchParams.get('action') !== 'stop') return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    nextParams.delete('task');
    setSearchParams(nextParams, { replace: true });
  };

  const closeStopConfirmation = () => {
    setManualStopOutcomeId(null);
    clearStopQuery();
  };

  const confirmStop = () => {
    if (!stopOutcome) return;
    setOutcomeDecision(stopOutcome.id, 'stop');
    closeStopConfirmation();
  };

  const chooseDecision = (outcome: Outcome, decision: NonNullable<Outcome['decision']>) => {
    if (decision === 'stop') {
      setManualStopOutcomeId(outcome.id);
      return;
    }
    setOutcomeDecision(outcome.id, decision);
  };

  return (
    <div className="page page--goals">
      <header className="page-header goals-header">
        <div>
          <p className="eyebrow">GOALS · {plan.year} Q{plan.quarter}</p>
          <h1>결과와 결정을 한 화면에서 봅니다.</h1>
          <p className="page-header__description">목표를 더 만들기 전에, 지금 결과의 수치·시간·다음 점검을 확인하세요.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={openPlanEditor}><Edit3 size={16} /> 계획 편집</button>
      </header>

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
                  <td className="goals-table__outcome"><strong>{outcome.title}</strong><span>{outcome.parentTitle}</span></td>
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
                  <td><strong>{nextCheckLabel(outcome)}</strong><span>{outcome.evidenceLabel}</span></td>
                  <td>
                    <span className={`attention-badge attention-badge--${outcome.attention}`}>
                      {outcome.attention === 'none' ? <Check size={13} /> : outcome.decision === 'stop' ? <PauseCircle size={13} /> : <AlertCircle size={13} />}
                      {outcome.decision ? decisions.find((item) => item.value === outcome.decision)?.label : attentionCopy[outcome.attention].label}
                    </span>
                  </td>
                </tr>
              ))}
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
                  <h3>{outcome.title}</h3><p className="decision-card__reason">{copy.reason}</p>
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
        </div>
      </section>

      {editorOpen ? (
        <Modal
          title="계획 편집"
          description="연간 방향과 현재 분기, 선택한 결과를 수정하면 기기에 즉시 보관되고 서버에 동기화됩니다."
          className="plan-editor-modal"
          onClose={() => setEditorOpen(false)}
        >
          <form className="plan-editor form-grid" onSubmit={submitPlan}>
            <section className="plan-editor__section form-grid">
              <h3>연간·분기 계획</h3>
              <label className="field">
                <span className="field-label">연간 방향</span>
                <textarea
                  data-autofocus
                  value={planDraft.annualDirection}
                  onChange={(event) => setPlanDraft((current) => ({ ...current, annualDirection: event.target.value }))}
                />
              </label>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field-label">연도</span><input type="number" value={planDraft.year} onChange={(event) => setPlanDraft((current) => ({ ...current, year: Number(event.target.value) }))} /></label>
                <label className="field">
                  <span className="field-label">분기</span>
                  <select value={planDraft.quarter} onChange={(event) => setPlanDraft((current) => ({ ...current, quarter: Number(event.target.value) as Quarter }))}>
                    {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>{quarter}분기</option>)}
                  </select>
                </label>
              </div>
              <label className="field"><span className="field-label">분기 초점</span><input value={planDraft.quarterFocus} onChange={(event) => setPlanDraft((current) => ({ ...current, quarterFocus: event.target.value }))} /></label>
              <label className="field"><span className="field-label">분기 마감일</span><input type="date" value={planDraft.quarterEndDate} onChange={(event) => setPlanDraft((current) => ({ ...current, quarterEndDate: event.target.value }))} /></label>
            </section>

            <section className="plan-editor__section form-grid">
              <h3>결과 기준</h3>
              <label className="field">
                <span className="field-label">수정할 결과</span>
                <select value={editOutcomeId} onChange={(event) => selectEditOutcome(event.target.value)}>
                  {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                </select>
              </label>
              <label className="field"><span className="field-label">결과 이름</span><input value={outcomeDraft.title} onChange={(event) => setOutcomeDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field-label">목표값</span><input type="number" min="0" step="any" value={outcomeDraft.target} onChange={(event) => setOutcomeDraft((current) => ({ ...current, target: event.target.value }))} /></label>
                <label className="field"><span className="field-label">필요 시간</span><input type="number" min="0" step="any" value={outcomeDraft.neededHours} onChange={(event) => setOutcomeDraft((current) => ({ ...current, neededHours: event.target.value }))} /></label>
                <label className="field"><span className="field-label">가용 시간</span><input type="number" min="0" step="any" value={outcomeDraft.availableHours} onChange={(event) => setOutcomeDraft((current) => ({ ...current, availableHours: event.target.value }))} /></label>
              </div>
            </section>
            {editorError ? <p className="form-error field-error" role="alert">{editorError}</p> : null}
            <div className="modal__actions">
              <button className="button button--secondary" type="button" onClick={() => setEditorOpen(false)}>취소</button>
              <button className="button button--primary" type="submit">계획 반영</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {stopOutcome ? (
        <Modal
          title={`${stopOutcome.title} 중단 확인`}
          description="중단 결정은 현재 계획에 즉시 반영되고 서버에 동기화됩니다."
          className="stop-confirm-modal"
          onClose={closeStopConfirmation}
        >
          <div className="stop-confirmation">
            {stopTask && stopTask.outcomeId === stopOutcome.id ? (
              <p><strong>{stopTask.title}</strong>의 상위 결과는 <strong>{stopOutcome.title}</strong>입니다.</p>
            ) : <p><strong>{stopOutcome.title}</strong> 결과를 중단 대상으로 선택했습니다.</p>}
            <p>연결된 실행을 다시 검토한 뒤, 정말 멈출 때만 중단을 확정하세요.</p>
            <div className="modal__actions">
              <button className="button button--secondary" type="button" data-autofocus onClick={closeStopConfirmation}>계속 진행</button>
              <button className="button button--warning" type="button" onClick={confirmStop}>이 결과 중단</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
