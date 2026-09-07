import { useEffect, useState } from 'react';
import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { usePlanner } from '../state/PlannerProvider';
import { ConflictResolutionModal } from './ConflictResolutionModal';
import { Modal } from './Modal';
import './save-validation.css';

const labels = {
  checking: { label: '서버 확인 중', detail: '기기 데이터를 먼저 불러왔어요' },
  saved: { label: '서버에 저장됨', detail: '저장 완료' },
  saving: { label: '서버에 저장 중', detail: '변경 내용은 기기에 저장됨' },
  offline: { label: '오프라인', detail: '변경 내용은 이 기기에 저장됨' },
  retry: { label: '서버 연결 실패', detail: '기기 데이터는 안전하게 보관 중' },
  'validation-error': { label: '서버 저장 거절 (400)', detail: '저장할 내용을 확인해 주세요' },
  conflict: { label: '서버 저장 충돌', detail: '기기 변경을 덮어쓰지 않고 보존했어요' },
  'storage-error': { label: '기기 저장 실패', detail: '브라우저 저장 공간을 확인해 주세요' }
} as const;

const formatSavedTime = (date: Date) => date.toLocaleTimeString('ko-KR', {
  hour: '2-digit',
  minute: '2-digit'
});

export function SaveStatus() {
  const { retrySync, saveStatus, saveProblem, syncConflict } = usePlanner();
  const [lastSavedAt, setLastSavedAt] = useState(() => new Date());
  const [conflictOpen, setConflictOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const Icon = saveStatus === 'offline'
    ? CloudOff
    : saveStatus === 'saved'
      ? Check
      : saveStatus === 'conflict' || saveStatus === 'storage-error' || saveStatus === 'validation-error'
        ? TriangleAlert
        : RefreshCw;
  const copy = labels[saveStatus];

  useEffect(() => {
    if (saveStatus === 'saved') setLastSavedAt(new Date());
    if (saveStatus !== 'validation-error') setValidationOpen(false);
  }, [saveStatus]);

  if (saveStatus === 'validation-error') {
    const firstError = saveProblem?.errors[0];
    const summary = firstError ? `${firstError.label}: ${firstError.message}` : saveProblem?.detail ?? copy.detail;
    const localCopy = saveProblem?.localStored === false
      ? '변경 내용은 현재 화면에 유지됩니다. 기기 저장에도 실패했으니 이 탭을 닫지 마세요.'
      : '변경 내용은 이 기기에 보관 중입니다. 초기화하지 말고 입력값을 수정해 주세요.';
    return <>
      <div className="save-validation-notice" role="status" aria-live="polite" aria-atomic="true">
        <TriangleAlert size={15} aria-hidden="true" />
        <div><strong>{copy.label}</strong><small>{summary}</small>
          <button className="text-button" type="button" onClick={() => setValidationOpen(true)}>오류 확인</button>
        </div>
      </div>
      {validationOpen && <Modal title="저장할 내용을 확인해 주세요" description={localCopy} onClose={() => setValidationOpen(false)} className="save-validation-modal">
        <p>{saveProblem?.detail ?? copy.detail}</p>
        {saveProblem?.errors.length ? <ul>{saveProblem.errors.map((error, index) => <li key={`${error.field}-${index}`}>
          <strong>{error.label}</strong><p>{error.message}</p><code>{error.field}</code>
        </li>)}</ul> : <p>문제가 계속되면 아래 오류 코드를 함께 알려 주세요.</p>}
        {saveProblem && saveProblem.additionalErrors > 0 && <p>추가로 확인할 항목이 {saveProblem.additionalErrors}개 있습니다.</p>}
        <p className="save-validation-code">HTTP 400{saveProblem?.code ? ` · ${saveProblem.code}` : ''}</p>
        <div className="save-validation-actions">
          <button className="button button--ghost" type="button" onClick={() => setValidationOpen(false)}>입력값 확인하기</button>
          <button className="primary-button" type="button" onClick={() => { setValidationOpen(false); retrySync(); }}>다시 저장</button>
        </div>
      </Modal>}
    </>;
  }

  return (
    <>
      <span
        className={clsx('save-status', `save-status--${saveStatus}`)}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Icon size={14} aria-hidden="true" />
        <span className="save-status__copy">
          <strong className="save-status__label">{copy.label}</strong>
          <span className="save-status__detail">
            {saveStatus === 'saved' ? `${formatSavedTime(lastSavedAt)} ${copy.detail}` : copy.detail}
          </span>
          {saveStatus === 'retry' ? (
            <button className="text-button save-status__retry" type="button" onClick={retrySync}>
              다시 시도
            </button>
          ) : null}
          {saveStatus === 'conflict' && syncConflict ? (
            <button className="text-button save-status__retry" type="button" onClick={() => setConflictOpen(true)}>
              변경 비교
            </button>
          ) : null}
        </span>
      </span>
      {conflictOpen && <ConflictResolutionModal onClose={() => setConflictOpen(false)} />}
    </>
  );
}
