import clsx from 'clsx';

interface CapacityBarProps {
  used: number;
  total: number;
  compact?: boolean;
  label?: string;
}

export function CapacityBar({ used, total, compact = false, label = '주간 시간' }: CapacityBarProps) {
  const ratio = total > 0 ? used / total : 0;
  const percentage = Math.min(100, Math.round(ratio * 100));
  const state = ratio > 1 ? 'over' : ratio >= 0.85 ? 'tight' : 'good';

  return (
    <div className={clsx('capacity', compact && 'capacity--compact')}>
      <div className="capacity__meta">
        <span>{label}</span>
        <strong>{used.toFixed(1)}h / {total.toFixed(1)}h</strong>
      </div>
      <div
        className="capacity__track"
        role="progressbar"
        aria-label={`${label} ${percentage}% 사용`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span className={`capacity__fill capacity__fill--${state}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
