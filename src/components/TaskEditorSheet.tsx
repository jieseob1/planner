import { useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import type { Outcome, Task, UpdateTaskInput } from '../domain/types';

interface TaskEditorSheetProps {
  task: Task;
  outcomes: Outcome[];
  blockCount: number;
  entryCount: number;
  onSave: (input: UpdateTaskInput) => boolean;
  onDelete: () => boolean;
  onClose: () => void;
}

export function TaskEditorSheet({ task, outcomes, blockCount, entryCount, onSave, onDelete, onClose }: TaskEditorSheetProps) {
  const [title, setTitle] = useState(task.title);
  const [outcomeId, setOutcomeId] = useState(task.outcomeId ?? '');
  const [estimate, setEstimate] = useState(String(task.estimateMinutes));
  const [status, setStatus] = useState(task.status);
  const [note, setNote] = useState(task.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current) return;
    if (!onSave({ title, outcomeId: outcomeId || null, estimateMinutes: Number(estimate), status, note })) {
      setError('저장하지 못했습니다. 입력 내용과 동기화 상태를 확인해 주세요.');
      return;
    }
    onClose();
  };

  return (
    <Modal title={confirmDelete ? '할 일을 삭제할까요?' : '할 일 수정'} onClose={onClose}
      description={confirmDelete ? '삭제할 범위를 확인해 주세요.' : '목표 없이도 사용할 수 있습니다. 제목 변경은 연결된 시간표에도 반영됩니다.'}>
      {confirmDelete ? (
        <div className="task-editor-delete">
          <p><strong>{task.title}</strong></p>
          <p>이 할 일과 연결된 일정 {blockCount}개, 실행 기록 {entryCount}개가 함께 삭제됩니다. 실행 중인 타이머도 종료되며, 되돌릴 수 없습니다.</p>
          <p>일정만 지우려면 시간표에서 <strong>시간표에서 빼기</strong>를 사용하세요.</p>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => { setConfirmDelete(false); setError(''); }}>수정으로 돌아가기</button>
            <button className="button button--delete" type="button" onClick={() => {
              if (onDelete()) onClose();
              else setError('삭제하지 못했습니다. 동기화 상태를 확인해 주세요.');
            }}>할 일과 연결 기록 삭제</button>
          </div>
        </div>
      ) : (
        <form className="task-editor-form" onSubmit={submit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
          <label className="field"><span className="field-label">할 일 제목</span><input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} required /></label>
          <label className="field"><span className="field-label">목표 연결 <small>선택</small></span><select aria-label="목표 연결" value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
            <option value="">목표 없이 사용</option>{outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
          </select></label>
          <div className="task-editor-form__row">
            <label className="field"><span className="field-label">예상 시간 (분)</span><input type="number" min={1} max={10080} step={1} value={estimate} onChange={(event) => setEstimate(event.target.value)} required /></label>
            <label className="field"><span className="field-label">상태</span><select aria-label="상태" value={status} onChange={(event) => setStatus(event.target.value as Task['status'])}>
              <option value="todo">할 일</option><option value="in-progress">진행 중</option><option value="done">완료</option><option value="cancelled">취소</option>
            </select></label>
          </div>
          <p className="field-help">예상 시간을 바꿔도 이미 배치한 일정의 길이는 바뀌지 않습니다. 완료·취소한 할 일도 다시 열 수 있습니다.</p>
          <label className="field"><span className="field-label">메모</span><textarea aria-label="메모" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="modal__actions task-editor-actions">
            <button className="button button--delete" type="button" onClick={() => { setConfirmDelete(true); setError(''); }}>할 일 삭제</button>
            <button className="button button--secondary" type="button" onClick={onClose}>취소</button>
            <button className="button button--primary" type="submit" disabled={!title.trim()}>변경 저장</button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
