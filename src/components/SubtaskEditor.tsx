import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2, Undo2 } from 'lucide-react';
import type { Subtask } from '../domain/types';
import { MAX_SUBTASKS } from '../domain/subtasks';
import '../styles/subtasks.css';

export function SubtaskProgress({ items = [] }: { items?: readonly Subtask[] }) {
  return items.length ? <span className="subtask-progress"><ListChecks size={13} aria-hidden="true" />하위 {items.filter(item => item.done).length}/{items.length} 완료</span> : null;
}

export function SubtaskEditor({ value, onChange }: { value: Subtask[]; onChange: (items: Subtask[]) => void }) {
  const [removed, setRemoved] = useState<{ item: Subtask; index: number } | null>(null);
  const focusId = useRef<string | null>(null);
  const add = () => {
    if (value.length >= MAX_SUBTASKS) return;
    const id = `subtask-${crypto.randomUUID()}`;
    focusId.current = id;
    onChange([...value, { id, title: '', done: false }]);
  };
  const move = (index: number, offset: number) => {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return <section className="subtask-editor" aria-label="하위 할 일">
    <div className="subtask-editor__heading"><strong>하위 할 일</strong><SubtaskProgress items={value} /></div>
    <p className="subtask-editor__hint">작은 단계로 나누어 체크하세요. 상위 할 일의 완료·시간 기록과는 별개입니다. 변경 후 저장을 눌러주세요.</p>
    <ol className="subtask-editor__list">
      {value.map((item, index) => <li key={item.id} className={item.done ? 'is-done' : ''}>
        <label className="subtask-editor__check"><input type="checkbox" checked={item.done} aria-label={`${item.title || `하위 할 일 ${index + 1}`} 완료`} onChange={event => onChange(value.map(candidate => candidate.id === item.id ? { ...candidate, done: event.target.checked } : candidate))} /></label>
        <input className="subtask-editor__title" aria-label={`하위 할 일 ${index + 1} 제목`} value={item.title} placeholder="하위 할 일 입력" maxLength={500} required
          ref={element => { if (element && focusId.current === item.id) { focusId.current = null; element.focus(); } }}
          onChange={event => onChange(value.map(candidate => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate))}
          onKeyDown={event => { if (event.key !== 'Enter') return; event.preventDefault(); if (!event.nativeEvent.isComposing && item.title.trim() && index === value.length - 1) add(); }} />
        <div className="subtask-editor__tools">
          <button type="button" aria-label={`하위 할 일 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={`하위 할 일 ${index + 1} 아래로`} disabled={index === value.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" aria-label={`하위 할 일 ${index + 1} 삭제`} onClick={() => { setRemoved({ item, index }); onChange(value.filter(candidate => candidate.id !== item.id)); }}><Trash2 size={16} /></button>
        </div>
      </li>)}
    </ol>
    <div className="subtask-editor__footer">
      <button className="button button--secondary button--small" type="button" disabled={value.length >= MAX_SUBTASKS} onClick={add}><Plus size={16} />하위 할 일 추가</button>
      {removed && <button className="button button--quiet button--small" type="button" disabled={value.length >= MAX_SUBTASKS} onClick={() => { const next = [...value]; next.splice(Math.min(removed.index, next.length), 0, removed.item); onChange(next); setRemoved(null); }}><Undo2 size={16} />마지막 삭제 취소</button>}
      {value.length >= MAX_SUBTASKS && <small>최대 {MAX_SUBTASKS}개까지 추가할 수 있어요.</small>}
    </div>
  </section>;
}
