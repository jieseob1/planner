import { useEffect, useState } from 'react';
import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { usePlanner } from '../state/PlannerProvider';
import { ConflictResolutionModal } from './ConflictResolutionModal';

const labels = {
  checking: { label: '서버 확인 중', detail: '기기 데이터를 먼저 불러왔어요' },
  saved: { label: '서버에 저장됨', detail: '저장 완료' },
  saving: { label: '서버에 저장 중', detail: '변경 내용은 기기에 저장됨' },
  offline: { label: '오프라인', detail: '변경 내용은 이 기기에 저장됨' },
  retry: { label: '서버 연결 실패', detail: '기기 데이터는 안전하게 보관 중' },
  conflict: { label: '서버 저장 충돌', detail: '기기 변경을 덮어쓰지 않고 보존했어요' },
  'storage-error': { label: '기기 저장 실패', detail: '브라우저 저장 공간을 확인해 주세요' }
} as const;

const formatSavedTime = (date: Date) => date.toLocaleTimeString('ko-KR', {
  hour: '2-digit',
  minute: '2-digit'
});

export function SaveStatus() {
  const { retrySync, saveStatus, syncConflict } = usePlanner();
  const [lastSavedAt, setLastSavedAt] = useState(() => new Date());
  const [conflictOpen, setConflictOpen] = useState(false);
  const Icon = saveStatus === 'offline'
    ? CloudOff
    : saveStatus === 'saved'
      ? Check
      : saveStatus === 'conflict' || saveStatus === 'storage-error'
        ? TriangleAlert
        : RefreshCw;
  const copy = labels[saveStatus];

  useEffect(() => {
    if (saveStatus === 'saved') setLastSavedAt(new Date());
  }, [saveStatus]);

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
