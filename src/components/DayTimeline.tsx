import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from 'react';
import {
  Calendar,
  Check,
  ChevronUp,
  CircleCheck,
  Clock3,
  GripHorizontal,
  LockKeyhole,
  Pause,
  Play,
  Star,
  Trash2,
  X
} from 'lucide-react';
import type { DayKey, Task, TimeBlock } from '../domain/types';
import {
  createDefaultRange,
  DAY_END_MINUTES,
  DEFAULT_BLOCK_DURATION_MINUTES,
  getBlockGeometry,
  getConflictDetail,
  getTimelineLanePlacements,
  MIN_BLOCK_DURATION_MINUTES,
  moveRange,
  parseClockInput,
  pointerYToMinutes,
  pointerYsToRange,
  rangeFromBlock,
  resizeRangeBottom,
  resizeRangeTop,
  snapMinutes,
  TIMELINE_SNAP_MINUTES,
  type DayMinuteRange,
  type TimelineBounds
} from '../lib/dayTimeline';
import { isLocalDate } from '../lib/calendarDate';
import { formatClock, formatMinutes } from '../lib/format';

export const DAY_TIMELINE_HOUR_HEIGHT = 64;
const DAY_TIMELINE_HEIGHT = DAY_TIMELINE_HOUR_HEIGHT * 24;
const POINTER_MOVE_THRESHOLD = 5;
const TOUCH_SCROLL_THRESHOLD = 8;
const TOUCH_LONG_PRESS_MS = 350;
const MOBILE_BLOCK_CONTROL_SIZE = 44;
const PLACEMENT_CONFLICT_MESSAGE = '다른 일정과 겹쳐 배치하지 못했습니다.';

export type TimelineCreateKind = 'todo' | 'event';

export interface TimelineCreateInput {
  kind: TimelineCreateKind;
  range: DayMinuteRange;
  title: string;
}

interface DayTimelineProps {
  blocks: TimeBlock[];
  currentMinute: number | null;
  date: string;
  day: DayKey;
  draggingTask: Task | null;
  mobile: boolean;
  runningTaskId: string | null;
  timerPaused: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  tasks: Task[];
  onCompleteTask: (taskId: string) => void;
  onCreate: (input: TimelineCreateInput) => boolean;
  onDragTaskEnd: () => void;
  onRemoveBlock: (block: TimeBlock) => void;
  onScheduleTaskAgain: (task: Task) => void;
  onScheduleTask: (task: Task, range: DayMinuteRange) => boolean;
  onStartTask: (taskId: string) => void;
  onUpdateBlock: (block: TimeBlock, range: DayMinuteRange, date?: string, title?: string) => boolean;
}

type PointerMode = 'create' | 'move' | 'resize-top' | 'resize-bottom';

interface PointerDraft {
  block: TimeBlock | null;
  captureTarget: HTMLElement;
  mode: PointerMode;
  moved: boolean;
  originClientY: number;
  originPointerMinutes: number;
  originRange: DayMinuteRange;
  pointerId: number;
  pointerType: string;
  range: DayMinuteRange;
}

interface PendingTouch {
  block: TimeBlock;
  originClientX: number;
  originClientY: number;
  originPointerMinutes: number;
  pointerId: number;
  target: HTMLElement;
  timerId: number | null;
}

interface InlineDraft {
  kind: TimelineCreateKind;
  range: DayMinuteRange;
  title: string;
}

interface ConflictPreview {
  block: TimeBlock;
  range: DayMinuteRange;
  overlapMinutes: number;
}

interface MobileBlockControlPlacement {
  blocks: TimeBlock[];
  topPx: number;
}

const MobileBlockPicker = lazy(() => import('./MobileBlockPicker'));

interface BlockActionPanelProps {
  block: TimeBlock;
  ownsTimer: boolean;
  timerBusy: boolean;
  timerPaused: boolean;
  task: Task | undefined;
  onClose: () => void;
  onCommit: (range: DayMinuteRange, date?: string, title?: string) => boolean;
  onCompleteTask: (taskId: string) => void;
  onRemove: () => void;
  onScheduleTaskAgain: (task: Task) => void;
  onStartTask: (taskId: string) => void;
}

const rangesEqual = (left: DayMinuteRange, right: DayMinuteRange) => (
  left.startMinutes === right.startMinutes && left.endMinutes === right.endMinutes
);

const describeRange = (range: DayMinuteRange) => `${formatClock(range.startMinutes)}–${formatClock(range.endMinutes)}`;
const beforeMidnightMessage = (minutes: number) => `${formatMinutes(minutes)} 일정은 자정 전에 끝나야 합니다.`;
const taskPlacementDuration = (task: Task) => Math.max(
  MIN_BLOCK_DURATION_MINUTES,
  task.estimateMinutes || DEFAULT_BLOCK_DURATION_MINUTES
);

const useDialogFocusTrap = (panelRef: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const panel = panelRef.current;
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!panel) return undefined;
    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => (getFocusable()[0] ?? panel).focus());
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
  }, [panelRef]);
};

const getMobileBlockControlPlacements = (
  blocks: TimeBlock[],
  draft: PointerDraft | null
): MobileBlockControlPlacement[] => {
  const candidates = blocks
    .map((block) => {
      const range = draft?.block?.id === block.id ? draft.range : rangeFromBlock(block);
      const geometry = getBlockGeometry(range, DAY_TIMELINE_HEIGHT);
      return {
        block,
        desiredTop: Math.max(
          0,
          Math.min(
            DAY_TIMELINE_HEIGHT - MOBILE_BLOCK_CONTROL_SIZE,
            geometry.topPx + (geometry.heightPx / 2) - (MOBILE_BLOCK_CONTROL_SIZE / 2)
          )
        )
      };
    })
    .sort((left, right) => left.desiredTop - right.desiredTop || left.block.id.localeCompare(right.block.id));

  const placements: MobileBlockControlPlacement[] = [];
  for (const candidate of candidates) {
    const current = placements.at(-1);
    if (!current || candidate.desiredTop - current.topPx >= MOBILE_BLOCK_CONTROL_SIZE) {
      placements.push({ blocks: [candidate.block], topPx: candidate.desiredTop });
      continue;
    }
    current.blocks.push(candidate.block);
  }

  return placements;
};

function BlockActionPanel({
  block,
  ownsTimer,
  timerBusy,
  timerPaused,
  task,
  onClose,
  onCommit,
  onCompleteTask,
  onRemove,
  onScheduleTaskAgain,
  onStartTask
}: BlockActionPanelProps) {
  const originalRange = rangeFromBlock(block);
  const panelRef = useRef<HTMLElement>(null);
  const titleComposingRef = useRef(false);
  const [startValue, setStartValue] = useState(formatClock(originalRange.startMinutes));
  const [endValue, setEndValue] = useState(formatClock(originalRange.endMinutes));
  const [dateValue, setDateValue] = useState(block.date);
  const [titleValue, setTitleValue] = useState(block.title);
  const [error, setError] = useState('');

  useDialogFocusTrap(panelRef);

  const commit = (range: DayMinuteRange, date?: string, title?: string) => {
    if (date !== undefined && !isLocalDate(date)) {
      setError('올바른 날짜를 선택하세요.');
      return;
    }
    const normalizedTitle = title?.trim();
    if (title !== undefined && !normalizedTitle) {
      setError('일정 제목을 입력하세요.');
      return;
    }
    const titleChanged = normalizedTitle !== undefined && normalizedTitle !== block.title;
    if (rangesEqual(range, originalRange) && (!date || date === block.date) && !titleChanged) {
      setError('변경할 시간이나 날짜를 선택하세요.');
      return;
    }
    if (!onCommit(range, date, normalizedTitle)) {
      setError('시간이 겹치거나 범위를 벗어났습니다.');
    }
  };

  const submitDirectTime = (event: FormEvent) => {
    event.preventDefault();
    if (titleComposingRef.current) return;
    const startMinutes = parseClockInput(startValue);
    const endMinutes = parseClockInput(endValue, true);
    if (startMinutes === null || endMinutes === null || endMinutes - startMinutes < 15) {
      setError('15분 이상의 시간 범위를 입력하세요.');
      return;
    }
    const startChanged = startMinutes !== originalRange.startMinutes;
    const endChanged = endMinutes !== originalRange.endMinutes;
    const preservesDuration = endMinutes - startMinutes === originalRange.endMinutes - originalRange.startMinutes;
    const movesWholeBlock = startChanged && endChanged && preservesDuration;
    const changedBoundaryIsOffGrid = (
      (startChanged && startMinutes % TIMELINE_SNAP_MINUTES !== 0)
      || (endChanged && !movesWholeBlock && endMinutes % TIMELINE_SNAP_MINUTES !== 0)
    );
    if (changedBoundaryIsOffGrid) {
      setError('시간은 15분 단위로 입력하세요.');
      return;
    }
    if (!isLocalDate(dateValue)) {
      setError('올바른 날짜를 선택하세요.');
      return;
    }
    commit(
      { startMinutes, endMinutes },
      dateValue,
      block.taskId === null ? titleValue : undefined
    );
  };

  return (
    <div className="today-direct-block-panel-layer">
      <button className="today-direct-block-panel__backdrop" type="button" aria-label="블록 작업 닫기" onClick={onClose} />
      <section ref={panelRef} className="today-direct-block-panel" role="dialog" aria-label={`${block.title} 블록 작업`} aria-modal="true" tabIndex={-1}>
        <header>
          <div>
            <span className="today-direct-kicker">{block.external ? 'GOOGLE CALENDAR' : block.taskId ? 'TODO 시간 블록' : '독립 일정'}</span>
            <h3>{block.title}</h3>
            <p><Clock3 size={14} aria-hidden="true" /> {describeRange(originalRange)} · {formatMinutes(block.durationMinutes)}</p>
          </div>
          <button type="button" aria-label="블록 작업 닫기" onClick={onClose}><X /></button>
        </header>

        {block.external ? (
          <div className="today-direct-readonly">
            <LockKeyhole aria-hidden="true" />
            <div><strong>Google Calendar 읽기 전용 일정</strong><p>이동·변경·삭제는 Google Calendar에서 관리하세요.</p></div>
          </div>
        ) : (
          <>
            <div className="today-direct-block-quick-actions" aria-label="15분 단위 시간 조정">
              <button type="button" disabled={originalRange.startMinutes === 0} onClick={() => commit(moveRange(originalRange, originalRange.startMinutes - 15))}><ChevronUp />15분 앞당기기</button>
              <button type="button" disabled={originalRange.endMinutes === DAY_END_MINUTES} onClick={() => commit(moveRange(originalRange, originalRange.startMinutes + 15))}><ChevronUp className="is-down" />15분 미루기</button>
              <button
                type="button"
                disabled={originalRange.endMinutes === DAY_END_MINUTES}
                onClick={() => commit({
                  startMinutes: originalRange.startMinutes,
                  endMinutes: Math.min(DAY_END_MINUTES, originalRange.endMinutes + 15)
                })}
              >+ 15분 늘리기</button>
              <button
                type="button"
                disabled={block.durationMinutes <= MIN_BLOCK_DURATION_MINUTES}
                onClick={() => commit({
                  startMinutes: originalRange.startMinutes,
                  endMinutes: Math.max(
                    originalRange.startMinutes + MIN_BLOCK_DURATION_MINUTES,
                    originalRange.endMinutes - 15
                  )
                })}
              >− 15분 줄이기</button>
            </div>

            <form className="today-direct-time-form" onSubmit={submitDirectTime}>
              {block.taskId === null && (
                <label className="today-direct-time-form__date">
                  <span>일정 제목</span>
                  <input
                    value={titleValue}
                    onChange={(event) => setTitleValue(event.target.value)}
                    onCompositionStart={() => { titleComposingRef.current = true; }}
                    onCompositionEnd={() => { titleComposingRef.current = false; }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.nativeEvent.isComposing || titleComposingRef.current)) {
                        event.preventDefault();
                      }
                    }}
                    aria-label="일정 제목"
                    required
                  />
                </label>
              )}
              <label><span>시작</span><input value={startValue} inputMode="numeric" onChange={(event) => setStartValue(event.target.value)} aria-label="시작 시간" /></label>
              <span aria-hidden="true">→</span>
              <label><span>종료</span><input value={endValue} inputMode="numeric" onChange={(event) => setEndValue(event.target.value)} aria-label="종료 시간" /></label>
              <label className="today-direct-time-form__date"><span>날짜</span><input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} aria-label="다른 날짜로 이동" required /></label>
              <button type="submit"><Check />변경 저장</button>
            </form>

            {task && (
              <div className="today-direct-block-task-actions">
                <button type="button" disabled={timerBusy} onClick={() => { onStartTask(task.id); onClose(); }}>
                  {ownsTimer && !timerPaused ? <Pause /> : <Play />}
                  {timerBusy
                    ? timerPaused ? '다른 할 일 일시정지 중' : '다른 할 일 실행 중'
                    : ownsTimer ? timerPaused ? '타이머 계속' : '타이머 멈춤' : '타이머 시작'}
                </button>
                <button type="button" onClick={() => { onCompleteTask(task.id); onClose(); }}><CircleCheck />할 일 완료</button>
                <button type="button" onClick={() => { onScheduleTaskAgain(task); onClose(); }}><Calendar />같은 할 일 다시 배치</button>
              </div>
            )}

            <button className="today-direct-remove-block" type="button" onClick={onRemove}><Trash2 />시간표에서 빼기</button>
          </>
        )}
        {error && <p className="today-direct-panel-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

export function DayTimeline({
  blocks,
  currentMinute,
  date,
  day,
  draggingTask,
  mobile,
  runningTaskId,
  timerPaused,
  scrollRef,
  tasks,
  onCompleteTask,
  onCreate,
  onDragTaskEnd,
  onRemoveBlock,
  onScheduleTaskAgain,
  onScheduleTask,
  onStartTask,
  onUpdateBlock
}: DayTimelineProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const inlineEditorRef = useRef<HTMLFormElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const placementTimeRef = useRef<HTMLInputElement>(null);
  const pointerDraftRef = useRef<PointerDraft | null>(null);
  const pendingTouchRef = useRef<PendingTouch | null>(null);
  const inlineComposingRef = useRef(false);
  const focusAfterCreateRef = useRef<{ startMinutes: number; title: string } | null>(null);
  const [pointerDraft, setPointerDraftState] = useState<PointerDraft | null>(null);
  const [inlineDraft, setInlineDraft] = useState<InlineDraft | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [mobilePickerBlockIds, setMobilePickerBlockIds] = useState<string[] | null>(null);
  const [dropRange, setDropRange] = useState<DayMinuteRange | null>(null);
  const [feedback, setFeedback] = useState('');
  const [placementTime, setPlacementTime] = useState('09:00');
  const [keyboardCreateTime, setKeyboardCreateTime] = useState('09:00');

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const lanesByBlockId = useMemo(() => getTimelineLanePlacements(blocks.map((block) => ({
    id: block.id,
    ...rangeFromBlock(block)
  }))), [blocks]);
  const activeBlock = blocks.find((block) => block.id === activeBlockId);
  const mobileBlockControls = useMemo(
    () => mobile ? getMobileBlockControlPlacements(blocks, pointerDraft) : [],
    [blocks, mobile, pointerDraft]
  );
  const mobilePickerBlocks = useMemo(() => {
    if (!mobilePickerBlockIds) return [];
    const selectedIds = new Set(mobilePickerBlockIds);
    return blocks.filter((block) => selectedIds.has(block.id));
  }, [blocks, mobilePickerBlockIds]);

  const setPointerDraft = (draft: PointerDraft | null) => {
    pointerDraftRef.current = draft;
    setPointerDraftState(draft);
  };

  const clearPendingTouch = () => {
    const pending = pendingTouchRef.current;
    if (pending && pending.timerId !== null) window.clearTimeout(pending.timerId);
    pendingTouchRef.current = null;
  };

  useEffect(() => {
    const preventNativeScrollAfterLongPress = (event: TouchEvent) => {
      const draft = pointerDraftRef.current;
      if (draft?.pointerType === 'touch' && draft.mode !== 'create') event.preventDefault();
    };
    window.addEventListener('touchmove', preventNativeScrollAfterLongPress, { passive: false });
    return () => {
      clearPendingTouch();
      window.removeEventListener('touchmove', preventNativeScrollAfterLongPress);
    };
  }, []);

  useEffect(() => {
    if (!inlineDraft) return undefined;
    inlineInputRef.current?.focus();
    const cancelOutside = (event: globalThis.PointerEvent) => {
      if (inlineEditorRef.current?.contains(event.target as Node)) return;
      setInlineDraft(null);
    };
    window.addEventListener('pointerdown', cancelOutside);
    return () => window.removeEventListener('pointerdown', cancelOutside);
  }, [inlineDraft]);

  useEffect(() => {
    const focusTarget = focusAfterCreateRef.current;
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const candidates = gridRef.current?.querySelectorAll<HTMLElement>(`[data-start="${focusTarget.startMinutes}"]`);
      const target = candidates ? [...candidates].find((candidate) => candidate.textContent?.includes(focusTarget.title)) : undefined;
      target?.focus();
      focusAfterCreateRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [blocks]);

  useEffect(() => {
    if (!inlineDraft && !activeBlockId && !mobilePickerBlockIds && !draggingTask) return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mobilePickerBlockIds) setMobilePickerBlockIds(null);
      else if (activeBlockId) setActiveBlockId(null);
      else if (inlineDraft) setInlineDraft(null);
      else onDragTaskEnd();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activeBlockId, draggingTask, inlineDraft, mobilePickerBlockIds, onDragTaskEnd]);

  useEffect(() => {
    if (!draggingTask) return undefined;
    const initialMinute = Math.min(
      DAY_END_MINUTES - TIMELINE_SNAP_MINUTES,
      snapMinutes(currentMinute ?? 9 * 60, 'ceil')
    );
    setPlacementTime(formatClock(initialMinute));
    const frame = window.requestAnimationFrame(() => {
      placementTimeRef.current?.focus();
      placementTimeRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draggingTask?.id]);

  const timelineBounds = (): TimelineBounds | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return null;
    return { top: rect.top, height: rect.height };
  };

  const conflictForRange = (range: DayMinuteRange, ignoreBlockId?: string): ConflictPreview | null => {
    for (const block of blocks) {
      if (block.id === ignoreBlockId) continue;
      const detail = getConflictDetail(range, rangeFromBlock(block));
      if (detail) return { block, range: { startMinutes: detail.startMinutes, endMinutes: detail.endMinutes }, overlapMinutes: detail.overlapMinutes };
    }
    return null;
  };

  const conflictMessage = (conflict: ConflictPreview) => (
    `${describeRange(conflict.range)} · ${conflict.overlapMinutes}분 겹침 · ${conflict.block.title}`
  );

  const startInlineCreate = (range: DayMinuteRange) => {
    const conflict = conflictForRange(range);
    if (conflict) {
      setFeedback(`${conflictMessage(conflict)} — 빈 시간을 선택하세요.`);
      return;
    }
    setFeedback('');
    inlineComposingRef.current = false;
    setInlineDraft({ kind: 'todo', range, title: '' });
  };

  const saveInline = () => {
    if (!inlineDraft?.title.trim()) return;
    const conflict = conflictForRange(inlineDraft.range);
    if (conflict) return setFeedback(`${conflictMessage(conflict)} — 저장하지 않았습니다.`);
    const input = { ...inlineDraft, title: inlineDraft.title.trim() };
    if (!onCreate(input)) return setFeedback('시간이 겹쳐 저장하지 못했습니다.');
    focusAfterCreateRef.current = { startMinutes: input.range.startMinutes, title: input.title };
    setInlineDraft(null);
    setFeedback(`${input.title}, ${describeRange(input.range)}에 추가했습니다.`);
  };

  const handleInlineKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setInlineDraft(null);
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.nativeEvent.isComposing || inlineComposingRef.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    saveInline();
  };

  const beginCreatePointer = (
    event: Pick<PointerEvent<HTMLElement>, 'clientY' | 'pointerId' | 'pointerType'>,
    captureTarget: HTMLElement
  ) => {
    const bounds = timelineBounds();
    if (!bounds) return;
    const minute = pointerYToMinutes(event.clientY, bounds, 'floor');
    const selectedDuration = draggingTask
      ? taskPlacementDuration(draggingTask)
      : undefined;
    const range = createDefaultRange(minute, selectedDuration);
    const draft: PointerDraft = {
      block: null,
      captureTarget,
      mode: 'create',
      moved: false,
      originClientY: event.clientY,
      originPointerMinutes: minute,
      originRange: range,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      range
    };
    setActiveBlockId(null);
    setInlineDraft(null);
    setPointerDraft(draft);
    if (event.pointerType !== 'touch') captureTarget.setPointerCapture?.(event.pointerId);
  };

  const beginGridPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.today-direct-block-wrap, .today-direct-compact-touch-target, .today-direct-inline-editor, .today-direct-block-panel-layer')) return;
    beginCreatePointer(event, event.currentTarget);
  };

  const beginBlockPointer = (event: PointerEvent<HTMLElement>, block: TimeBlock) => {
    if (!event.isPrimary || event.button !== 0) return;
    const compactWrapper = event.currentTarget.closest<HTMLElement>('.today-direct-block-wrap.is-compact');
    if (
      event.pointerType === 'touch'
      && compactWrapper
      && event.currentTarget.classList.contains('today-direct-block')
    ) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY >= rect.bottom) {
        event.preventDefault();
        event.stopPropagation();
        beginCreatePointer(event, gridRef.current ?? event.currentTarget);
        return;
      }
    }
    event.stopPropagation();
    const bounds = timelineBounds();
    if (!bounds) return;
    const originRange = rangeFromBlock(block);
    const originPointerMinutes = pointerYToMinutes(event.clientY, bounds);
    if (event.pointerType === 'touch') {
      clearPendingTouch();
      const target = event.currentTarget;
      const timerId = block.external ? null : window.setTimeout(() => {
        const pending = pendingTouchRef.current;
        if (!pending || pending.pointerId !== event.pointerId) return;
        pendingTouchRef.current = null;
        const captureTarget = gridRef.current ?? pending.target;
        captureTarget.setPointerCapture?.(pending.pointerId);
        navigator.vibrate?.(8);
        setPointerDraft({
          block,
          captureTarget,
          mode: 'move',
          moved: false,
          originClientY: pending.originClientY,
          originPointerMinutes: pending.originPointerMinutes,
          originRange,
          pointerId: pending.pointerId,
          pointerType: 'touch',
          range: originRange
        });
      }, TOUCH_LONG_PRESS_MS);
      pendingTouchRef.current = {
        block,
        originClientX: event.clientX,
        originClientY: event.clientY,
        originPointerMinutes,
        pointerId: event.pointerId,
        target,
        timerId
      };
      return;
    }
    if (block.external) {
      setActiveBlockId(block.id);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPointerDraft({
      block,
      captureTarget: event.currentTarget,
      mode: 'move',
      moved: false,
      originClientY: event.clientY,
      originPointerMinutes,
      originRange,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      range: originRange
    });
  };

  const beginResizePointer = (event: PointerEvent<HTMLButtonElement>, block: TimeBlock, mode: 'resize-top' | 'resize-bottom') => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = timelineBounds();
    if (!bounds || block.external) return;
    const range = rangeFromBlock(block);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPointerDraft({
      block,
      captureTarget: event.currentTarget,
      mode,
      moved: false,
      originClientY: event.clientY,
      originPointerMinutes: pointerYToMinutes(event.clientY, bounds),
      originRange: range,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      range
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pending = pendingTouchRef.current;
    if (pending?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - pending.originClientX, event.clientY - pending.originClientY);
      if (distance > TOUCH_SCROLL_THRESHOLD) clearPendingTouch();
      return;
    }
    const draft = pointerDraftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    const distance = Math.abs(event.clientY - draft.originClientY);
    if (draft.pointerType === 'touch' && draft.mode === 'create' && distance > TOUCH_SCROLL_THRESHOLD) {
      setPointerDraft(null);
      return;
    }
    const bounds = timelineBounds();
    if (!bounds) return;
    let nextRange = draft.range;
    if (draft.mode === 'create') {
      nextRange = distance >= POINTER_MOVE_THRESHOLD
        ? pointerYsToRange(draft.originClientY, event.clientY, bounds)
        : draft.originRange;
    } else {
      event.preventDefault();
      const pointerMinute = pointerYToMinutes(event.clientY, bounds);
      if (draft.mode === 'move') {
        nextRange = moveRange(draft.originRange, draft.originRange.startMinutes + pointerMinute - draft.originPointerMinutes);
      } else if (draft.mode === 'resize-top') {
        nextRange = resizeRangeTop(draft.originRange, pointerMinute);
      } else {
        nextRange = resizeRangeBottom(draft.originRange, pointerMinute);
      }
    }
    setPointerDraft({ ...draft, moved: draft.moved || distance >= POINTER_MOVE_THRESHOLD, range: nextRange });
  };

  const releaseCapture = (draft: PointerDraft) => {
    try {
      if (draft.captureTarget.hasPointerCapture?.(draft.pointerId)) draft.captureTarget.releasePointerCapture?.(draft.pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pending = pendingTouchRef.current;
    if (pending?.pointerId === event.pointerId) {
      // Prevent the compatibility click from landing on the action sheet that
      // is mounted by this pointer-up (a mobile "ghost click"). Mounting on
      // the next task also keeps that click targeted at the original block.
      event.preventDefault();
      const blockId = pending.block.id;
      clearPendingTouch();
      window.setTimeout(() => setActiveBlockId(blockId), 0);
      return;
    }
    const draft = pointerDraftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    releaseCapture(draft);
    setPointerDraft(null);
    if (draft.mode === 'create') {
      if (draft.pointerType === 'touch' && draft.moved) return;
      const targetRange = draft.moved ? draft.range : draft.originRange;
      if (draggingTask) {
        const expectedDuration = taskPlacementDuration(draggingTask);
        if (targetRange.endMinutes - targetRange.startMinutes < expectedDuration) {
          setFeedback(beforeMidnightMessage(expectedDuration));
          return;
        }
        const conflict = conflictForRange(targetRange);
        if (conflict) {
          setFeedback(`${conflictMessage(conflict)} — ${draggingTask.title}은 배치하지 않았습니다.`);
          return;
        }
        if (!onScheduleTask(draggingTask, targetRange)) {
          setFeedback(PLACEMENT_CONFLICT_MESSAGE);
          return;
        }
        setFeedback(`${draggingTask.title}, ${describeRange(targetRange)}에 추가 배치했습니다.`);
        onDragTaskEnd();
        return;
      }
      startInlineCreate(targetRange);
      return;
    }
    if (!draft.block) return;
    if (!draft.moved || rangesEqual(draft.range, draft.originRange)) {
      setActiveBlockId(draft.block.id);
      return;
    }
    const conflict = conflictForRange(draft.range, draft.block.id);
    if (conflict) {
      setFeedback(`${conflictMessage(conflict)} — 원래 시간으로 돌아갔습니다.`);
      return;
    }
    if (!onUpdateBlock(draft.block, draft.range)) {
      setFeedback('시간이 겹쳐 원래대로 돌아갔습니다.');
      return;
    }
    setFeedback(`${draft.block.title}, ${describeRange(draft.range)}로 변경했습니다.`);
  };

  const cancelPointer = () => {
    clearPendingTouch();
    const draft = pointerDraftRef.current;
    if (draft) releaseCapture(draft);
    setPointerDraft(null);
    setDropRange(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingTask) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const bounds = timelineBounds();
    if (!bounds) return;
    const duration = taskPlacementDuration(draggingTask);
    setDropRange(createDefaultRange(pointerYToMinutes(event.clientY, bounds), duration));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingTask || !dropRange) return;
    event.preventDefault();
    const expectedDuration = taskPlacementDuration(draggingTask);
    if (dropRange.endMinutes - dropRange.startMinutes < expectedDuration) {
      setFeedback(beforeMidnightMessage(expectedDuration));
      setDropRange(null);
      onDragTaskEnd();
      return;
    }
    const conflict = conflictForRange(dropRange);
    if (conflict) {
      setFeedback(`${conflictMessage(conflict)} — ${draggingTask.title}은 배치하지 않았습니다.`);
    } else if (!onScheduleTask(draggingTask, dropRange)) {
      setFeedback(PLACEMENT_CONFLICT_MESSAGE);
    } else {
      setFeedback(`${draggingTask.title}, ${describeRange(dropRange)}에 배치했습니다.`);
    }
    setDropRange(null);
    onDragTaskEnd();
  };

  const submitPlacementTime = (event: FormEvent) => {
    event.preventDefault();
    if (!draggingTask) return;
    const startMinutes = parseClockInput(placementTime);
    const durationMinutes = taskPlacementDuration(draggingTask);
    if (startMinutes === null || startMinutes % TIMELINE_SNAP_MINUTES !== 0) {
      setFeedback('시작은 15분 단위로 입력하세요.');
      return;
    }
    const range = { startMinutes, endMinutes: startMinutes + durationMinutes };
    if (range.endMinutes > DAY_END_MINUTES) {
      setFeedback(beforeMidnightMessage(durationMinutes));
      return;
    }
    const conflict = conflictForRange(range);
    if (conflict) {
      setFeedback(`${conflictMessage(conflict)} — 빈 시간을 다시 선택하세요.`);
      return;
    }
    if (!onScheduleTask(draggingTask, range)) {
      setFeedback(PLACEMENT_CONFLICT_MESSAGE);
      return;
    }
    setFeedback(`${draggingTask.title}, ${describeRange(range)}에 추가 배치했습니다.`);
    onDragTaskEnd();
  };

  const submitKeyboardCreate = (event: FormEvent) => {
    event.preventDefault();
    const startMinutes = parseClockInput(keyboardCreateTime);
    if (startMinutes === null || startMinutes % TIMELINE_SNAP_MINUTES !== 0) {
      setFeedback('시작은 15분 단위로 입력하세요.');
      return;
    }
    startInlineCreate(createDefaultRange(startMinutes));
  };

  const commitBlockAction = (block: TimeBlock, range: DayMinuteRange, targetDate = date, title?: string) => {
    const occupancyChanged = targetDate !== block.date || !rangesEqual(range, rangeFromBlock(block));
    if (targetDate === date && occupancyChanged) {
      const conflict = conflictForRange(range, block.id);
      if (conflict) {
        setFeedback(`${conflictMessage(conflict)} — 변경하지 않았습니다.`);
        return false;
      }
    }
    const saved = onUpdateBlock(block, range, targetDate, title);
    if (saved) {
      setFeedback(`${title ?? block.title}, ${targetDate} ${describeRange(range)}로 변경했습니다.`);
      setActiveBlockId(null);
    }
    return saved;
  };

  const draftConflict = pointerDraft?.block
    ? conflictForRange(pointerDraft.range, pointerDraft.block.id)
    : pointerDraft ? conflictForRange(pointerDraft.range) : null;
  const previewRange = inlineDraft?.range ?? dropRange ?? (pointerDraft?.mode === 'create' ? pointerDraft.range : null);
  const previewConflict = previewRange ? conflictForRange(previewRange) : null;

  return (
    <div className="today-direct-timeline">
      <div className="today-direct-timeline__instructions" id="today-direct-instructions">
        <span><GripHorizontal aria-hidden="true" /> 블록 본문을 드래그해 이동</span>
        <span><GripHorizontal aria-hidden="true" /> {mobile ? '블록을 누른 뒤 15분 단위 조정' : '위·아래 핸들로 15분 단위 조정'}</span>
        <span><LockKeyhole aria-hidden="true" /> Google 일정은 읽기 전용</span>
        {draggingTask && (
          <form className="today-direct-placement-mode" onSubmit={submitPlacementTime}>
            <span aria-live="polite"><Calendar aria-hidden="true" /><strong>{draggingTask.title}</strong> 배치할 빈 시간을 선택하세요.</span>
            <label>
              <span>시작</span>
              <input
                ref={placementTimeRef}
                type="time"
                step={TIMELINE_SNAP_MINUTES * 60}
                value={placementTime}
                aria-label={`${draggingTask.title} 배치 시작 시간`}
                onChange={(event) => setPlacementTime(event.target.value)}
              />
            </label>
            <button type="submit"><Check aria-hidden="true" />이 시간에 배치</button>
            <button type="button" onClick={onDragTaskEnd}>취소</button>
          </form>
        )}
        {!draggingTask && (
          <form className="today-direct-keyboard-create" onSubmit={submitKeyboardCreate}>
            <label>
              <span>시작 시간</span>
              <input
                type="time"
                step={TIMELINE_SNAP_MINUTES * 60}
                value={keyboardCreateTime}
                aria-label="키보드 일정 시작 시간"
                onChange={(event) => setKeyboardCreateTime(event.target.value)}
              />
            </label>
            <button type="submit"><Calendar aria-hidden="true" />이 시간에 일정 추가</button>
          </form>
        )}
      </div>
      <div className="today-direct-scroll" ref={scrollRef}>
        <div
          className={`today-direct-grid${pointerDraft ? ' is-interacting' : ''}${draggingTask ? ' is-placing-task' : ''}`}
          ref={gridRef}
          data-day={day}
          style={{ height: `${DAY_TIMELINE_HEIGHT}px` }}
          aria-describedby="today-direct-instructions"
          aria-label="00시부터 24시까지 15분 단위 시간표. 빈 시간을 누르거나 드래그해 일정을 만듭니다."
          onPointerDown={beginGridPointer}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPointer}
          onLostPointerCapture={(event) => {
            if (pointerDraftRef.current?.pointerId === event.pointerId) setPointerDraft(null);
          }}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropRange(null);
          }}
          onDrop={handleDrop}
        >
          <div className="today-direct-hours" aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => (
              <div className="today-direct-hour" key={hour} style={{ top: `${hour * DAY_TIMELINE_HOUR_HEIGHT}px` }}><time>{formatClock(hour * 60)}</time><span /></div>
            ))}
          </div>

          <div className="today-direct-blocks">
            {blocks.map((block) => {
              const baseRange = rangeFromBlock(block);
              const range = pointerDraft?.block?.id === block.id ? pointerDraft.range : baseRange;
              const geometry = getBlockGeometry(range, DAY_TIMELINE_HEIGHT);
              const task = block.taskId ? taskById.get(block.taskId) : undefined;
              const isConflict = pointerDraft?.block?.id === block.id && Boolean(draftConflict);
              const kindClass = block.external ? 'is-google' : block.taskId ? 'is-todo' : 'is-event';
              const isCompact = range.endMinutes - range.startMinutes <= 30;
              const compactClass = isCompact ? ' is-compact' : '';
              const wrapperClass = `today-direct-block-wrap ${kindClass}${compactClass}${isConflict ? ' is-conflict' : ''}`;
              const lane = lanesByBlockId.get(block.id) ?? { index: 0, count: 1 };
              const laneStyle = {
                '--lane-left': `${lane.index / lane.count * 100}%`,
                '--lane-width': `calc(${100 / lane.count}% - ${lane.count > 1 ? 2 : 0}px)`
              } as CSSProperties;
              const label = `${block.title}, ${formatClock(range.startMinutes)}부터 ${formatClock(range.endMinutes)}까지, ${block.external ? 'Google Calendar 읽기 전용 일정' : block.taskId ? '할 일 시간 블록' : '독립 일정'}`;
              return (
                <div key={block.id} className={wrapperClass} style={{ ...laneStyle, top: `${geometry.topPx + 1}px`, height: `${Math.max(14, geometry.heightPx - 2)}px` }}>
                  <article
                    className="today-direct-block"
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    data-block-id={block.id}
                    data-start={range.startMinutes}
                    onPointerDown={(event) => beginBlockPointer(event, block)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setActiveBlockId(block.id);
                    }}
                  >
                    <span className="today-direct-block__kind">
                      {block.external ? <LockKeyhole /> : block.taskId ? <CircleCheck /> : <Calendar />}
                      {block.external ? 'Google · 읽기 전용' : block.taskId ? '할 일' : '독립 일정'}
                    </span>
                    <strong>{task?.pinned && <Star size={12} fill="currentColor" aria-label="Top 3" />}{block.title}</strong>
                    <span className="today-direct-block__time">
                      {describeRange(range)}
                      {runningTaskId !== null && runningTaskId === block.taskId && <em> · {timerPaused ? '일시정지' : '실행 중'}</em>}
                    </span>
                  </article>
                  {!mobile && !block.external && lane.count <= 2 && (
                    <>
                      <button
                        className="today-direct-resize-handle is-top"
                        type="button"
                        aria-label={`${block.title} 시작 시간 조절`}
                      title="시작 시간 조절"
                      onClick={(event) => { if (event.detail === 0) setActiveBlockId(block.id); }}
                      onPointerDown={(event) => beginResizePointer(event, block, 'resize-top')}
                      ><GripHorizontal aria-hidden="true" /></button>
                      <button
                        className="today-direct-resize-handle is-bottom"
                        type="button"
                        aria-label={`${block.title} 종료 시간 조절`}
                      title="종료 시간 조절"
                      onClick={(event) => { if (event.detail === 0) setActiveBlockId(block.id); }}
                      onPointerDown={(event) => beginResizePointer(event, block, 'resize-bottom')}
                      ><GripHorizontal aria-hidden="true" /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {mobile && !draggingTask && (
            <div className="today-direct-mobile-block-controls" aria-label="모바일 일정 조작">
              {mobileBlockControls.map(({ blocks: controlBlocks, topPx }) => {
                const block = controlBlocks[0];
                const isGroup = controlBlocks.length > 1;
                const kindClass = isGroup
                  ? 'is-group'
                  : block.external ? 'is-google' : block.taskId ? 'is-todo' : 'is-event';
                const groupStart = Math.min(...controlBlocks.map((item) => item.startMinutes));
                const groupEnd = Math.max(...controlBlocks.map((item) => item.startMinutes + item.durationMinutes));
                const label = isGroup
                  ? `${formatClock(groupStart)}–${formatClock(groupEnd)} 일정 ${controlBlocks.length}개 선택`
                  : block.external ? `${block.title} 읽기 전용 일정 보기` : `${block.title} 빠른 조작`;
                return (
                  <button
                    key={controlBlocks.map((item) => item.id).join(':')}
                    className={`today-direct-compact-touch-target ${kindClass}`}
                    type="button"
                    style={{ top: `${topPx}px` }}
                    aria-label={label}
                    onClick={isGroup
                      ? () => {
                          setMobilePickerBlockIds(controlBlocks.map((item) => item.id));
                        }
                      : (event) => { if (event.detail === 0) setActiveBlockId(block.id); }}
                    onPointerDown={isGroup ? undefined : (event) => beginBlockPointer(event, block)}
                  >{isGroup
                    ? <span aria-hidden="true">{controlBlocks.length}</span>
                    : block.external ? <LockKeyhole aria-hidden="true" /> : <GripHorizontal aria-hidden="true" />}</button>
                );
              })}
            </div>
          )}

          {previewRange && (
            <div className={`today-direct-draft-block${previewConflict ? ' is-conflict' : ''}`} style={{ top: `${getBlockGeometry(previewRange, DAY_TIMELINE_HEIGHT).topPx + 1}px`, height: `${Math.max(14, getBlockGeometry(previewRange, DAY_TIMELINE_HEIGHT).heightPx - 2)}px` }}>
              <strong>{inlineDraft ? inlineDraft.title || '제목 입력' : draggingTask?.title ?? '새 일정'}</strong>
              <span>{describeRange(previewRange)}</span>
            </div>
          )}

          {inlineDraft && (
            <form
              className="today-direct-inline-editor"
              ref={inlineEditorRef}
              onSubmit={(event) => {
                event.preventDefault();
                if (!inlineComposingRef.current) saveInline();
              }}
              style={{ top: `${Math.min(DAY_TIMELINE_HEIGHT - 82, getBlockGeometry(inlineDraft.range, DAY_TIMELINE_HEIGHT).topPx)}px` }}
            >
              <select value={inlineDraft.kind} onChange={(event) => setInlineDraft((current) => current ? { ...current, kind: event.target.value as TimelineCreateKind } : current)} aria-label="생성 유형">
                <option value="todo">할 일</option><option value="event">독립 일정</option>
              </select>
              <input
                ref={inlineInputRef}
                value={inlineDraft.title}
                onChange={(event) => setInlineDraft((current) => current ? { ...current, title: event.target.value } : current)}
                onCompositionStart={() => { inlineComposingRef.current = true; }}
                onCompositionEnd={() => { inlineComposingRef.current = false; }}
                onKeyDown={handleInlineKeyDown}
                placeholder="무엇을 할까요?"
                aria-label="새 일정 제목"
                autoComplete="off"
              />
              <time>{describeRange(inlineDraft.range)}</time>
              <button type="submit" disabled={!inlineDraft.title.trim()} aria-label="새 일정 저장"><Check /></button>
              <button type="button" aria-label="새 일정 취소" onClick={() => setInlineDraft(null)}><X /></button>
            </form>
          )}

          {currentMinute !== null && currentMinute >= 0 && currentMinute <= DAY_END_MINUTES && (
            <div className="today-direct-now" aria-label={`현재 시각 ${formatClock(currentMinute)}`} style={{ top: `${getBlockGeometry({ startMinutes: currentMinute, endMinutes: currentMinute }, DAY_TIMELINE_HEIGHT).topPx}px` }}>
              <time>{formatClock(currentMinute)}</time><span />
            </div>
          )}

          {(pointerDraft || dropRange) && (
            <output className={`today-direct-live-range${draftConflict || previewConflict ? ' is-conflict' : ''}`} aria-live="polite">
              {describeRange(pointerDraft?.range ?? dropRange ?? createDefaultRange(0))}
              {(draftConflict || previewConflict) && ` · ${conflictMessage((draftConflict || previewConflict) as ConflictPreview)}`}
            </output>
          )}
        </div>
      </div>

      <div className="today-direct-timeline__legend" aria-label="일정 구분">
        <span><i className="is-todo" />할 일 블록</span><span><i className="is-event" />독립 일정</span><span><LockKeyhole />Google 읽기 전용</span>
      </div>
      <p className="today-direct-live-feedback" role={feedback.includes('겹') ? 'alert' : 'status'} aria-live="polite">{feedback}</p>

      {mobilePickerBlocks.length > 0 && (
        <Suspense fallback={(
          <div className="today-direct-block-panel-layer" role="status" aria-live="polite">
            <span className="today-direct-block-panel__backdrop" aria-hidden="true" />
            <span className="today-direct-block-panel">일정 목록 여는 중…</span>
          </div>
        )}>
          <MobileBlockPicker
            blocks={mobilePickerBlocks}
            onClose={() => setMobilePickerBlockIds(null)}
            onSelect={(blockId) => {
              setMobilePickerBlockIds(null);
              setActiveBlockId(blockId);
            }}
          />
        </Suspense>
      )}

      {activeBlock && (
        <BlockActionPanel
          block={activeBlock}
          ownsTimer={runningTaskId !== null && runningTaskId === activeBlock.taskId}
          timerBusy={runningTaskId !== null && runningTaskId !== activeBlock.taskId}
          timerPaused={timerPaused}
          task={activeBlock.taskId ? taskById.get(activeBlock.taskId) : undefined}
          onClose={() => setActiveBlockId(null)}
          onCommit={(range, targetDate, title) => commitBlockAction(activeBlock, range, targetDate, title)}
          onCompleteTask={onCompleteTask}
          onRemove={() => { onRemoveBlock(activeBlock); setActiveBlockId(null); }}
          onScheduleTaskAgain={onScheduleTaskAgain}
          onStartTask={onStartTask}
        />
      )}
    </div>
  );
}
