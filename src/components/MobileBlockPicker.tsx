import { useEffect, useMemo, useRef } from 'react';
import { Calendar, CircleCheck, Clock3, LockKeyhole, X } from 'lucide-react';
import type { TimeBlock } from '../domain/types';
import { rangeFromBlock } from '../lib/dayTimeline';
import { formatClock } from '../lib/format';

interface MobileBlockPickerProps {
  blocks: TimeBlock[];
  onClose: () => void;
  onSelect: (blockId: string) => void;
}

const describeRange = (block: TimeBlock) => (
  `${formatClock(block.startMinutes)}–${formatClock(block.startMinutes + block.durationMinutes)}`
);

export default function MobileBlockPicker({ blocks, onClose, onSelect }: MobileBlockPickerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const orderedBlocks = useMemo(() => [...blocks].sort((left, right) => (
    left.startMinutes - right.startMinutes || left.id.localeCompare(right.id)
  )), [blocks]);
  const groupStart = Math.min(...orderedBlocks.map((block) => rangeFromBlock(block).startMinutes));
  const groupEnd = Math.max(...orderedBlocks.map((block) => rangeFromBlock(block).endMinutes));

  useEffect(() => {
    const panel = panelRef.current;
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!panel) return undefined;
    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => (
      panel.querySelector<HTMLElement>('[data-picker-option]') ?? getFocusable()[0] ?? panel
    ).focus());
    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keepFocusInside);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keepFocusInside);
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, []);

  return (
    <div className="today-direct-block-panel-layer">
      <button className="today-direct-block-panel__backdrop" type="button" aria-label="일정 선택 닫기" onClick={onClose} />
      <section ref={panelRef} className="today-direct-block-panel today-direct-block-picker" role="dialog" aria-label="이 시간의 일정 선택" aria-modal="true" tabIndex={-1}>
        <header>
          <div>
            <span className="today-direct-kicker">겹치거나 가까운 일정</span>
            <h3>조작할 일정을 선택하세요</h3>
            <p><Clock3 size={14} aria-hidden="true" /> {formatClock(groupStart)}–{formatClock(groupEnd)} · {orderedBlocks.length}개</p>
          </div>
          <button type="button" aria-label="일정 선택 닫기" onClick={onClose}><X /></button>
        </header>
        <ul className="today-direct-block-picker__list">
          {orderedBlocks.map((block) => {
            const kind = block.external ? 'Google · 읽기 전용' : block.taskId ? '할 일' : '독립 일정';
            return (
              <li key={block.id}>
                <button
                  type="button"
                  data-picker-option
                  data-picker-block-id={block.id}
                  aria-label={`${block.title}, ${describeRange(block)}, ${kind} 선택`}
                  onClick={() => onSelect(block.id)}
                >
                  <span className="today-direct-block-picker__kind">
                    {block.external ? <LockKeyhole /> : block.taskId ? <CircleCheck /> : <Calendar />}
                    {kind}
                  </span>
                  <strong>{block.title}</strong>
                  <time>{describeRange(block)}</time>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
