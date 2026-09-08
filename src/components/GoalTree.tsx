import { useId, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Circle, Plus } from 'lucide-react';
import { goalProgress, periodLabels, type PeriodDocument, type PeriodGoal, rangeLabel } from '../domain/periods';
import './GoalTree.css';

/** Explicit child links only: no implicit progress aggregation or period inference. */
export function descendantGoalIds(goals: readonly PeriodGoal[], parentId: string) {
  const children = new Map<string, string[]>();
  for (const goal of goals) {
    if (goal.parentId) children.set(goal.parentId, [...(children.get(goal.parentId) ?? []), goal.id]);
  }
  const visited = new Set<string>([parentId]);
  const queue = [parentId];
  for (let index = 0; index < queue.length; index++) {
    for (const id of children.get(queue[index]) ?? []) {
      if (!visited.has(id)) { visited.add(id); queue.push(id); }
    }
  }
  visited.delete(parentId);
  return visited;
}

interface GoalTreeProps {
  documents: PeriodDocument[];
  selectedIds: string[];
  onEdit: (document: PeriodDocument) => void;
  onAddChild: (parent: PeriodGoal) => void;
}

export function GoalTree({ documents, selectedIds, onEdit, onAddChild }: GoalTreeProps) {
  const instanceId = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { byId, children, roots, selected } = useMemo(() => {
    const active = documents.filter(d => d.goal && !d.deleted);
    const byId = new Map(active.map(d => [d.goal!.id, d]));
    const selected = new Set(selectedIds);
    const included = new Set(selectedIds.filter(id => byId.has(id)));
    const goals = active.map(d => d.goal!);
    for (const id of selectedIds) {
      for (const descendant of descendantGoalIds(goals, id)) included.add(descendant);
      const ancestors = new Set<string>([id]);
      let parent = byId.get(id)?.goal?.parentId;
      while (parent && byId.has(parent) && !ancestors.has(parent)) {
        included.add(parent); ancestors.add(parent); parent = byId.get(parent)?.goal?.parentId;
      }
    }
    const children = new Map<string, string[]>();
    const roots: string[] = [];
    // Preserve source ordering. Break malformed cycles defensively so no saved goal disappears.
    const attached = new Map<string, string>();
    for (const id of included) {
      const parent = byId.get(id)?.goal?.parentId;
      let cursor = parent;
      const visited = new Set<string>([id]);
      while (cursor && !visited.has(cursor)) { visited.add(cursor); cursor = attached.get(cursor); }
      if (parent && included.has(parent) && !cursor) {
        attached.set(id, parent); children.set(parent, [...(children.get(parent) ?? []), id]);
      } else roots.push(id);
    }
    return { byId, children, roots, selected };
  }, [documents, selectedIds]);

  const renderGoal = (id: string, depth: number) => {
    const document = byId.get(id);
    if (!document?.goal) return null;
    const goal = document.goal;
    const childIds = children.get(id) ?? [];
    const expanded = !collapsed.has(id);
    const groupId = `${instanceId}-${id}-children`;
    const progress = goalProgress(goal);
    return <li key={id} className="goal-tree-node">
      <div className={`goal-tree-card${selected.has(id) ? '' : ' goal-tree-card--context'}`} style={{ paddingInlineStart: `${Math.min(depth, 4) * 14 + 10}px` }}>
        {childIds.length > 0 ? <button type="button" className="goal-tree-toggle" aria-label={`${goal.title} 하위 목표 ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} aria-controls={groupId} onClick={() => setCollapsed(current => {
          const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
        })}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button> : <span className="goal-tree-toggle goal-tree-toggle--empty" aria-hidden="true" />}
        <button type="button" className="goal-tree-edit" onClick={() => onEdit(document)} aria-label={`${goal.title} 목표 수정`}>
          {progress === 100 ? <CheckCircle2 className="is-complete" size={21} /> : <Circle size={21} />}
          <span className="goal-tree-copy"><strong>{goal.title}</strong><small>{periodLabels[goal.period]} 목표 · {rangeLabel(goal)}</small>{childIds.length > 0 && <small>하위 목표 {childIds.length}개 · 각각 따로 측정</small>}</span>
          <span className="period-progress goal-tree-progress"><strong>{goal.measurement === 'completion' ? goal.done ? '완료' : '진행 중' : `${goal.current ?? '미측정'} / ${goal.target} ${goal.unit}`}<span>{progress === null ? '미측정' : `${progress}%`}</span></strong><progress max={100} value={progress ?? 0} aria-label={`${goal.title} 목표 달성률`} /></span>
          <ArrowRight className="goal-tree-open" size={16} aria-hidden="true" />
        </button>
        <button type="button" className="goal-tree-add" onClick={() => { setCollapsed(current => { const next = new Set(current); next.delete(id); return next; }); onAddChild(goal); }} aria-label={`${goal.title} 하위 목표 추가`}><Plus size={16} /><span>하위 목표</span></button>
      </div>
      {childIds.length > 0 && <ul id={groupId} hidden={!expanded} className="goal-tree-list" aria-label={`${goal.title} 하위 목표`}>{childIds.map(child => renderGoal(child, depth + 1))}</ul>}
    </li>;
  };

  return <ul className="goal-tree-list goal-tree-root" aria-label="목표 연결 구조">{roots.map(id => renderGoal(id, 0))}</ul>;
}
