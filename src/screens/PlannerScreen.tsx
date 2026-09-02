import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Lock,
  Plus,
  Sparkles
} from 'lucide-react';
import clsx from 'clsx';
import { Link, useSearchParams } from 'react-router-dom';
import { CapacityBar } from '../components/CapacityBar';
import { Modal } from '../components/Modal';
import { TaskRow } from '../components/TaskRow';
import { TimeBlockSheet, type TimeBlockEditorValue, type TimeBlockMode } from '../components/TimeBlockSheet';
import type { DayKey, Task, TimeBlock } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import { getToday, getWeekDays } from '../lib/calendarDate';

const defaultPlacementStart = 1020;
const estimateOptions = [15, 25, 40, 60, 90, 120];

interface PlannerBlockDraft {
  blockId?: string;
  taskId: string;
  title: string;
  day: DayKey;
  startMinutes: number;
  durationMinutes: number;
  mode?: TimeBlockMode;
}

function getWeekLabel(weekOffset: number) {
  const days = getWeekDays(weekOffset);
  const first = days[0];
  const last = days[days.length - 1];
  const start = `${first.month}월 ${first.date}일`;
  const end = first.month === last.month ? `${last.date}일` : `${last.month}월 ${last.date}일`;
  return `${start} – ${end}`;
}

function getSplitEstimate(durationMinutes: number) {
  const target = durationMinutes / 2;
  return estimateOptions.reduce((closest, option) => (
    Math.abs(option - target) < Math.abs(closest - target) ? option : closest
  ));
}

export function PlannerScreen() {
  const {
    tasks,
    outcomes,
    timeBlocks,
    review,
    plannerWeekOffset,
    addTask,
    updateTask,
    removeTask,
    scheduleTask,
    saveTimeBlock,
    removeTimeBlock,
    setPlannerWeekOffset
  } = usePlanner();
  const [searchParams, setSearchParams] = useSearchParams();
  const [placementDraft, setPlacementDraft] = useState<PlannerBlockDraft | null>(null);
  const [placementError, setPlacementError] = useState('');
  const [notice, setNotice] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteTaskCandidate, setDeleteTaskCandidate] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addOutcomeId, setAddOutcomeId] = useState('');
  const [addEstimate, setAddEstimate] = useState('25');
  const [addNote, setAddNote] = useState('');
  const queryAction = searchParams.get('action');
  const queryTaskId = searchParams.get('task');

  const weekDays = useMemo(() => getWeekDays(plannerWeekOffset), [plannerWeekOffset]);
  const weekBlocks = useMemo(
    () => timeBlocks.filter((block) => (block.weekOffset ?? 0) === plannerWeekOffset),
    [plannerWeekOffset, timeBlocks]
  );

  const unscheduled = useMemo(() => {
    const items = tasks.filter((task) => (
      task.status !== 'done'
      && task.status !== 'cancelled'
      && !weekBlocks.some((block) => block.taskId === task.id)
    ));
    if (plannerWeekOffset !== 1 || review.selectedTopTaskIds.length === 0) return items;
    const priority = new Map(review.selectedTopTaskIds.map((id, index) => [id, index]));
    return [...items].sort((left, right) => (
      (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [plannerWeekOffset, review.selectedTopTaskIds, tasks, weekBlocks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const availableHours = outcomes.reduce((sum, outcome) => sum + outcome.availableHours, 0);
  const plannedHours = weekBlocks
    .filter((block) => !block.external)
    .reduce((sum, block) => sum + block.durationMinutes / 60, 0);
  const requiredHours = outcomes.reduce((sum, outcome) => sum + outcome.neededHours, 0);
  const capacityPercentage = availableHours > 0 ? Math.round((plannedHours / availableHours) * 100) : 0;
  const carryoverCount = unscheduled.filter((task) => task.carryCount > 0).length;

  const byOutcome = useMemo(() => {
    const groups = new Map<string, Task[]>();
    tasks
      .filter((task) => task.status !== 'cancelled' && (showCompleted || task.status !== 'done'))
      .forEach((task) => {
      const key = task.outcomeId ?? 'inbox';
      groups.set(key, [...(groups.get(key) ?? []), task]);
    });
    return [...groups.entries()];
  }, [showCompleted, tasks]);

  const lanes = useMemo(() => {
    const rows = outcomes.map((outcome) => {
      const plannedMinutes = weekBlocks.reduce((sum, block) => {
        if (block.external || !block.taskId) return sum;
        return taskById.get(block.taskId)?.outcomeId === outcome.id
          ? sum + block.durationMinutes
          : sum;
      }, 0);
      return {
        id: outcome.id,
        title: outcome.title,
        parentTitle: outcome.parentTitle,
        neededHours: outcome.neededHours,
        actualHours: outcome.actualHours,
        plannedMinutes
      };
    });

    const inboxTasks = tasks.filter((task) => task.outcomeId === null && task.status !== 'cancelled');
    if (inboxTasks.length > 0 || outcomes.length === 0) {
      const plannedMinutes = weekBlocks.reduce((sum, block) => {
        if (block.external || !block.taskId) return sum;
        return taskById.get(block.taskId)?.outcomeId === null
          ? sum + block.durationMinutes
          : sum;
      }, 0);
      rows.push({
        id: 'inbox',
        title: '연결되지 않은 할 일',
        parentTitle: '수집함',
        neededHours: inboxTasks.reduce((sum, task) => sum + task.estimateMinutes / 60, 0),
        actualHours: 0,
        plannedMinutes
      });
    }

    rows.push({
      id: 'calendar',
      title: '개인 일정',
      parentTitle: '목표 없이',
      neededHours: 0,
      actualHours: 0,
      plannedMinutes: weekBlocks
        .filter((block) => !block.external && !block.taskId)
        .reduce((sum, block) => sum + block.durationMinutes, 0)
    });

    return rows;
  }, [outcomes, taskById, tasks, weekBlocks]);

  const openPlacement = (
    task: Task | null = null,
    day: DayKey = getToday().key,
    startMinutes = defaultPlacementStart,
    mode?: TimeBlockMode
  ) => {
    setPlacementDraft({
      taskId: task?.id ?? '',
      title: task?.title ?? '',
      day,
      startMinutes,
      durationMinutes: task?.estimateMinutes ?? 30,
      mode
    });
    setPlacementError('');
  };

  const openBlock = (block: TimeBlock) => {
    if (block.external) return;
    setPlacementDraft({
      blockId: block.id,
      taskId: block.taskId ?? '',
      title: block.title,
      day: block.day,
      startMinutes: block.startMinutes,
      durationMinutes: block.durationMinutes,
      mode: block.taskId ? 'existing-task' : 'event'
    });
    setPlacementError('');
  };

  const openAddTask = (sourceTask?: Task) => {
    setEditingTask(null);
    setAddTitle(sourceTask ? `${sourceTask.title} — 1단계` : '');
    setAddOutcomeId(sourceTask?.outcomeId ?? '');
    setAddEstimate(sourceTask ? String(getSplitEstimate(sourceTask.estimateMinutes)) : '25');
    setAddNote('');
    setAddOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setAddTitle(task.title);
    setAddOutcomeId(task.outcomeId ?? '');
    setAddEstimate(String(task.estimateMinutes));
    setAddNote(task.note ?? '');
    setAddOpen(true);
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2400);
  };

  const findConflict = (
    taskId: string,
    day: DayKey,
    startMinutes: number,
    durationMinutes: number
  ) => findTimeBlockConflict(weekBlocks, {
    day,
    startMinutes,
    durationMinutes,
    weekOffset: plannerWeekOffset
  }, { ignoreTaskId: taskId });

  const placeTask = (task: Task, day: DayKey, startMinutes: number, durationMinutes: number) => {
    const conflict = findConflict(task.id, day, startMinutes, durationMinutes);
    if (conflict) {
      const message = `${formatClock(conflict.startMinutes)} ${conflict.title}과 시간이 겹칩니다.`;
      setPlacementError(message);
      return false;
    }
    const saved = scheduleTask(task.id, day, startMinutes, durationMinutes, plannerWeekOffset);
    if (saved === false) {
      setPlacementError('다른 일정과 시간이 겹칩니다. 날짜나 시작 시간을 바꿔주세요.');
      return false;
    }
    setPlacementError('');
    showNotice(`${task.title} · ${formatClock(startMinutes)}에 배치했어요.`);
    return true;
  };

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    if (!addTitle.trim()) return;
    if (editingTask) {
      updateTask(editingTask.id, {
        title: addTitle,
        outcomeId: addOutcomeId || null,
        estimateMinutes: Number(addEstimate),
        note: addNote
      });
      showNotice(`${addTitle.trim()}을 수정했어요.`);
    } else {
      const taskId = addTask({
        title: addTitle.trim(),
        outcomeId: addOutcomeId || null,
        estimateMinutes: Number(addEstimate)
      });
      if (taskId && addNote.trim()) updateTask(taskId, { note: addNote });
      showNotice(`${addTitle.trim()}을 할 일에 추가했어요.`);
    }
    setAddOpen(false);
    setEditingTask(null);
  };

  const saveBlockDraft = (value: TimeBlockEditorValue) => {
    const conflict = findTimeBlockConflict(weekBlocks, {
      day: value.day,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      weekOffset: plannerWeekOffset
    }, { ignoreBlockId: value.blockId });
    if (conflict) {
      setPlacementError(`${formatClock(conflict.startMinutes)} ${conflict.title}과 시간이 겹칩니다.`);
      return;
    }

    let taskId = value.taskId;
    if (value.mode === 'new-task') {
      taskId = addTask({
        title: value.title,
        outcomeId: value.outcomeId,
        estimateMinutes: value.durationMinutes
      });
      if (!taskId) {
        setPlacementError('새 할 일을 만들지 못했습니다. 입력 내용을 확인해 주세요.');
        return;
      }
    }

    if (!saveTimeBlock({
      id: value.blockId,
      taskId: value.mode === 'event' ? null : taskId,
      title: value.title,
      day: value.day,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      weekOffset: plannerWeekOffset
    })) {
      setPlacementError('다른 일정과 시간이 겹칩니다. 날짜나 시간을 바꿔주세요.');
      return;
    }
    setPlacementDraft(null);
    setPlacementError('');
    showNotice(`${value.title}을 ${formatClock(value.startMinutes)}에 추가했어요.`);
  };

  const deleteBlockDraft = () => {
    if (!placementDraft?.blockId || !removeTimeBlock(placementDraft.blockId)) return;
    setPlacementDraft(null);
    setPlacementError('');
    showNotice('일정에서 삭제했어요. 연결된 할 일은 그대로 남아 있습니다.');
  };

  useEffect(() => {
    if (!queryAction || !queryTaskId) return;
    const task = tasks.find((item) => item.id === queryTaskId);
    if (!task) return;
    if (queryAction === 'split') {
      setAddTitle(`${task.title} — 1단계`);
      setAddOutcomeId(task.outcomeId ?? '');
      setAddEstimate(String(getSplitEstimate(task.estimateMinutes)));
      setAddOpen(true);
    }
    if (queryAction === 'reschedule') {
      openPlacement(task, 'mon', defaultPlacementStart, 'existing-task');
    }
    setSearchParams({}, { replace: true });
  }, [queryAction, queryTaskId, setSearchParams, tasks]);

  const onDrop = (event: DragEvent<HTMLButtonElement>, day: DayKey, startMinutes: number) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/planner-task');
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const placed = placeTask(task, day, startMinutes, task.estimateMinutes);
    if (!placed) showNotice(`${task.title}은 다른 일정과 겹쳐 배치하지 않았어요.`);
  };

  return (
    <div className="page page--planner planner-nowline">
      <header className="page-header page-header--compact planner-header">
        <div>
          <p className="eyebrow" aria-live="polite">주간 Planner · {getWeekLabel(plannerWeekOffset)}</p>
          <h1>이번 주 할 일과 일정을 함께 봅니다.</h1>
          <p className="page-header__description">목표 연결은 선택입니다. 할 일만 적거나 일정만 만들어도 바로 저장됩니다.</p>
        </div>
        <div className="week-switcher" aria-label="주 변경">
          <button className="icon-button" type="button" aria-label="이전 주" onClick={() => setPlannerWeekOffset(plannerWeekOffset - 1)}><ChevronLeft size={19} /></button>
          <button className="button button--secondary button--small" type="button" onClick={() => setPlannerWeekOffset(0)}>
            {plannerWeekOffset === 0 ? '이번 주' : '이번 주로'}
          </button>
          <button className="icon-button" type="button" aria-label="다음 주" onClick={() => setPlannerWeekOffset(plannerWeekOffset + 1)}><ChevronRight size={19} /></button>
        </div>
      </header>

      {plannerWeekOffset === 1 && review.selectedTopTaskIds.length > 0 && (
        <div className="next-week-priority" role="status">
          <Sparkles size={17} />
          <span><strong>회고에서 고른 다음 주 Top 3를 먼저 보여드려요.</strong> 이제 시간을 배치하면 계획이 완성됩니다.</span>
        </div>
      )}

      <section className="planner-capacity-toolbar" aria-label="주간 계획 도구">
        <div className="planner-capacity-toolbar__capacity">
          <div className="planning-number">
            <span>계획 / 가용</span>
            <strong>{plannedHours.toFixed(1)}<small> / {availableHours.toFixed(0)}시간</small></strong>
          </div>
          <CapacityBar used={plannedHours} total={availableHours} label="계획된 주간 용량" />
          <span className={clsx('capacity-percent', capacityPercentage >= 85 && 'capacity-percent--warning')}>
            {capacityPercentage}%
          </span>
        </div>

        {outcomes.length > 0 ? (
          <div className={clsx('capacity-warning', requiredHours > availableHours && 'capacity-warning--danger')}>
            <AlertTriangle size={18} />
            <div>
              <strong>목표 결과에 {requiredHours.toFixed(0)}시간 필요</strong>
              <span>
                {requiredHours > availableHours
                  ? `${(requiredHours - availableHours).toFixed(0)}시간 초과 · 우선순위를 줄여야 합니다.`
                  : '현재 가용 시간 안에서 실행할 수 있습니다.'}
              </span>
            </div>
            <Link to="/goals">목표 보기 <ArrowRight size={15} /></Link>
          </div>
        ) : (
          <div className="capacity-warning capacity-warning--freeform">
            <CalendarRange size={18} />
            <div>
              <strong>목표 없이 바로 시작할 수 있어요.</strong>
              <span>일반 Todo와 개인 일정도 같은 화면에서 관리합니다.</span>
            </div>
            <button type="button" onClick={() => openAddTask()}>할 일 추가 <ArrowRight size={15} /></button>
          </div>
        )}

        <div className="planner-capacity-toolbar__actions">
          <button
            className="button button--secondary button--small"
            type="button"
            onClick={() => showNotice(carryoverCount > 0 ? `${carryoverCount}개 이월 작업을 먼저 확인하세요.` : '확인할 이월 작업이 없습니다.')}
          >
            이월 {carryoverCount}
          </button>
          <button
            className="button button--primary button--small"
            type="button"
            onClick={() => showNotice('이번 주 계획을 확인했어요. Today에서 첫 실행을 시작하세요.')}
          >
            <Check size={15} /> 계획 확정
          </button>
        </div>
      </section>

      <div
        className="planner-workspace planner-workspace--outcomes"
        style={{ '--planner-context-width': '296px' } as CSSProperties}
      >
        <aside className="backlog-panel backlog-panel--context" aria-label="내 할 일">
          <details className="backlog-panel__disclosure" open>
            <summary>
              <span>
                <span className="eyebrow">TODO</span>
                <strong>내 할 일</strong>
              </span>
              <span className="count-badge">{tasks.filter((task) => task.status !== 'cancelled').length}</span>
            </summary>

            <div className="backlog-panel__controls">
              <p className="backlog-panel__guide"><GripVertical size={14} /> 끌어서 배치하거나 제목을 눌러 시간을 정하세요.</p>
              <button type="button" onClick={() => setShowCompleted((value) => !value)}>
                {showCompleted ? '완료 숨기기' : `완료 보기 ${tasks.filter((task) => task.status === 'done').length}`}
              </button>
            </div>

            <div className="backlog-groups">
              {byOutcome.map(([outcomeId, groupTasks]) => {
                const outcome = outcomes.find((item) => item.id === outcomeId);
                return (
                  <section key={outcomeId} className="backlog-group">
                    <header>
                      <span className="outcome-dot" />
                      <strong>{outcome?.title ?? '연결되지 않은 할 일'}</strong>
                      <span>{formatMinutes(groupTasks.reduce((sum, task) => sum + task.estimateMinutes, 0))}</span>
                    </header>
                    {groupTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        draggable
                        compact
                        outcomeTitle={outcome?.title}
                        onSelect={() => task.status === 'done' ? openEditTask(task) : openPlacement(task)}
                        onToggleDone={() => updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}
                        onEdit={() => openEditTask(task)}
                        onDelete={() => setDeleteTaskCandidate(task)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/planner-task', task.id);
                        }}
                      />
                    ))}
                  </section>
                );
              })}
              {byOutcome.length === 0 && (
                <div className="backlog-empty">
                  <Sparkles size={21} />
                  <strong>표시할 할 일이 없습니다.</strong>
                  <span>아래에서 새 할 일을 만들거나 완료 항목을 확인하세요.</span>
                </div>
              )}
            </div>
            <button className="button button--ghost button--full" type="button" onClick={() => openAddTask()}>
              <Plus size={17} /> 새 할 일
            </button>
          </details>
        </aside>

        <section className="outcome-planner" aria-label="주간 결과와 시간 배치표">
          <header className="calendar-panel__toolbar outcome-planner__toolbar">
            <div><CalendarRange size={17} /> 7일 결과 / 시간</div>
            <div className="calendar-legend" aria-label="시간 블록 범례">
              <span><i className="legend-dot legend-dot--focus" />계획</span>
              <span><i className="legend-dot legend-dot--external" />외부 일정 · 읽기 전용</span>
              <span><i className="legend-dot legend-dot--drop" />배치 가능</span>
            </div>
          </header>

          <p className="horizontal-scroll-hint" id="planner-scroll-hint">표를 좌우로 밀어 요일별 계획을 확인하세요.</p>
          <div className="outcome-grid-scroll" tabIndex={0} aria-describedby="planner-scroll-hint">
            <div className="outcome-grid" role="table" aria-label="목표 결과별 7일 시간표">
              <div className="outcome-grid__row outcome-grid__row--head" role="row">
                <div className="outcome-grid__corner" role="columnheader">
                  <span>분류</span>
                  <strong>할 일 / 일정</strong>
                </div>
                {weekDays.map((day) => (
                  <div
                    key={day.key}
                    className={clsx('outcome-grid__day-header', plannerWeekOffset === 0 && day.key === 'mon' && 'is-today')}
                    role="columnheader"
                  >
                    <span>{day.short}요일</span>
                    <strong>{day.date}</strong>
                  </div>
                ))}
              </div>

              <div className="outcome-grid__row outcome-grid__row--external" role="row">
                <div className="outcome-lane-head outcome-lane-head--external" role="rowheader">
                  <span><Lock size={13} /> 외부 일정</span>
                  <small>읽기 전용</small>
                </div>
                {weekDays.map((day) => {
                  const externalBlocks = weekBlocks.filter((block) => block.day === day.key && block.external);
                  return (
                    <div key={day.key} className="outcome-day-cell outcome-day-cell--external" role="cell">
                      {externalBlocks.map((block) => (
                        <article key={block.id} className="outcome-time-block outcome-time-block--external">
                          <span><Lock size={11} /> {formatClock(block.startMinutes)}</span>
                          <strong>{block.title}</strong>
                          <small>{formatMinutes(block.durationMinutes)}</small>
                        </article>
                      ))}
                      {externalBlocks.length === 0 && <span className="outcome-day-cell__empty">—</span>}
                    </div>
                  );
                })}
              </div>

              {lanes.map((lane) => {
                const isCalendarLane = lane.id === 'calendar';
                const requiredMinutes = lane.neededHours * 60;
                const allocationRatio = requiredMinutes > 0 ? lane.plannedMinutes / requiredMinutes : 0;
                const shortageMinutes = Math.max(0, requiredMinutes - lane.plannedMinutes);
                return (
                  <div key={lane.id} className="outcome-grid__row outcome-grid__row--lane" role="row">
                    <div className="outcome-lane-head" role="rowheader">
                      <span className="outcome-lane-head__parent">{lane.parentTitle}</span>
                      <strong>{lane.title}</strong>
                      {isCalendarLane ? (
                        <p className="outcome-lane-head__freeform">약속, 이동, 휴식처럼 할 일이 아닌 일정</p>
                      ) : (
                        <>
                          <dl className="outcome-lane-head__metrics">
                            <div><dt>필요</dt><dd>{lane.neededHours.toFixed(0)}h</dd></div>
                            <div><dt>계획</dt><dd>{formatMinutes(lane.plannedMinutes)}</dd></div>
                            <div><dt>실제</dt><dd>{lane.actualHours.toFixed(0)}h</dd></div>
                          </dl>
                          <div className="outcome-lane-head__signal">
                            <span><i style={{ width: `${Math.min(100, allocationRatio * 100)}%` }} /></span>
                            <small className={shortageMinutes > 0 ? 'is-short' : 'is-ready'}>
                              {shortageMinutes > 0 ? `${formatMinutes(shortageMinutes)} 부족` : '필요 시간 확보'}
                            </small>
                          </div>
                        </>
                      )}
                    </div>

                    {weekDays.map((day) => {
                      const blocks = weekBlocks.filter((block) => {
                        if (block.external || block.day !== day.key) return false;
                        if (isCalendarLane) return block.taskId === null;
                        if (!block.taskId) return false;
                        return (taskById.get(block.taskId)?.outcomeId ?? 'inbox') === lane.id;
                      });
                      return (
                        <div key={day.key} className={clsx('outcome-day-cell', plannerWeekOffset === 0 && day.key === 'mon' && 'is-today')} role="cell">
                          {blocks.map((block) => (
                            <button
                              key={block.id}
                              type="button"
                              className={clsx('outcome-time-block', isCalendarLane && 'outcome-time-block--event')}
                              aria-label={`${block.title}, ${formatClock(block.startMinutes)}, 일정 수정`}
                              onClick={() => openBlock(block)}
                            >
                              <span><Clock3 size={11} /> {formatClock(block.startMinutes)}</span>
                              <strong>{block.title}</strong>
                              <small>{formatMinutes(block.durationMinutes)}</small>
                            </button>
                          ))}
                          <button
                            className={clsx('outcome-drop-target', blocks.length === 0 && 'outcome-drop-target--empty')}
                            type="button"
                            aria-label={`${day.short}요일 ${formatClock(defaultPlacementStart)}에 할 일 또는 일정 추가`}
                            onClick={() => openPlacement(
                              null,
                              day.key,
                              defaultPlacementStart,
                              isCalendarLane ? 'event' : 'new-task'
                            )}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => onDrop(event, day.key, defaultPlacementStart)}
                          >
                            <Plus size={13} /> {blocks.length === 0 ? '추가' : '하나 더'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <section className="allocation-strip allocation-signals" aria-label="목표별 시간 배분">
        <div className="allocation-strip__title">
          <span className="eyebrow">배분 신호</span>
          <strong>결과별 이번 주 판단</strong>
        </div>
        <div className="allocation-strip__items allocation-signals__items">
          {lanes.filter((lane) => lane.id !== 'calendar').slice(0, 4).map((lane) => {
            const neededMinutes = lane.neededHours * 60;
            const ratio = neededMinutes > 0 ? lane.plannedMinutes / neededMinutes : 0;
            const state = ratio >= 1 ? 'ready' : ratio >= 0.7 ? 'tight' : 'short';
            return (
              <div key={lane.id} className={`allocation-item allocation-item--${state}`}>
                <span>{lane.title}</span>
                <strong>{formatMinutes(lane.plannedMinutes)} / {lane.neededHours.toFixed(0)}h</strong>
                <div><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                <small>{state === 'ready' ? '충분' : state === 'tight' ? '주의' : '부족'}</small>
              </div>
            );
          })}
        </div>
      </section>

      {notice && <div className="toast" role="status"><Clock3 size={17} /> {notice}</div>}

      {placementDraft && (
        <TimeBlockSheet
          key={`${placementDraft.blockId ?? 'new'}-${placementDraft.taskId}-${placementDraft.day}-${placementDraft.startMinutes}`}
          tasks={tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled')}
          outcomes={outcomes}
          days={weekDays}
          initialBlockId={placementDraft.blockId}
          initialTaskId={placementDraft.taskId}
          initialTitle={placementDraft.title}
          initialDay={placementDraft.day}
          initialStartMinutes={placementDraft.startMinutes}
          initialDurationMinutes={placementDraft.durationMinutes}
          initialMode={placementDraft.mode}
          error={placementError}
          onClose={() => {
            setPlacementDraft(null);
            setPlacementError('');
          }}
          onSave={saveBlockDraft}
          onDelete={placementDraft.blockId ? deleteBlockDraft : undefined}
        />
      )}

      {addOpen && (
        <Modal
          title={editingTask ? '할 일 수정' : '새 할 일'}
          description="목표 연결은 선택입니다. 일반 Todo처럼 제목만 입력해도 저장됩니다."
          onClose={() => {
            setAddOpen(false);
            setEditingTask(null);
          }}
        >
          <form onSubmit={submitTask}>
            <div className="form-grid">
              <label className="field">
                  <span className="field-label">할 일</span>
                <input
                  data-autofocus
                  value={addTitle}
                  onChange={(event) => setAddTitle(event.target.value)}
                  placeholder="예: 실패 흐름을 세 단계로 나누기"
                  required
                />
              </label>
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span className="field-label">목표 연결 <small>선택</small></span>
                  <select value={addOutcomeId} onChange={(event) => setAddOutcomeId(event.target.value)}>
                    <option value="">연결하지 않음 · 수집함</option>
                    {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">예상 시간</span>
                  <select value={addEstimate} onChange={(event) => setAddEstimate(event.target.value)}>
                    {estimateOptions.map((minutes) => (
                      <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">메모 <small>선택</small></span>
                <textarea
                  rows={3}
                  value={addNote}
                  onChange={(event) => setAddNote(event.target.value)}
                  placeholder="필요한 링크나 간단한 내용을 남겨보세요."
                />
              </label>
            </div>
            <div className="modal__actions">
              <button className="button button--secondary" type="button" onClick={() => {
                setAddOpen(false);
                setEditingTask(null);
              }}>취소</button>
              <button className="button button--primary" type="submit" disabled={!addTitle.trim()}>
                {editingTask ? '변경 저장' : '할 일 추가'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTaskCandidate && (
        <Modal
          title="할 일을 삭제할까요?"
          description="연결된 시간 블록과 실행 기록도 함께 삭제됩니다."
          onClose={() => setDeleteTaskCandidate(null)}
        >
          <p className="delete-task-summary"><strong>{deleteTaskCandidate.title}</strong></p>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setDeleteTaskCandidate(null)}>취소</button>
            <button className="button button--delete" type="button" onClick={() => {
              removeTask(deleteTaskCandidate.id);
              showNotice(`${deleteTaskCandidate.title}을 삭제했어요.`);
              setDeleteTaskCandidate(null);
            }}>삭제</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
