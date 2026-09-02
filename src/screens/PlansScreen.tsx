import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Check, Clock3, History, Plus, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { planHistoryApi } from '../api/planHistoryApi';
import { Modal } from '../components/Modal';
import type { PlanAuditEvent, PlanStatus, PlanSummary, PlannerSnapshot } from '../domain/types';
import { formatInstantInTimeZone } from '../lib/calendarDate';
import { usePlanner } from '../state/PlannerProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const statusLabel: Record<PlanStatus, string> = {
  ACTIVE: '현재 실행 중',
  DRAFT: '초안',
  CLOSED: '종료',
  ARCHIVED: '보관'
};

const actionLabel: Record<string, string> = {
  PLAN_CREATED: '계획 생성',
  PLAN_CREATED_AND_ACTIVATED: '첫 계획 생성·활성화',
  PLAN_ACTIVE: '계획 활성화',
  PLAN_ACTIVATED_SNAPSHOT_LOADED: '활성 계획으로 전환',
  PLAN_CLOSED: '계획 종료',
  PLAN_ARCHIVED: '계획 보관',
  PLAN_DRAFT: '계획 복원',
  PLAN_SNAPSHOT_UPDATED: '계획 내용 저장',
  ACTIVE_SNAPSHOT_REMOVED: '활성 실행 데이터 정리'
};

const quarterEnd = (year: number, quarter: number) => {
  const month = quarter * 3;
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
};

export type PlanCopyScope = 'goal-structure' | 'blank';

interface PlanDraftInput {
  year: number;
  quarter: number;
  annualDirection: string;
  quarterFocus: string;
  copyScope: PlanCopyScope;
}

type PlanDraftErrors = Partial<Record<'title' | 'year' | 'annualDirection' | 'quarterFocus', string>>;

export const validatePlanDraft = (title: string, input: PlanDraftInput): PlanDraftErrors => {
  const errors: PlanDraftErrors = {};
  if (!title.trim()) errors.title = '계획 이름을 입력하세요.';
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 9999) errors.year = '1900~9999 사이의 연도를 입력하세요.';
  if (!input.annualDirection.trim()) errors.annualDirection = '1년 방향을 입력하세요.';
  if (!input.quarterFocus.trim()) errors.quarterFocus = '이번 분기 초점을 입력하세요.';
  return errors;
};

export const buildPlanDraftSnapshot = (source: PlannerSnapshot, input: PlanDraftInput): PlannerSnapshot => ({
  version: source.version,
  plan: {
    year: input.year,
    quarter: input.quarter as 1 | 2 | 3 | 4,
    annualDirection: input.annualDirection.trim(),
    quarterFocus: input.quarterFocus.trim(),
    quarterEndDate: quarterEnd(input.year, input.quarter)
  },
  plannerWeekOffset: 0,
  tasks: [],
  timeBlocks: [],
  timeEntries: [],
  outcomes: input.copyScope === 'goal-structure'
    ? source.outcomes.map((outcome) => ({
        ...structuredClone(outcome),
        current: null,
        confidence: 'unknown',
        lastUpdatedDays: null,
        metricUpdatedAt: null,
        nextCheckDate: null,
        metricHistory: [],
        actualHours: 0,
        evidenceLabel: '새 계획에서 측정 근거 설정',
        changeLabel: '새 계획 시작',
        attention: 'no-evidence',
        decision: undefined
      }))
    : [],
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: [],
    metricDraft: '',
    completedAt: null
  }
});

export function PlansScreen() {
  const planner = usePlanner();
  const { timeZone } = useTimeZone();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activationReloadPending, setActivationReloadPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [auditPlan, setAuditPlan] = useState<PlanSummary | null>(null);
  const [auditEvents, setAuditEvents] = useState<PlanAuditEvent[]>([]);
  const nextQuarter = planner.plan.quarter === 4 ? 1 : planner.plan.quarter + 1;
  const nextYear = planner.plan.quarter === 4 ? planner.plan.year + 1 : planner.plan.year;
  const [title, setTitle] = useState(`${nextYear}년 ${nextQuarter}분기 계획`);
  const [annualDirection, setAnnualDirection] = useState(planner.plan.annualDirection);
  const [quarterFocus, setQuarterFocus] = useState('');
  const [year, setYear] = useState(nextYear);
  const [quarter, setQuarter] = useState(nextQuarter);
  const [copyScope, setCopyScope] = useState<PlanCopyScope>('goal-structure');
  const [createErrors, setCreateErrors] = useState<PlanDraftErrors>({});

  const snapshot = useMemo<PlannerSnapshot>(() => ({
    version: planner.version,
    plan: planner.plan,
    plannerWeekOffset: planner.plannerWeekOffset,
    tasks: planner.tasks,
    timeBlocks: planner.timeBlocks,
    timeEntries: planner.timeEntries,
    outcomes: planner.outcomes,
    timer: planner.timer,
    review: planner.review
  }), [planner]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await planHistoryApi.list());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '계획 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createPlan = async () => {
    const input: PlanDraftInput = { year, quarter, annualDirection, quarterFocus, copyScope };
    const validationErrors = validatePlanDraft(title, input);
    setCreateErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    setBusyId('create');
    try {
      const nextSnapshot = buildPlanDraftSnapshot(snapshot, input);
      await planHistoryApi.create(crypto.randomUUID(), title.trim(), nextSnapshot);
      setCreateOpen(false);
      setCreateErrors({});
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '계획을 만들지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (plan: PlanSummary, action: 'activate' | 'close' | 'archive' | 'restore') => {
    if (action === 'close' && !window.confirm('현재 계획을 종료할까요? 실행 화면에서는 다른 계획을 활성화할 때까지 편집할 수 없습니다.')) return;
    setBusyId(plan.id);
    try {
      await planHistoryApi.action(plan.id, action);
      if (action === 'activate') {
        await load();
        const reloaded = await planner.reloadFromServer();
        if (!reloaded) {
          setActivationReloadPending(true);
          setError('계획은 활성화됐지만 새 내용을 불러오지 못했습니다. 이전 계획을 편집하지 않도록 여기서 다시 불러오세요.');
          return;
        }
        setActivationReloadPending(false);
        navigate('/today');
        return;
      } else if (action === 'close') {
        planner.markActivePlanClosed();
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '계획 상태를 변경하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const retryActivatedPlanReload = async () => {
    setBusyId('reload-active');
    try {
      const reloaded = await planner.reloadFromServer();
      if (!reloaded) {
        setError('활성 계획을 아직 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.');
        return;
      }
      setActivationReloadPending(false);
      setError('');
      navigate('/today');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '활성 계획을 불러오지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const showAudit = async (plan: PlanSummary) => {
    setAuditPlan(plan);
    setAuditEvents([]);
    try {
      setAuditEvents(await planHistoryApi.audit(plan.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '변경 이력을 불러오지 못했습니다.');
    }
  };

  return (
    <div className="screen plans-screen">
      <header className="screen-header plans-header">
        <div>
          <p className="eyebrow">PLAN LIBRARY</p>
          <h1>연간·분기 계획</h1>
          <p>하나의 메모가 아니라 계획의 시작, 실행, 종료와 근거를 이력으로 관리합니다.</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => {
          setCreateErrors({});
          setCreateOpen(true);
        }}>
          <Plus size={18} aria-hidden="true" /> 새 계획
        </button>
      </header>

      {error && (
        <div className="inline-alert" role="alert">
          <span>{error}</span>
          {activationReloadPending ? (
            <button className="button button--secondary button--small" type="button" disabled={busyId === 'reload-active'} onClick={() => void retryActivatedPlanReload()}>
              활성 계획 다시 불러오기
            </button>
          ) : null}
        </div>
      )}
      {loading ? <p role="status">계획 목록을 불러오고 있습니다…</p> : (
        <div className="plan-library" aria-label="계획 목록">
          {plans.length === 0 && (
            <div className="integration-empty">
              <div>
                <strong>아직 저장된 계획이 없습니다</strong>
                <p>새 계획을 만들어 연간 방향과 첫 분기 실행을 시작하세요.</p>
              </div>
            </div>
          )}
          {plans.map((plan) => (
            <article className={`plan-card plan-card--${plan.status.toLowerCase()}`} key={plan.id}>
              <div className="plan-card__heading">
                <div>
                  <span className="plan-status">{statusLabel[plan.status]}</span>
                  <h2>{plan.title}</h2>
                  <p>{plan.year}년 {plan.quarter}분기 · 최근 변경 {formatInstantInTimeZone(plan.updatedAt, timeZone, {
                    year: 'numeric', month: 'numeric', day: 'numeric'
                  })}</p>
                </div>
                {plan.status === 'ACTIVE' && <Check size={22} aria-label="활성 계획" />}
              </div>
              <div className="plan-card__meta">
                <span><Clock3 size={15} aria-hidden="true" /> revision {plan.sourceRevision ?? '—'}</span>
                <span>생성 {formatInstantInTimeZone(plan.createdAt, timeZone, {
                  year: 'numeric', month: 'numeric', day: 'numeric'
                })}</span>
              </div>
              <div className="plan-card__actions">
                {plan.status !== 'ACTIVE' && plan.status !== 'ARCHIVED' && (
                  <button className="button button--primary" type="button" disabled={busyId === plan.id} onClick={() => void runAction(plan, 'activate')}>
                    이 계획 실행
                  </button>
                )}
                {plan.status === 'ACTIVE' && (
                  <button className="button button--secondary" type="button" disabled={busyId === plan.id} onClick={() => void runAction(plan, 'close')}>
                    계획 종료
                  </button>
                )}
                {plan.status === 'ARCHIVED' && (
                  <button className="button button--secondary" type="button" disabled={busyId === plan.id} onClick={() => void runAction(plan, 'restore')}>
                    <RotateCcw size={16} aria-hidden="true" /> 복원
                  </button>
                )}
                {(plan.status === 'DRAFT' || plan.status === 'CLOSED') && (
                  <button className="button button--secondary" type="button" disabled={busyId === plan.id} onClick={() => void runAction(plan, 'archive')}>
                    <Archive size={16} aria-hidden="true" /> 보관
                  </button>
                )}
                <button className="button button--ghost" type="button" onClick={() => void showAudit(plan)}>
                  <History size={16} aria-hidden="true" /> 변경 이력
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal
          title="새 연간·분기 계획"
          description="목표 구조만 선택적으로 가져오며, 할 일·일정·실행 기록·회고는 새로 시작합니다."
          onClose={() => {
            setCreateErrors({});
            setCreateOpen(false);
          }}
        >
          <div className="form-grid plan-create-form">
            <label className="field">
              계획 이름
              <input
                aria-label="계획 이름"
                value={title}
                maxLength={200}
                aria-invalid={Boolean(createErrors.title)}
                aria-describedby={createErrors.title ? 'plan-title-error' : undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setCreateErrors((current) => ({ ...current, title: undefined }));
                }}
              />
              {createErrors.title ? <small id="plan-title-error" className="form-error" role="alert">{createErrors.title}</small> : null}
            </label>
            <div className="form-grid__columns">
              <label className="field">
                연도
                <input
                  aria-label="연도"
                  type="number"
                  min="1900"
                  max="9999"
                  value={year}
                  aria-invalid={Boolean(createErrors.year)}
                  aria-describedby={createErrors.year ? 'plan-year-error' : undefined}
                  onChange={(event) => {
                    setYear(Number(event.target.value));
                    setCreateErrors((current) => ({ ...current, year: undefined }));
                  }}
                />
                {createErrors.year ? <small id="plan-year-error" className="form-error" role="alert">{createErrors.year}</small> : null}
              </label>
              <label className="field">분기<select value={quarter} onChange={(event) => setQuarter(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}분기</option>)}</select></label>
            </div>
            <label className="field">
              1년 방향
              <textarea
                aria-label="1년 방향"
                value={annualDirection}
                maxLength={2000}
                aria-invalid={Boolean(createErrors.annualDirection)}
                aria-describedby={createErrors.annualDirection ? 'plan-direction-error' : undefined}
                onChange={(event) => {
                  setAnnualDirection(event.target.value);
                  setCreateErrors((current) => ({ ...current, annualDirection: undefined }));
                }}
              />
              {createErrors.annualDirection ? <small id="plan-direction-error" className="form-error" role="alert">{createErrors.annualDirection}</small> : null}
            </label>
            <label className="field">
              이번 분기 초점
              <textarea
                aria-label="이번 분기 초점"
                value={quarterFocus}
                maxLength={2000}
                autoFocus
                data-autofocus
                aria-invalid={Boolean(createErrors.quarterFocus)}
                aria-describedby={createErrors.quarterFocus ? 'plan-focus-error' : undefined}
                onChange={(event) => {
                  setQuarterFocus(event.target.value);
                  setCreateErrors((current) => ({ ...current, quarterFocus: undefined }));
                }}
              />
              {createErrors.quarterFocus ? <small id="plan-focus-error" className="form-error" role="alert">{createErrors.quarterFocus}</small> : null}
            </label>
            <div className="field">
              <span className="field-label" id="plan-copy-scope-label">현재 계획에서 가져올 내용</span>
              <div className="segmented" role="radiogroup" aria-labelledby="plan-copy-scope-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={copyScope === 'goal-structure'}
                  className={copyScope === 'goal-structure' ? 'is-selected' : ''}
                  onClick={() => setCopyScope('goal-structure')}
                >
                  목표 구조만
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={copyScope === 'blank'}
                  className={copyScope === 'blank' ? 'is-selected' : ''}
                  onClick={() => setCopyScope('blank')}
                >
                  빈 계획
                </button>
              </div>
              <small>
                {copyScope === 'goal-structure'
                  ? '결과 이름·목표값·예상/가용 시간만 복사합니다. 현재값·근거·판단과 모든 실행 내역은 제외됩니다.'
                  : '결과와 실행 내역을 모두 제외하고 빈 계획으로 시작합니다.'}
              </small>
            </div>
          </div>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => {
              setCreateErrors({});
              setCreateOpen(false);
            }}>취소</button>
            <button className="button button--primary" type="button" disabled={busyId === 'create'} onClick={() => void createPlan()}>초안 만들기</button>
          </div>
        </Modal>
      )}

      {auditPlan && (
        <Modal title={`${auditPlan.title} 변경 이력`} description="서버에 기록된 주요 상태 변경과 저장 revision입니다." onClose={() => setAuditPlan(null)}>
          <ol className="audit-list">
            {auditEvents.map((event) => (
              <li key={event.id}>
                <strong>{actionLabel[event.action] ?? event.action}</strong>
                <span>{formatInstantInTimeZone(event.occurredAt, timeZone)}{event.revision ? ` · revision ${event.revision}` : ''}</span>
              </li>
            ))}
            {!auditEvents.length && <li>기록을 불러오는 중이거나 아직 변경 이력이 없습니다.</li>}
          </ol>
        </Modal>
      )}
    </div>
  );
}
