import { tr, useLocale } from '../i18n';
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
import { SubtaskEditor, SubtaskProgress } from '../components/SubtaskEditor';
import { MonthCalendar } from '../components/MonthCalendar';
import { validSubtasks } from '../domain/subtasks';
import type { Subtask } from '../domain/types';
import type { DayKey, Task, TimeBlock } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import { addLocalDateDays, getDayKeyForDate, getToday, getWeekDays, getWeekOffsetForDate, getWeekStartDate, toLocalDate } from '../lib/calendarDate';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { TodayScreen } from './TodayScreen';

const defaultPlacementStart = 1020;
const estimateOptions = [15, 25, 40, 60, 90, 120];

export const isActualToday = (date: string, today = toLocalDate()) => date === today;

interface PlannerBlockDraft {
  blockId?: string;
  taskId: string;
  title: string;
  day: DayKey;
  date?: string;
  startMinutes: number;
  durationMinutes: number;
  mode?: TimeBlockMode;
  /** True only when Review explicitly sent this task through the carryover path. */
  explicitCarryover?: boolean;
}

function getWeekLabel(days: ReturnType<typeof getWeekDays>) {
  const first = days[0];
  const last = days[days.length - 1];
  const start = tr("{{v0}}월 {{v1}}일", { v0: first.month, v1: first.date });
  const end = first.month === last.month ? tr("{{v0}}일", { v0: last.date }) : tr("{{v0}}월 {{v1}}일", { v0: last.month, v1: last.date });
  return `${start} – ${end}`;
}

function getSplitEstimate(durationMinutes: number) {
  const target = durationMinutes / 2;
  return estimateOptions.reduce((closest, option) => (
    Math.abs(option - target) < Math.abs(closest - target) ? option : closest
  ));
}

export function GoalPlannerScreen() {
  const language = useLocale();
  const { timeZone } = useTimeZone();
  const {
    tasks,
    outcomes,
    timeBlocks,
    review,
    plannerWeekOffset,
    addTask,
    updateTask,
    removeTask,
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
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [monthSelectedDate, setMonthSelectedDate] = useState(() => toLocalDate(new Date(), timeZone));
  const [addTitle, setAddTitle] = useState('');
  const [addOutcomeId, setAddOutcomeId] = useState('');
  const [addEstimate, setAddEstimate] = useState('25');
  const [addNote, setAddNote] = useState('');
  const [addSubtasks, setAddSubtasks] = useState<Subtask[]>([]);
  const queryAction = searchParams.get('action');
  const queryTaskId = searchParams.get('task');

  const weekDays = useMemo(
    () => getWeekDays(plannerWeekOffset, new Date(), timeZone),
    [plannerWeekOffset, timeZone, language]
  );
  const weekDateSet = useMemo(() => new Set(weekDays.map((day) => day.isoDate)), [weekDays]);
  const weekBlocks = useMemo(
    () => timeBlocks.filter((block) => weekDateSet.has(block.date)),
    [timeBlocks, weekDateSet]
  );
  const comparableWeekBlocks = useMemo(
    () => weekBlocks.map((block) => ({ ...block, weekOffset: plannerWeekOffset })),
    [plannerWeekOffset, weekBlocks]
  );
  const actualToday = toLocalDate(new Date(), timeZone);
  // Legacy wire fields are bounded to +/- 520 weeks, even though dates are authoritative.
  const calendarMinDate = addLocalDateDays(getWeekStartDate(actualToday), -520 * 7);
  const calendarMaxDate = addLocalDateDays(getWeekStartDate(actualToday), 520 * 7 + 6);

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
        title: tr("연결되지 않은 할 일"),
        parentTitle: tr("수집함"),
        neededHours: inboxTasks.reduce((sum, task) => sum + task.estimateMinutes / 60, 0),
        actualHours: 0,
        plannedMinutes
      });
    }

    rows.push({
      id: 'calendar',
      title: tr("개인 일정"),
      parentTitle: tr("목표 없이"),
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
    day: DayKey = getToday(new Date(), timeZone).key,
    startMinutes = defaultPlacementStart,
    mode?: TimeBlockMode,
    explicitCarryover = false
  ) => {
    setPlacementDraft({
      taskId: task?.id ?? '',
      title: task?.title ?? '',
      day: calendarView === 'month' ? getDayKeyForDate(monthSelectedDate) : day,
      ...(calendarView === 'month' ? { date: monthSelectedDate } : {}),
      startMinutes,
      durationMinutes: task?.estimateMinutes ?? 30,
      mode,
      explicitCarryover
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
      ...(calendarView === 'month' ? { date: block.date } : {}),
      startMinutes: block.startMinutes,
      durationMinutes: block.durationMinutes,
      mode: block.taskId ? 'existing-task' : 'event'
    });
    setPlacementError('');
  };

  const openMonthDate = (date: string) => {
    setPlacementDraft({ taskId: '', title: '', date, day: getDayKeyForDate(date), startMinutes: defaultPlacementStart, durationMinutes: 30, mode: 'event' });
    setPlacementError('');
  };

  const openAddTask = (sourceTask?: Task) => {
    setEditingTask(null);
    setAddTitle(sourceTask ? tr("{{v0}} — 1단계", { v0: sourceTask.title }) : '');
    setAddOutcomeId(sourceTask?.outcomeId ?? '');
    setAddEstimate(sourceTask ? String(getSplitEstimate(sourceTask.estimateMinutes)) : '25');
    setAddNote('');
    setAddSubtasks([]);
    setAddOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setAddTitle(task.title);
    setAddOutcomeId(task.outcomeId ?? '');
    setAddEstimate(String(task.estimateMinutes));
    setAddNote(task.note ?? '');
    setAddSubtasks(task.subtasks ?? []);
    setAddOpen(true);
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2400);
  };

  const findConflict = (
    day: DayKey,
    startMinutes: number,
    durationMinutes: number
  ) => findTimeBlockConflict(comparableWeekBlocks, {
    day,
    startMinutes,
    durationMinutes,
    weekOffset: plannerWeekOffset
  });

  const placeTask = (task: Task, day: DayKey, startMinutes: number, durationMinutes: number) => {
    const conflict = findConflict(day, startMinutes, durationMinutes);
    if (conflict) {
      const message = tr("{{v0}} {{v1}}과 시간이 겹칩니다.", { v0: formatClock(conflict.startMinutes), v1: conflict.title });
      setPlacementError(message);
      return false;
    }
    const targetDate = weekDays.find((item) => item.key === day)?.isoDate;
    const saved = Boolean(targetDate) && saveTimeBlock({
      taskId: task.id,
      title: task.title,
      day,
      startMinutes,
      durationMinutes,
      date: targetDate,
      weekOffset: plannerWeekOffset
    });
    if (saved === false) {
      setPlacementError(tr("다른 일정과 시간이 겹칩니다. 날짜나 시작 시간을 바꿔주세요."));
      return false;
    }
    setPlacementError('');
    showNotice(tr("{{v0}} · {{v1}}에 배치했어요.", { v0: task.title, v1: formatClock(startMinutes) }));
    return true;
  };

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    if (!addTitle.trim() || !validSubtasks(addSubtasks)) return;
    if (editingTask) {
      const saved = updateTask(editingTask.id, {
        title: addTitle,
        outcomeId: addOutcomeId || null,
        estimateMinutes: Number(addEstimate),
        note: addNote,
        subtasks: addSubtasks
      });
      if (!saved) { showNotice(tr("수정하지 못했습니다. 입력 내용과 동기화 상태를 확인해 주세요.")); return; }
      showNotice(tr("{{v0}}을 수정했어요.", { v0: addTitle.trim() }));
    } else {
      const taskId = addTask({
        title: addTitle.trim(),
        outcomeId: addOutcomeId || null,
        estimateMinutes: Number(addEstimate),
        subtasks: addSubtasks
      });
      if (!taskId) { showNotice(tr("할 일을 만들지 못했습니다. 입력 내용을 확인해 주세요.")); return; }
      if (taskId && addNote.trim()) updateTask(taskId, { note: addNote });
      showNotice(tr("{{v0}}을 할 일에 추가했어요.", { v0: addTitle.trim() }));
    }
    setAddOpen(false);
    setEditingTask(null);
  };

  const saveBlockDraft = (value: TimeBlockEditorValue) => {
    const date = value.date ?? weekDays.find((day) => day.key === value.day)?.isoDate;
    if (!date || date < calendarMinDate || date > calendarMaxDate) {
      setPlacementError(tr("저장 가능한 날짜 범위를 벗어났습니다. 날짜를 다시 선택해 주세요.")); return;
    }
    const weekOffset = getWeekOffsetForDate(date, new Date(), timeZone);
    const day = getDayKeyForDate(date);
    const currentBlock = timeBlocks.find((block) => block.id === value.blockId);
    const sameSlot = currentBlock && currentBlock.taskId === value.taskId && currentBlock.date === date
      && currentBlock.startMinutes === value.startMinutes && currentBlock.durationMinutes === value.durationMinutes;
    const conflict = findTimeBlockConflict(timeBlocks.filter(block => block.date === date).map(block => ({ ...block, day, weekOffset })), {
      day,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      weekOffset
    }, { ignoreBlockId: value.blockId });
    if (conflict && !sameSlot) {
      setPlacementError(tr("{{v0}} {{v1}}과 시간이 겹칩니다.", { v0: formatClock(conflict.startMinutes), v1: conflict.title }));
      return;
    }

    let taskId = value.taskId;
    if (value.mode === 'new-task') {
      taskId = addTask({
        title: value.title,
        outcomeId: value.outcomeId,
        estimateMinutes: value.durationMinutes,
        subtasks: value.subtasks
      });
      if (!taskId) {
        setPlacementError(tr("새 할 일을 만들지 못했습니다. 입력 내용을 확인해 주세요."));
        return;
      }
    }

    if (!saveTimeBlock({
      id: value.blockId,
      taskId: value.mode === 'event' ? null : taskId,
      title: value.title,
      day,
      startMinutes: value.startMinutes,
      durationMinutes: value.durationMinutes,
      date,
      weekOffset,
      incrementCarryCount: placementDraft?.explicitCarryover === true,
      ...(value.mode === 'existing-task' ? { taskPatch: value.taskPatch ?? {} } : {})
    })) {
      if (value.mode === 'new-task' && taskId) removeTask(taskId);
      setPlacementError(tr("다른 일정과 시간이 겹칩니다. 날짜나 시간을 바꿔주세요."));
      return;
    }
    setPlacementDraft(null);
    setPlacementError('');
    showNotice(tr("{{v0}}을 {{v1}} {{v2}}에 {{v3}}했어요.", { v0: value.title, v1: date, v2: formatClock(value.startMinutes), v3: value.blockId ? tr('수정') : tr('추가') }));
  };

  const deleteBlockDraft = () => {
    if (!placementDraft?.blockId || !removeTimeBlock(placementDraft.blockId)) return;
    setPlacementDraft(null);
    setPlacementError('');
    showNotice(tr("일정에서 삭제했어요. 연결된 할 일은 그대로 남아 있습니다."));
  };

  useEffect(() => {
    if (!queryAction || !queryTaskId) return;
    const task = tasks.find((item) => item.id === queryTaskId);
    if (!task) return;
    if (queryAction === 'split') {
      setEditingTask(null);
      setAddSubtasks([]);
      setAddNote('');
      setAddTitle(tr("{{v0}} — 1단계", { v0: task.title }));
      setAddOutcomeId(task.outcomeId ?? '');
      setAddEstimate(String(getSplitEstimate(task.estimateMinutes)));
      setAddOpen(true);
    }
    if (queryAction === 'reschedule') {
      openPlacement(task, 'mon', defaultPlacementStart, 'existing-task', true);
    }
    setSearchParams({}, { replace: true });
  }, [queryAction, queryTaskId, setSearchParams, tasks]);

  const onDrop = (event: DragEvent<HTMLButtonElement>, day: DayKey, startMinutes: number) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/planner-task');
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const placed = placeTask(task, day, startMinutes, task.estimateMinutes);
    if (!placed) showNotice(tr("{{v0}}은 다른 일정과 겹쳐 배치하지 않았어요.", { v0: task.title }));
  };

  return (
    <div className="page page--planner planner-nowline">
      <header className="page-header page-header--compact planner-header">
        <div>
          <p className="eyebrow" aria-live="polite">{calendarView === 'week' ? tr("주간 Planner · {{v0}}", { v0: getWeekLabel(weekDays) }) : tr("월간 Planner")}</p>
          <h1>{calendarView === 'week' ? tr("이번 주 할 일과 일정을 함께 봅니다.") : tr("한 달의 일정을 한눈에 봅니다.")}</h1>
          <p className="page-header__description">{tr("목표 연결은 선택입니다. 할 일만 적거나 일정만 만들어도 바로 저장됩니다.")}</p>
        </div>
        {calendarView === 'week' && <div className="week-switcher" aria-label={tr("주 변경")}>
          <button className="icon-button" type="button" aria-label={tr("이전 주")} onClick={() => setPlannerWeekOffset(plannerWeekOffset - 1)}><ChevronLeft size={19} /></button>
          <button className="button button--secondary button--small" type="button" onClick={() => setPlannerWeekOffset(0)}>
            {plannerWeekOffset === 0 ? tr("이번 주") : tr("이번 주로")}
          </button>
          <button className="icon-button" type="button" aria-label={tr("다음 주")} onClick={() => setPlannerWeekOffset(plannerWeekOffset + 1)}><ChevronRight size={19} /></button>
        </div>}
      </header>

      <div className="planner-view-switch" role="group" aria-label={tr("일정 보기 방식")}><button type="button" aria-pressed={calendarView === 'week'} onClick={() => setCalendarView('week')}>{tr("주간")}</button><button type="button" aria-pressed={calendarView === 'month'} onClick={() => { if (calendarView !== 'month') setMonthSelectedDate(plannerWeekOffset === 0 ? actualToday : weekDays[0].isoDate); setCalendarView('month'); }}>{tr("월간")}</button></div>

      {calendarView === 'week' && plannerWeekOffset === 1 && review.selectedTopTaskIds.length > 0 && (
        <div className="next-week-priority" role="status">
          <Sparkles size={17} />
          <span><strong>{tr("회고에서 고른 다음 주 Top 3를 먼저 보여드려요.")}</strong> {' '}{tr("이제 시간을 배치하면 계획이 완성됩니다.")}</span>
        </div>
      )}

      {calendarView === 'week' && <section className="planner-capacity-toolbar" aria-label={tr("주간 계획 도구")}>
        <div className="planner-capacity-toolbar__capacity">
          <div className="planning-number">
            <span>{availableHours > 0 ? tr("계획 / 가용") : tr("계획한 시간")}</span>
            <strong>{plannedHours.toFixed(1)}<small>{availableHours > 0 ? tr(" / {{v0}}시간", { v0: availableHours.toFixed(0) }) : tr("시간")}</small></strong>
          </div>
          {availableHours > 0 ? <><CapacityBar used={plannedHours} total={availableHours} label={tr("계획된 주간 용량")} /><span className={clsx('capacity-percent', capacityPercentage >= 85 && 'capacity-percent--warning')}>{capacityPercentage}%</span></> : <span className="field-help">{tr("가용 시간 미설정 · 계획한 시간만 표시합니다.")}</span>}
        </div>

        {outcomes.length > 0 ? (
          <div className={clsx('capacity-warning', requiredHours > availableHours && 'capacity-warning--danger')}>
            <AlertTriangle size={18} />
            <div>
              <strong>{tr("목표 결과에")}{' '}{requiredHours.toFixed(0)}{tr("시간 필요")}</strong>
              <span>
                {requiredHours > availableHours
                  ? tr("{{v0}}시간 초과 · 우선순위를 줄여야 합니다.", { v0: (requiredHours - availableHours).toFixed(0) })
                  : tr("현재 가용 시간 안에서 실행할 수 있습니다.")}
              </span>
            </div>
            <Link to="/goals">{tr("목표 보기")}{' '}<ArrowRight size={15} /></Link>
          </div>
        ) : (
          <div className="capacity-warning capacity-warning--freeform">
            <CalendarRange size={18} />
            <div>
              <strong>{tr("목표 없이 바로 시작할 수 있어요.")}</strong>
              <span>{tr("일반 Todo와 개인 일정도 같은 화면에서 관리합니다.")}</span>
            </div>
            <button type="button" onClick={() => openAddTask()}>{tr("할 일 추가")}{' '}<ArrowRight size={15} /></button>
          </div>
        )}

        <div className="planner-capacity-toolbar__actions">
          <button
            className="button button--secondary button--small"
            type="button"
            onClick={() => showNotice(carryoverCount > 0 ? tr("{{v0}}개 이월 작업을 먼저 확인하세요.", { v0: carryoverCount }) : tr("확인할 이월 작업이 없습니다."))}
          >
            {tr("이월")}{carryoverCount}
          </button>
          <Link
            className="button button--primary button--small"
            to="/today"
          >
            <Check size={15} /> {tr("오늘 실행 보기")}</Link>
        </div>
      </section>}

      <div
        className={clsx('planner-workspace planner-workspace--outcomes', calendarView === 'month' && 'planner-workspace--month')}
        style={{ '--planner-context-width': '296px' } as CSSProperties}
      >
        <aside className="backlog-panel backlog-panel--context" aria-label={tr("내 할 일")}>
          <details className="backlog-panel__disclosure" open>
            <summary>
              <span>
                <span className="eyebrow">{tr("TODO")}</span>
                <strong>{tr("내 할 일")}</strong>
              </span>
              <span className="count-badge">{tasks.filter((task) => task.status !== 'cancelled').length}</span>
            </summary>

            <div className="backlog-panel__controls">
              <p className="backlog-panel__guide"><GripVertical size={14} /> {calendarView === 'month' ? tr("날짜를 고른 뒤 할 일 제목을 눌러 시간을 정하세요.") : tr("끌어서 배치하거나 제목을 눌러 시간을 정하세요.")}</p>
              <button type="button" onClick={() => setShowCompleted((value) => !value)}>
                {showCompleted ? tr("완료 숨기기") : tr("완료 보기 {{v0}}", { v0: tasks.filter((task) => task.status === 'done').length })}
              </button>
            </div>

            <div className="backlog-groups">
              {byOutcome.map(([outcomeId, groupTasks]) => {
                const outcome = outcomes.find((item) => item.id === outcomeId);
                return (
                  <section key={outcomeId} className="backlog-group">
                    <header>
                      <span className="outcome-dot" />
                      <strong>{outcome?.title ?? tr("연결되지 않은 할 일")}</strong>
                      <span>{formatMinutes(groupTasks.reduce((sum, task) => sum + task.estimateMinutes, 0))}</span>
                    </header>
                    {groupTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        draggable={calendarView === 'week'}
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
                  <strong>{tr("표시할 할 일이 없습니다.")}</strong>
                  <span>{tr("아래에서 새 할 일을 만들거나 완료 항목을 확인하세요.")}</span>
                </div>
              )}
            </div>
            <button className="button button--ghost button--full" type="button" onClick={() => openAddTask()}>
              <Plus size={17} /> {tr("새 할 일")}</button>
          </details>
        </aside>

        {calendarView === 'month' ? <MonthCalendar today={actualToday} initialDate={monthSelectedDate} blocks={timeBlocks} minDate={calendarMinDate} maxDate={calendarMaxDate} onSelectDate={setMonthSelectedDate} onAdd={openMonthDate} onEdit={openBlock} /> : <section className="outcome-planner" aria-label={tr("주간 결과와 시간 배치표")}>
          <header className="calendar-panel__toolbar outcome-planner__toolbar">
            <div><CalendarRange size={17} /> {' '}{tr("7일 결과 / 시간")}</div>
            <div className="calendar-legend" aria-label={tr("시간 블록 범례")}>
              <span><i className="legend-dot legend-dot--focus" />{tr("계획")}</span>
              <span><i className="legend-dot legend-dot--external" />{tr("외부 일정 · 읽기 전용")}</span>
              <span><i className="legend-dot legend-dot--drop" />{tr("배치 가능")}</span>
            </div>
          </header>

          <p className="horizontal-scroll-hint" id="planner-scroll-hint">{tr("표를 좌우로 밀어 요일별 계획을 확인하세요.")}</p>
          <div className="outcome-grid-scroll" tabIndex={0} aria-describedby="planner-scroll-hint">
            <div className="outcome-grid" role="table" aria-label={tr("목표 결과별 7일 시간표")}>
              <div className="outcome-grid__row outcome-grid__row--head" role="row">
                <div className="outcome-grid__corner" role="columnheader">
                  <span>{tr("분류")}</span>
                  <strong>{tr("할 일 / 일정")}</strong>
                </div>
                {weekDays.map((day) => (
                  <div
                    key={day.key}
                    className={clsx('outcome-grid__day-header', isActualToday(day.isoDate, actualToday) && 'is-today')}
                    role="columnheader"
                  >
                    <span>{day.short}{tr("요일")}</span>
                    <strong>{day.date}</strong>
                  </div>
                ))}
              </div>

              <div className="outcome-grid__row outcome-grid__row--external" role="row">
                <div className="outcome-lane-head outcome-lane-head--external" role="rowheader">
                  <span><Lock size={13} /> {' '}{tr("외부 일정")}</span>
                  <small>{tr("읽기 전용")}</small>
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
                        <p className="outcome-lane-head__freeform">{tr("약속, 이동, 휴식처럼 할 일이 아닌 일정")}</p>
                      ) : (
                        <>
                          <dl className="outcome-lane-head__metrics">
                            <div><dt>{tr("필요")}</dt><dd>{lane.neededHours.toFixed(0)}h</dd></div>
                            <div><dt>{tr("계획")}</dt><dd>{formatMinutes(lane.plannedMinutes)}</dd></div>
                            <div><dt>{tr("실제")}</dt><dd>{lane.actualHours.toFixed(0)}h</dd></div>
                          </dl>
                          <div className="outcome-lane-head__signal">
                            <span><i style={{ width: `${Math.min(100, allocationRatio * 100)}%` }} /></span>
                            <small className={shortageMinutes > 0 ? 'is-short' : 'is-ready'}>
                              {shortageMinutes > 0 ? tr("{{v0}} 부족", { v0: formatMinutes(shortageMinutes) }) : tr("필요 시간 확보")}
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
                        <div key={day.key} className={clsx('outcome-day-cell', isActualToday(day.isoDate, actualToday) && 'is-today')} role="cell">
                          {blocks.map((block) => (
                            <button
                              key={block.id}
                              type="button"
                              className={clsx('outcome-time-block', isCalendarLane && 'outcome-time-block--event')}
                              aria-label={tr("{{v0}}, {{v1}}, 일정 수정", { v0: block.title, v1: formatClock(block.startMinutes) })}
                              onClick={() => openBlock(block)}
                            >
                              <span><Clock3 size={11} /> {formatClock(block.startMinutes)}</span>
                              <strong>{block.title}</strong>{block.durationMinutes >= 60 && <SubtaskProgress items={tasks.find(task => task.id === block.taskId)?.subtasks} />}
                              <small>{formatMinutes(block.durationMinutes)}</small>
                            </button>
                          ))}
                          <button
                            className={clsx('outcome-drop-target', blocks.length === 0 && 'outcome-drop-target--empty')}
                            type="button"
                            aria-label={tr("{{v0}}요일 {{v1}}에 할 일 또는 일정 추가", { v0: day.short, v1: formatClock(defaultPlacementStart) })}
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
                            <Plus size={13} /> {blocks.length === 0 ? tr("추가") : tr("하나 더")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>}
      </div>

      {calendarView === 'week' && <section className="allocation-strip allocation-signals" aria-label={tr("목표별 시간 배분")}>
        <div className="allocation-strip__title">
          <span className="eyebrow">{tr("배분 신호")}</span>
          <strong>{tr("결과별 이번 주 판단")}</strong>
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
                <small>{state === 'ready' ? tr("충분") : state === 'tight' ? tr("주의") : tr("부족")}</small>
              </div>
            );
          })}
        </div>
      </section>}

      {notice && <div className="toast" role="status"><Clock3 size={17} /> {notice}</div>}

      {placementDraft && (
        <TimeBlockSheet
          key={`${placementDraft.blockId ?? 'new'}-${placementDraft.taskId}-${placementDraft.date ?? placementDraft.day}-${placementDraft.startMinutes}`}
          tasks={tasks.filter((task) => task.id === placementDraft.taskId || (task.status !== 'done' && task.status !== 'cancelled'))}
          outcomes={outcomes}
          days={weekDays}
          initialBlockId={placementDraft.blockId}
          initialTaskId={placementDraft.taskId}
          initialTitle={placementDraft.title}
          initialDay={placementDraft.day}
          initialDate={placementDraft.date}
          minDate={calendarMinDate}
          maxDate={calendarMaxDate}
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
          title={editingTask ? tr("할 일 수정") : tr("새 할 일")}
          description={tr("목표 연결은 선택입니다. 일반 Todo처럼 제목만 입력해도 저장됩니다.")}
          onClose={() => {
            setAddOpen(false);
            setEditingTask(null);
          }}
        >
          <form onSubmit={submitTask}>
            <div className="form-grid">
              <label className="field">
                  <span className="field-label">{tr("할 일")}</span>
                <input
                  data-autofocus
                  value={addTitle}
                  maxLength={500}
                  onChange={(event) => setAddTitle(event.target.value)}
                  placeholder={tr("예: 실패 흐름을 세 단계로 나누기")}
                  required
                />
              </label>
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span className="field-label">{tr("목표 연결")}{' '}<small>{tr("선택")}</small></span>
                  <select value={addOutcomeId} onChange={(event) => setAddOutcomeId(event.target.value)}>
                    <option value="">{tr("연결하지 않음 · 수집함")}</option>
                    {outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.title}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{tr("예상 시간")}</span>
                  <select value={addEstimate} onChange={(event) => setAddEstimate(event.target.value)}>
                    {[...new Set([...estimateOptions, Number(addEstimate)])].sort((a, b) => a - b).map((minutes) => (
                      <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">{tr("메모")}{' '}<small>{tr("선택")}</small></span>
                <textarea
                  rows={3}
                  value={addNote}
                  maxLength={4000}
                  onChange={(event) => setAddNote(event.target.value)}
                  placeholder={tr("필요한 링크나 간단한 내용을 남겨보세요.")}
                />
              </label>
            </div>
            <SubtaskEditor value={addSubtasks} onChange={setAddSubtasks} />
            <div className="modal__actions">
              <button className="button button--secondary" type="button" onClick={() => {
                setAddOpen(false);
                setEditingTask(null);
              }}>{tr("취소")}</button>
              <button className="button button--primary" type="submit" disabled={!addTitle.trim() || !validSubtasks(addSubtasks)}>
                {editingTask ? tr("변경 저장") : tr("할 일 추가")}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTaskCandidate && (
        <Modal
          title={tr("할 일을 삭제할까요?")}
          description={tr("연결된 시간 블록과 실행 기록도 함께 삭제됩니다.")}
          onClose={() => setDeleteTaskCandidate(null)}
        >
          <p className="delete-task-summary"><strong>{deleteTaskCandidate.title}</strong></p>
          <p>{tr("하위 할 일")}{' '}{deleteTaskCandidate.subtasks?.length ?? 0}{tr("개도 함께 삭제됩니다.")}</p>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setDeleteTaskCandidate(null)}>{tr("취소")}</button>
            <button className="button button--delete" type="button" onClick={() => {
              if (!removeTask(deleteTaskCandidate.id)) { showNotice(tr("삭제하지 못했습니다. 동기화 상태를 확인해 주세요.")); return; }
              showNotice(tr("{{v0}}을 삭제했어요.", { v0: deleteTaskCandidate.title }));
              setDeleteTaskCandidate(null);
            }}>{tr("삭제")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Both public planning routes use the same task and calendar interaction model. */
export function PlannerScreen() {
  useLocale();
  const [params] = useSearchParams();
  const [toolsOpen, setToolsOpen] = useState(() => params.has('action') || params.get('tools') === 'goals');
  return <div className="planning-route">
    <TodayScreen mode="planner" />
    <details className="planning-advanced" open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)}>
      <summary>{tr("목표별 계획 · 작업 분할 · 이월 도구")}</summary>
      {toolsOpen && <GoalPlannerScreen />}
    </details>
  </div>;
}
