import { useLocale, tr } from '../i18n';
import { useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import type { Outcome, Task, UpdateTaskInput } from '../domain/types';
import { SubtaskEditor } from './SubtaskEditor';
import { validSubtasks } from '../domain/subtasks';
import { sameSyncValue } from '../state/mergeSnapshots';

interface TaskEditorSheetProps {
  task: Task;
  outcomes: Outcome[];
  blockCount: number;
  entryCount: number;
  onSave: (input: UpdateTaskInput) => boolean;
  onDelete: () => boolean;
  onClose: () => void;
  contextual?: boolean;
  onSchedule?: () => void;
  onChangeDate?: () => void;
}

export function TaskEditorSheet({ task, outcomes, blockCount, entryCount, onSave, onDelete, onClose, contextual, onSchedule, onChangeDate }: TaskEditorSheetProps) {
  useLocale();
  const original = useRef(task);
  const [title, setTitle] = useState(task.title);
  const [outcomeId, setOutcomeId] = useState(task.outcomeId ?? '');
  const [estimate, setEstimate] = useState(String(task.estimateMinutes));
  const [status, setStatus] = useState(task.status);
  const [note, setNote] = useState(task.note ?? '');
  const [subtasks, setSubtasks] = useState(task.subtasks ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current) return;
    const draft: UpdateTaskInput = { title, outcomeId: outcomeId || null, estimateMinutes: Number(estimate), status, note, subtasks };
    const patch: UpdateTaskInput = {};
    for (const key of Object.keys(draft) as (keyof UpdateTaskInput)[]) {
      const before = key === 'note' ? original.current.note ?? '' : key === 'subtasks' ? original.current.subtasks ?? [] : original.current[key];
      if (sameSyncValue(draft[key], before)) continue;
      const latest = key === 'note' ? task.note ?? '' : key === 'subtasks' ? task.subtasks ?? [] : task[key];
      if (!sameSyncValue(latest, before) && !sameSyncValue(latest, draft[key])) {
        setError(tr("다른 기기에서 같은 항목을 수정했습니다. 입력은 보존됐습니다. 취소하고 최신 내용을 확인한 뒤 다시 수정해 주세요."));
        return;
      }
      Object.assign(patch, { [key]: draft[key] });
    }
    if (!validSubtasks(subtasks) || !onSave(patch)) {
      setError(tr("저장하지 못했습니다. 입력 내용과 동기화 상태를 확인해 주세요."));
      return;
    }
    onClose();
  };

  return (
    <Modal title={confirmDelete ? tr("할 일을 삭제할까요?") : tr("할 일 수정")} onClose={onClose} className={contextual ? 'task-context-panel' : ''}
      description={confirmDelete ? tr("삭제할 범위를 확인해 주세요.") : tr("목표 없이도 사용할 수 있습니다. 제목 변경은 연결된 시간표에도 반영됩니다.")}>
      {confirmDelete ? (
        <div className="task-editor-delete">
          <p><strong>{task.title}</strong></p>
          <p>{tr("이 할 일과 연결된 일정")}{' '}{blockCount}{tr("개, 실행 기록")}{' '}{entryCount}{tr("개가 함께 삭제됩니다. 실행 중인 타이머도 종료되며, 되돌릴 수 없습니다.")}</p>
          <p>{tr("하위 할 일")}{' '}{task.subtasks?.length ?? 0}{tr("개도 함께 삭제됩니다.")}</p>
          <p>{tr("일정만 지우려면 시간표에서")}{' '}<strong>{tr("시간표에서 빼기")}</strong>{tr("를 사용하세요.")}</p>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => { setConfirmDelete(false); setError(''); }}>{tr("수정으로 돌아가기")}</button>
            <button className="button button--delete" type="button" onClick={() => {
              if (onDelete()) onClose();
              else setError(tr("삭제하지 못했습니다. 동기화 상태를 확인해 주세요."));
            }}>{tr("할 일과 연결 기록 삭제")}</button>
          </div>
        </div>
      ) : (
        <form className="task-editor-form" onSubmit={submit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
          {(onSchedule || onChangeDate) && <div className="task-detail-shortcuts">
            {onSchedule && <button className="button button--secondary" type="button" onClick={onSchedule}>{tr("시간 지정")}</button>}
            {onChangeDate && <button className="button button--secondary" type="button" onClick={onChangeDate}>{tr("날짜 변경")}</button>}
          </div>}
          <label className="field"><span className="field-label">{tr("할 일 제목")}</span><input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} required /></label>
          <SubtaskEditor value={subtasks} onChange={setSubtasks} />
          <label className="field"><span className="field-label">{tr("목표 연결")}{' '}<small>{tr("선택")}</small></span><select aria-label={tr("목표 연결")} value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
            <option value="">{tr("목표 없이 사용")}</option>{outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
          </select></label>
          <div className="task-editor-form__row">
            <label className="field"><span className="field-label">{tr("예상 시간 (분)")}</span><input type="number" min={1} max={10080} step={1} value={estimate} onChange={(event) => setEstimate(event.target.value)} required /></label>
            <label className="field"><span className="field-label">{tr("상태")}</span><select aria-label={tr("상태")} value={status} onChange={(event) => setStatus(event.target.value as Task['status'])}>
              <option value="todo">{tr("할 일")}</option><option value="in-progress">{tr("진행 중")}</option><option value="done">{tr("완료")}</option><option value="cancelled">{tr("취소")}</option>
            </select></label>
          </div>
          <p className="field-help">{tr("예상 시간을 바꿔도 이미 배치한 일정의 길이는 바뀌지 않습니다. 완료·취소한 할 일도 다시 열 수 있습니다.")}</p>
          <label className="field"><span className="field-label">{tr("메모")}</span><textarea aria-label={tr("메모")} rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="modal__actions task-editor-actions">
            <button className="button button--delete" type="button" onClick={() => { setConfirmDelete(true); setError(''); }}>{tr("할 일 삭제")}</button>
            <button className="button button--secondary" type="button" onClick={onClose}>{tr("취소")}</button>
            <button className="button button--primary" type="submit" disabled={!title.trim() || !validSubtasks(subtasks)}>{tr("변경 저장")}</button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
