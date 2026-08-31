import { useEffect, useState } from 'react';
import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { usePlanner } from '../state/PlannerProvider';

const labels = {
  saved: { label: '기기에 저장됨', detail: '로컬 저장' },
  saving: { label: '기기에 저장 중', detail: '변경 내용 저장 중' },
  offline: { label: '오프라인', detail: '이 기기에만 저장됨' },
  retry: { label: '기기 저장 실패', detail: '로컬 저장 확인 필요' }
} as const;

const formatSavedTime = (date: Date) => date.toLocaleTimeString('ko-KR', {
  hour: '2-digit',
  minute: '2-digit'
});

export function SaveStatus() {
  const { saveStatus } = usePlanner();
  const [lastSavedAt, setLastSavedAt] = useState(() => new Date());
  const Icon = saveStatus === 'offline'
    ? CloudOff
    : saveStatus === 'saved'
      ? Check
      : saveStatus === 'retry'
        ? TriangleAlert
        : RefreshCw;
  const copy = labels[saveStatus];

  useEffect(() => {
    if (saveStatus === 'saved') setLastSavedAt(new Date());
  }, [saveStatus]);

  return (
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
      </span>
    </span>
  );
}
