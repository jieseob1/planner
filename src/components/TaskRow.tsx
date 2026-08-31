import { AlertTriangle, Circle, CircleCheck, Clock3, GripVertical, Play } from 'lucide-react';
import clsx from 'clsx';
import type { DragEvent } from 'react';
import type { Task } from '../domain/types';
import { formatMinutes } from '../lib/format';

interface TaskRowProps {
  task: Task;
  outcomeTitle?: string;
  onStart?: () => void;
  onSelect?: () => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  compact?: boolean;
}

export function TaskRow({
  task,
  outcomeTitle,
  onStart,
  onSelect,
  draggable = false,
  onDragStart,
  compact = false
}: TaskRowProps) {
  const done = task.status === 'done';
  const running = task.status === 'in-progress';
  const cancelled = task.status === 'cancelled';
  const hasCarryover = task.carryCount > 0;
  const statusLabel = done ? '완료' : running ? '기록 중' : cancelled ? '중단됨' : '미완료';

  return (
    <div
      className={clsx(
        'task-row',
        compact && 'task-row--compact',
        done && 'task-row--done',
        running && 'task-row--running',
        cancelled && 'task-row--cancelled',
        hasCarryover && 'task-row--warning',
        onSelect && 'task-row--selectable'
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={onSelect ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      } : undefined}
    >
      {draggable && <GripVertical className="task-row__grip" size={17} aria-hidden="true" />}
      <span className="task-row__status" aria-hidden="true">
        {done ? <CircleCheck size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
      </span>
      <div className="task-row__body">
        <span className="sr-only">상태: {statusLabel}</span>
        <div className="task-row__title-line">
          <strong>{task.title}</strong>
          {running && (
            <span className="task-row__running" aria-hidden="true">
              <span aria-hidden="true">●</span> 기록 중
            </span>
          )}
        </div>
        <div className="task-row__meta">
          {outcomeTitle && <span className="task-row__outcome">{outcomeTitle}</span>}
          <span className="task-row__duration">
            <Clock3 size={13} aria-hidden="true" />
            {formatMinutes(task.estimateMinutes)}
          </span>
          {hasCarryover && (
            <span className="task-row__warning">
              <AlertTriangle size={13} aria-hidden="true" />
              {task.carryCount}회 이월
            </span>
          )}
          {cancelled && <span className="task-row__cancelled" aria-hidden="true">중단됨</span>}
        </div>
      </div>
      {onStart && !done && (
        <button
          className="button button--quiet button--small task-row__start"
          type="button"
          aria-label={`${task.title} ${running ? '계속' : '시작'}`}
          onClick={(event) => {
            event.stopPropagation();
            onStart();
          }}
        >
          <Play size={14} fill="currentColor" aria-hidden="true" />
          {running ? '계속' : '시작'}
        </button>
      )}
    </div>
  );
}
