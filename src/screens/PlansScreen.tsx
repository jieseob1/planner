import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Check, Clock3, History, Plus, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { planHistoryApi } from '../api/planHistoryApi';
import { Modal } from '../components/Modal';
import type { PlanAuditEvent, PlanStatus, PlanSummary, PlannerSnapshot } from '../domain/types';
import { usePlanner } from '../state/PlannerProvider';

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

export function PlansScreen() {
  const planner = usePlanner();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
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
    if (!title.trim() || !annualDirection.trim() || !quarterFocus.trim()) return;
    setBusyId('create');
    try {
      const nextSnapshot: PlannerSnapshot = structuredClone(snapshot);
      nextSnapshot.plan = {
        year,
        quarter: quarter as 1 | 2 | 3 | 4,
        annualDirection: annualDirection.trim(),
        quarterFocus: quarterFocus.trim(),
        quarterEndDate: quarterEnd(year, quarter)
      };
      nextSnapshot.plannerWeekOffset = 0;
      nextSnapshot.timer = null;
      nextSnapshot.review = {
        blocker: null,
        selectedTopTaskIds: [],
        metricDraft: '',
        completedAt: null
      };
      await planHistoryApi.create(crypto.randomUUID(), title.trim(), nextSnapshot);
      setCreateOpen(false);
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
        await planner.reloadFromServer();
        navigate('/today');
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
        <button className="button button--primary" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden="true" /> 새 계획
        </button>
      </header>

      {error && <div className="inline-alert" role="alert">{error}</div>}
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
                  <p>{plan.year}년 {plan.quarter}분기 · 최근 변경 {new Date(plan.updatedAt).toLocaleDateString('ko-KR')}</p>
                </div>
                {plan.status === 'ACTIVE' && <Check size={22} aria-label="활성 계획" />}
              </div>
              <div className="plan-card__meta">
                <span><Clock3 size={15} aria-hidden="true" /> revision {plan.sourceRevision ?? '—'}</span>
                <span>생성 {new Date(plan.createdAt).toLocaleDateString('ko-KR')}</span>
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
        <Modal title="새 연간·분기 계획" description="현재 계획의 구조를 복사하고 기간과 방향을 새로 정합니다." onClose={() => setCreateOpen(false)}>
          <div className="form-grid plan-create-form">
            <label className="field">계획 이름<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
            <div className="form-grid__columns">
              <label className="field">연도<input type="number" min="1900" max="9999" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
              <label className="field">분기<select value={quarter} onChange={(event) => setQuarter(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}분기</option>)}</select></label>
            </div>
            <label className="field">1년 방향<textarea value={annualDirection} maxLength={2000} onChange={(event) => setAnnualDirection(event.target.value)} /></label>
            <label className="field">이번 분기 핵심 결과<textarea value={quarterFocus} maxLength={2000} onChange={(event) => setQuarterFocus(event.target.value)} autoFocus data-autofocus /></label>
          </div>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setCreateOpen(false)}>취소</button>
            <button className="button button--primary" type="button" disabled={busyId === 'create' || !title.trim() || !quarterFocus.trim()} onClick={() => void createPlan()}>초안 만들기</button>
          </div>
        </Modal>
      )}

      {auditPlan && (
        <Modal title={`${auditPlan.title} 변경 이력`} description="서버에 기록된 주요 상태 변경과 저장 revision입니다." onClose={() => setAuditPlan(null)}>
          <ol className="audit-list">
            {auditEvents.map((event) => (
              <li key={event.id}>
                <strong>{actionLabel[event.action] ?? event.action}</strong>
                <span>{new Date(event.occurredAt).toLocaleString('ko-KR')}{event.revision ? ` · revision ${event.revision}` : ''}</span>
              </li>
            ))}
            {!auditEvents.length && <li>기록을 불러오는 중이거나 아직 변경 이력이 없습니다.</li>}
          </ol>
        </Modal>
      )}
    </div>
  );
}
