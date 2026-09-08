import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArrowRight, Plus, Target } from 'lucide-react';
import { Modal } from '../components/Modal';
import { PeriodSelector } from '../components/PeriodSelector';
import { PeriodFeedback } from '../components/PeriodFeedback';
import { PeriodDraftStatus } from '../components/PeriodDraftStatus';
import { descendantGoalIds, GoalTree } from '../components/GoalTree';
import { usePeriods } from '../state/PeriodProvider';
import { usePlanner } from '../state/PlannerProvider';
import { usePeriodDraft } from '../state/usePeriodDraft';
import { usePeriodRange } from '../state/usePeriodRange';
import { createIdempotencyKey } from '../api/plannerApi';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { isLocalDate, toLocalDate } from '../lib/calendarDate';
import { goalProgress, periodRange, periodLabels, periods as periodTypes, rangeLabel, type Period, type PeriodDocument, type PeriodGoal, type PeriodRange } from '../domain/periods';

export function GoalProgress({ goal }: { goal: PeriodGoal }) {
  const progress = goalProgress(goal);
  return <div className="period-progress">
    <strong>{goal.measurement === 'completion' ? goal.done ? '완료' : '진행 중' : `${goal.current ?? '미측정'} / ${goal.target} ${goal.unit}`}<span>{progress === null ? '미측정' : `${progress}%`}</span></strong>
    <progress max={100} value={progress ?? 0} aria-label={`${goal.title} 목표 달성률`} />
  </div>;
}
function GoalEditor({ document, range, parent, onClose }: { document?: PeriodDocument; range: PeriodRange; parent?: PeriodGoal; onClose: () => void }) {
  const periods = usePeriods();
  const planner = usePlanner();
  const initial: PeriodGoal = document?.goal ?? { ...range, id: `goal-${createIdempotencyKey()}`, title: '', parentId: parent?.id ?? null, measurement: 'completion', baseline: 0, current: 0, target: 1, unit: '', done: false, note: '', taskIds: [] };
  const draft = usePeriodDraft(document?.goal?.id ?? (parent ? `new-goal-child-${parent.id}` : 'new-goal'), initial, document?.revision ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const value = draft.value;
  const activeGoals = periods?.documents.filter(d => !d.deleted && d.goal).map(d => d.goal!) ?? [];
  const descendants = descendantGoalIds(activeGoals, value.id);
  const submit = (event: FormEvent) => { event.preventDefault(); if (value.title.trim()) void draft.save().then(saved => { if (saved) onClose(); }); };
  const linkTask = (id: string, checked: boolean) => draft.edit({ ...value, taskIds: checked ? [...new Set([...value.taskIds, id])] : value.taskIds.filter(t => t !== id) });
  const addTodo = () => {
    const existing = planner.tasks.find(t => t.title === value.title.trim() && t.status !== 'cancelled');
    const id = existing?.id ?? planner.addTask({ title: value.title, outcomeId: null, estimateMinutes: 25 });
    if (!id) return;
    linkTask(id, true); setNotice(existing ? '같은 이름의 기존 할 일을 연결했습니다.' : '시간 미정 할 일을 만들었습니다. 할 일의 서버 저장이 끝나면 목표를 저장해 주세요.');
  };
  const waitingForTask = value.taskIds.some(id => !document?.goal?.taskIds.includes(id)) && planner.saveStatus !== 'saved';
  return <Modal title={document ? '목표 수정' : parent ? '하위 목표 추가' : '목표 추가'} description={parent ? `${parent.title}을 작은 결과로 나눠보세요. 각 목표의 달성률은 독립적으로 관리합니다.` : '제목과 기간으로 시작하세요. 상위 목표나 할 일 연결은 선택입니다.'} onClose={() => { if (!draft.busy) onClose(); }}>
    <form className="period-goal-editor form-grid" onSubmit={submit}>
      <fieldset disabled={draft.busy || draft.conflict}>
        <label className="field"><span>목표 이름</span><input data-autofocus required maxLength={500} value={value.title} onChange={e => draft.edit({ ...value, title: e.target.value })} placeholder="이번 기간에 이루고 싶은 결과" /></label>
        <div className="form-grid form-grid--two">
          <label className="field"><span>기간</span><select value={value.period} onChange={e => draft.edit({ ...value, ...periodRange(e.target.value as Period, value.startDate) })}>{periodTypes.map(p => <option key={p} value={p}>{periodLabels[p]}</option>)}</select></label>
          <label className="field"><span>기준 날짜</span><input type="date" min="1900-01-07" max="9998-12-25" required value={value.startDate} onChange={e => { if (isLocalDate(e.target.value)) draft.edit({ ...value, ...periodRange(value.period, e.target.value) }); }} /></label>
        </div>
        <p className="period-hint">{rangeLabel(value)}</p>
        <label className="field"><span>측정 방법</span><select value={value.measurement} onChange={e => draft.edit({ ...value, measurement: e.target.value as PeriodGoal['measurement'] })}><option value="completion">완료 여부</option><option value="number">수치로 측정</option></select></label>
        {value.measurement === 'completion' ? <label className="period-check"><input type="checkbox" checked={value.done} onChange={e => draft.edit({ ...value, done: e.target.checked })} /> 목표를 달성했어요</label> : <>
          <div className="period-numbers">{(['baseline', 'current', 'target'] as const).map((key, index) => <label key={key} className="field"><span>{['기준값', '현재값 (선택)', '목표값'][index]}</span><input type="number" step="any" min={-1e9} max={1e9} required={key !== 'current'} value={value[key] ?? ''} onChange={e => draft.edit({ ...value, [key]: e.target.value === '' && key === 'current' ? null : Number(e.target.value) })} /></label>)}</div>
          <label className="field"><span>단위</span><input maxLength={40} value={value.unit} onChange={e => draft.edit({ ...value, unit: e.target.value })} placeholder="편, 회, kg…" /></label>
          <p className="period-hint">기준값에서 목표값까지의 변화로 계산합니다. 감소 목표도 설정할 수 있어요.</p>
        </>}
        <details open={Boolean(document || parent)}><summary>상위 목표 · 할 일 연결 · 메모</summary>
          <label className="field"><span>상위 목표 (선택)</span><select aria-label="상위 목표 (선택)" value={value.parentId ?? ''} onChange={e => draft.edit({ ...value, parentId: e.target.value || null })}><option value="">연결하지 않음</option>{activeGoals.filter(goal => goal.id !== value.id && !descendants.has(goal.id)).map(goal => <option key={goal.id} value={goal.id}>{goal.title} · {periodLabels[goal.period]}</option>)}</select></label>
          <label className="field"><span>메모</span><textarea maxLength={4000} value={value.note} onChange={e => draft.edit({ ...value, note: e.target.value })} /></label>
          <div className="period-task-links"><strong>할 일 연결 (선택)</strong><p className="period-hint">할 일을 완료해도 목표 수치는 자동으로 바뀌지 않아요.</p>
            {planner.tasks.map(task => <label key={task.id} className="period-check"><input type="checkbox" checked={value.taskIds.includes(task.id)} onChange={e => linkTask(task.id, e.target.checked)} />{task.title}</label>)}
            {value.taskIds.filter(id => !planner.tasks.some(t => t.id === id)).map(id => <label key={id} className="period-check"><input type="checkbox" checked onChange={() => linkTask(id, false)} />과거 계획의 할 일 연결 (해제 가능)</label>)}
            <button type="button" className="button button--secondary" disabled={!value.title.trim() || !planner.hasActivePlan} onClick={addTodo}><Plus size={16} /> 이 목표로 할 일 만들기</button>
            {notice && <p role="status">{notice}</p>}
          </div>
        </details>
      </fieldset>
      <PeriodDraftStatus draft={draft} />
      {waitingForTask && <p role="status">연결할 할 일의 서버 저장을 기다리는 중입니다. 기존 저장 오류를 먼저 해결해 주세요.</p>}
      <div className="period-editor-actions">
        {document && <button className="button button--secondary" type="button" disabled={draft.busy} onClick={() => setConfirmDelete(true)}>목표 삭제</button>}
        <button className="button button--primary" disabled={!draft.ready || draft.busy || draft.conflict || waitingForTask || !value.title.trim()} type="submit">{draft.busy ? '저장 중…' : '목표 저장'}</button>
      </div>
      {confirmDelete && <div className="period-conflict" role="alert"><p>목표를 삭제할까요? 할 일과 일정은 그대로 유지됩니다. 하위 목표가 있다면 연결을 먼저 해제해 주세요.</p><button type="button" className="button button--secondary" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" className="button button--primary" disabled={draft.busy || draft.conflict} onClick={() => void draft.save(true).then(saved => { if (saved) onClose(); })}>삭제 확인</button></div>}
    </form>
  </Modal>;
}
export function PeriodGoalsScreen() {
  const { timeZone } = useTimeZone();
  const today = toLocalDate(new Date(), timeZone);
  const [range, setRange] = usePeriodRange(periodRange('week', today));
  const periods = usePeriods();
  const [editor, setEditor] = useState<PeriodDocument | 'new' | null>(null);
  const [childParent, setChildParent] = useState<PeriodGoal | null>(null);
  const listed = periods?.documents.filter(d => !d.deleted && d.goal?.period === range.period && d.goal.startDate === range.startDate) ?? [];
  const childPeriod: Record<Period, Period> = { year: 'quarter', quarter: 'month', month: 'week', week: 'day', day: 'day' };
  const editorRange = childParent ? periodRange(childPeriod[childParent.period], today >= childParent.startDate && today <= childParent.endDate ? today : childParent.startDate) : range;
  return <div className="page period-page">
    <header className="page-header"><div><p className="eyebrow">GOALS</p><h1>기간별 목표</h1><p>어느 기간에서든 시작하세요. 목표 연결은 선택이에요.</p></div><Link className="button button--secondary" to="/plans"><Archive size={16} /> 계획 보관함</Link></header>
    <PeriodFeedback />
    <div className="period-toolbar"><PeriodSelector value={range} today={today} onChange={setRange} /><button type="button" className="button button--primary" disabled={!periods?.ready} onClick={() => setEditor('new')}><Plus size={16} /> 목표 추가</button></div>
    <div className="period-section-title"><h2>이 기간의 목표 <small>{listed.length}</small></h2><Link to={`/review?period=${range.period}&date=${range.startDate}`}>돌아보기 <ArrowRight size={15} /></Link></div>
    {listed.length > 0 && <p className="goal-tree-note">연결한 상위·하위 목표도 함께 보여드려요. 하위 목표의 완료가 상위 목표의 달성률을 자동으로 바꾸지는 않습니다.</p>}
    <div className="period-goal-list">
      <GoalTree documents={periods?.documents ?? []} selectedIds={listed.map(d => d.goal!.id)} onEdit={document => { setChildParent(null); setEditor(document); }} onAddChild={parent => { setChildParent(parent); setEditor('new'); }} />
      {!listed.length && periods?.ready && <div className="period-empty"><Target size={30} /><h2>작은 목표 하나부터 시작해요</h2><p>목표 없이도 오늘의 할 일과 시간표를 사용할 수 있어요.</p><button className="button button--primary" type="button" onClick={() => setEditor('new')}>첫 목표 추가</button></div>}
    </div>
    <details className="period-legacy"><summary>기존 분기 결과와 지표</summary><p>기존 수치 이력과 Todo 연결은 그대로 보존되어 있습니다. 연간 방향 문장을 임의로 새 목표로 바꾸지 않았습니다.</p><Link to="/goals/legacy">기존 분기 결과 관리 열기</Link></details>
    {editor && <GoalEditor key={editor === 'new' ? childParent?.id ?? 'new' : editor.goal!.id} document={editor === 'new' ? undefined : editor} range={editorRange} parent={childParent ?? undefined} onClose={() => { setEditor(null); setChildParent(null); }} />}
  </div>;
}
