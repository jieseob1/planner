import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Check, Clock3, Compass, Target, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { DayKey, OnboardingPayload, TimeBlock } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import { getDateForDay, getMinuteOfDay, getToday, toLocalDate, weekDayMeta } from '../lib/calendarDate';
import { useTimeZone } from '../timezone/TimeZoneProvider';

export interface OnboardingSlot {
  value: OnboardingPayload['slot'];
  label: string;
  detail: string;
  day: DayKey;
  startMinutes: number;
  weekOffset: number;
}

export type OnboardingScheduleMode = 'recommended' | 'custom' | 'unplaced';

const slotAtDayOffset = (
  now: Date,
  dayOffset: number,
  startMinutes: number,
  value: OnboardingPayload['slot'],
  label: string,
  timeZone?: string
): OnboardingSlot => {
  const today = getToday(now, timeZone);
  const dayIndex = (today.index + dayOffset) % 7;
  return {
    value,
    label,
    detail: `${formatClock(startMinutes)}부터`,
    day: weekDayMeta[dayIndex].key,
    startMinutes,
    weekOffset: Math.floor((today.index + dayOffset) / 7)
  };
};

export const buildSlots = (now = new Date(), timeZone?: string): OnboardingSlot[] => {
  const today = getToday(now, timeZone);
  const currentMinutes = getMinuteOfDay(now, timeZone);
  const eveningOffset = currentMinutes < 1170 ? 0 : 1;
  let saturdayOffset = (5 - today.index + 7) % 7;
  if (saturdayOffset === 0 && currentMinutes >= 600) saturdayOffset = 7;
  return [
    slotAtDayOffset(now, eveningOffset, 1170, 'today-evening', eveningOffset === 0 ? '오늘 저녁' : '내일 저녁', timeZone),
    slotAtDayOffset(now, 1, 420, 'tomorrow-morning', '내일 아침', timeZone),
    slotAtDayOffset(
      now,
      saturdayOffset,
      600,
      'saturday-morning',
      saturdayOffset === 0 ? '오늘 오전' : saturdayOffset >= 7 ? '다음 토요일 오전' : '토요일 오전',
      timeZone
    )
  ];
};

export const isSlotInPast = (
  slot: Pick<OnboardingSlot, 'day' | 'startMinutes' | 'weekOffset'>,
  now = new Date(),
  timeZone?: string
) => {
  const todayDate = toLocalDate(now, timeZone);
  const targetDate = getDateForDay(slot.day, slot.weekOffset, now, timeZone);
  if (targetDate !== todayDate) return targetDate < todayDate;
  return slot.startMinutes <= getMinuteOfDay(now, timeZone);
};

const stepLabels = ['결과', '다음 행동', '시간 선택'];

function findSlotConflict(slot: OnboardingSlot, durationMinutes: number, timeBlocks: TimeBlock[]) {
  return findTimeBlockConflict(timeBlocks, {
    day: slot.day,
    startMinutes: slot.startMinutes,
    durationMinutes,
    weekOffset: slot.weekOffset
  }) ?? undefined;
}

export function OnboardingScreen() {
  const { timeZone } = useTimeZone();
  const navigate = useNavigate();
  const { finishOnboarding, timeBlocks } = usePlanner();
  const slots = useMemo(() => buildSlots(new Date(), timeZone), [timeZone]);
  const [step, setStep] = useState(1);
  const [outcomeTitle, setOutcomeTitle] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [scheduleMode, setScheduleMode] = useState<OnboardingScheduleMode>('recommended');
  const [recommendedSlot, setRecommendedSlot] = useState<OnboardingPayload['slot']>(() => (
    slots.find((item) => !findSlotConflict(item, 40, timeBlocks))?.value ?? slots[0].value
  ));
  const [customDay, setCustomDay] = useState<DayKey>(slots[0].day);
  const [customWeekOffset, setCustomWeekOffset] = useState(slots[0].weekOffset);
  const [customStart, setCustomStart] = useState(formatClock(slots[0].startMinutes));
  const [estimateMinutes, setEstimateMinutes] = useState(40);
  const [scheduleError, setScheduleError] = useState('');

  const customStartMinutes = /^\d{2}:\d{2}$/.test(customStart)
    ? Number(customStart.slice(0, 2)) * 60 + Number(customStart.slice(3, 5))
    : -1;
  const customSlot: OnboardingSlot = {
    value: 'today-evening',
    label: `${customWeekOffset === 0 ? '이번 주' : '다음 주'} ${weekDayMeta.find((day) => day.key === customDay)?.long ?? ''}`,
    detail: customStartMinutes >= 0 ? `${formatClock(customStartMinutes)}부터` : '시간을 선택하세요',
    day: customDay,
    startMinutes: customStartMinutes,
    weekOffset: customWeekOffset
  };
  const selectedSlot = scheduleMode === 'custom'
    ? customSlot
    : slots.find((item) => item.value === recommendedSlot);
  const invalidCustomSlot = scheduleMode === 'custom' && (
    customStartMinutes < 0
    || customStartMinutes + estimateMinutes > 24 * 60
    || isSlotInPast(customSlot, new Date(), timeZone)
  );
  const selectedSlotConflict = scheduleMode !== 'unplaced' && selectedSlot && !invalidCustomSlot
    ? findSlotConflict(selectedSlot, estimateMinutes, timeBlocks)
    : undefined;
  const canContinue = step === 1
    ? outcomeTitle.trim().length > 2
    : step === 2
      ? taskTitle.trim().length > 2
      : scheduleMode === 'unplaced' || Boolean(selectedSlot && !invalidCustomSlot && !selectedSlotConflict);
  const previewValues = [
    outcomeTitle.trim() || '원하는 변화 한 문장',
    taskTitle.trim() || (step > 1 ? '바로 시작할 행동 입력 중' : '다음 단계에서 정합니다.'),
    step === 3
      ? scheduleMode === 'unplaced'
        ? `일정 없이 할 일만 · ${formatMinutes(estimateMinutes)}`
        : `${selectedSlot?.label} ${selectedSlot?.detail} · ${formatMinutes(estimateMinutes)}`
      : '마지막 단계에서 시간을 선택하거나 미배치로 둡니다.'
  ];

  const finish = () => {
    if (scheduleMode !== 'unplaced' && (!selectedSlot || invalidCustomSlot || selectedSlotConflict)) {
      setScheduleError(invalidCustomSlot
        ? '현재 이후이면서 자정을 넘지 않는 시간을 선택하세요.'
        : '선택한 시간에 이미 일정이 있습니다. 비어 있는 시간을 선택하세요.');
      return;
    }
    const payloadSlot = selectedSlot ?? slots[0];
    finishOnboarding({
      outcomeTitle: outcomeTitle.trim(),
      taskTitle: taskTitle.trim(),
      slot: payloadSlot.value,
      estimateMinutes,
      day: scheduleMode === 'unplaced' ? getToday(new Date(), timeZone).key : payloadSlot.day,
      startMinutes: scheduleMode === 'unplaced' ? null : payloadSlot.startMinutes,
      weekOffset: scheduleMode === 'unplaced' ? 0 : payloadSlot.weekOffset
    });
    navigate('/today');
  };

  const startWithoutGoal = () => {
    const fallbackSlot = slots[0];
    finishOnboarding({
      outcomeTitle: '',
      taskTitle: '',
      slot: fallbackSlot.value,
      estimateMinutes,
      day: getToday(new Date(), timeZone).key,
      startMinutes: null,
      weekOffset: 0
    });
    navigate('/today');
  };

  return (
    <main className="onboarding">
      <div className="onboarding__brand">
        <span className="brand__mark"><Compass size={20} /></span>
        <strong>GOALS TO TODAY</strong>
      </div>

      <section className="onboarding__panel">
        <header className="onboarding__header">
          <div className="onboarding__header-meta">
            <p className="eyebrow">FIRST PLAN · 약 3분</p>
            <span>{step} / 3</span>
          </div>
          <ol className="onboarding-progress" aria-label={`3단계 중 ${step}단계`}>
            {stepLabels.map((label, index) => {
              const item = index + 1;
              const complete = item < step;
              const active = item === step;
              return (
                <li
                  key={label}
                  className={clsx('onboarding-progress__item', complete && 'is-done', active && 'is-active')}
                  aria-current={active ? 'step' : undefined}
                >
                  <span>{complete ? <Check size={13} /> : item}</span>
                  <div><strong>{label}</strong><small>{previewValues[index]}</small></div>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="onboarding__content">
          {step === 1 ? (
            <div className="onboarding-step onboarding-step--focused">
              <p className="eyebrow onboarding-step__eyebrow"><Target size={14} /> STEP 1 · RESULT</p>
              <h1 className="onboarding-step__title">이번 분기에 무엇을 바꿀까요?</h1>
              <p>첫 결과를 만들거나, 목표 없이 Todo와 캘린더부터 바로 시작할 수 있습니다.</p>
              <label className="field field--large onboarding-focus-field">
                <span className="field-label">결과 한 문장</span>
                <input
                  autoFocus
                  value={outcomeTitle}
                  onChange={(event) => setOutcomeTitle(event.target.value)}
                  placeholder="예: 기술 글 6개를 발행한다"
                  aria-describedby="outcome-field-hint"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && outcomeTitle.trim().length > 2) setStep(2);
                  }}
                />
              </label>
              <div className="prompt-chips" id="outcome-field-hint">
                <span>예시</span>
                {['포트폴리오 1개 공개', '사이드 수익 80만원', '10km 55분 완주'].map((example) => (
                  <button key={example} type="button" onClick={() => setOutcomeTitle(example)}>{example}</button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-step onboarding-step--focused">
              <p className="eyebrow onboarding-step__eyebrow"><Zap size={14} /> STEP 2 · ACTION</p>
              <h1 className="onboarding-step__title">가장 먼저 무엇을 할까요?</h1>
              <p>한 번 앉아서 시작하고, 두 시간 안에 끝낼 수 있는 행동으로 적어주세요.</p>
              <div className="selected-outcome"><Target size={15} /><span>{outcomeTitle}</span></div>
              <label className="field field--large onboarding-focus-field">
                <span className="field-label">첫 번째 다음 행동</span>
                <input
                  autoFocus
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="예: 첫 글의 제목과 목차를 정한다"
                  aria-describedby="action-field-hint"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && taskTitle.trim().length > 2) setStep(3);
                  }}
                />
              </label>
              <p className="action-rule" id="action-field-hint"><Zap size={15} /><span>동사로 시작하고, 지금 바로 할 수 있을 만큼 작게 씁니다.</span></p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onboarding-step onboarding-step--focused">
              <p className="eyebrow onboarding-step__eyebrow"><CalendarClock size={14} /> STEP 3 · TIME</p>
              <h1 className="onboarding-step__title">언제 시작할까요?</h1>
              <p>추천 시간을 고르거나 직접 정할 수 있습니다. 아직 모르겠다면 할 일만 먼저 만드세요.</p>
              <div className="selected-outcome selected-outcome--action"><Zap size={15} /><span>{taskTitle}</span></div>
              <div className="segmented" role="radiogroup" aria-label="시간 정하기 방식">
                {([
                  ['recommended', '추천 시간'],
                  ['custom', '직접 선택'],
                  ['unplaced', '나중에 정하기']
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={scheduleMode === mode}
                    className={scheduleMode === mode ? 'is-selected' : ''}
                    onClick={() => {
                      setScheduleMode(mode);
                      setScheduleError('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scheduleMode === 'recommended' ? (
                <div className="slot-grid" role="radiogroup" aria-label="추천 실행 시간">
                  {slots.map((item) => {
                    const conflict = findSlotConflict(item, estimateMinutes, timeBlocks);
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={recommendedSlot === item.value}
                        className={clsx(recommendedSlot === item.value && 'is-selected', conflict && 'is-conflict')}
                        disabled={Boolean(conflict)}
                        onClick={() => {
                          setRecommendedSlot(item.value);
                          setScheduleError('');
                        }}
                      >
                        <CalendarClock size={18} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{conflict ? `시간 겹침 · ${formatClock(conflict.startMinutes)} ${conflict.title}` : item.detail}</small>
                        </span>
                        <i>{recommendedSlot === item.value && !conflict ? <Check size={13} /> : null}</i>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {scheduleMode === 'custom' ? (
                <div className="form-grid__columns">
                  <label className="field">
                    주
                    <select value={customWeekOffset} onChange={(event) => setCustomWeekOffset(Number(event.target.value))}>
                      <option value={0}>이번 주</option>
                      <option value={1}>다음 주</option>
                    </select>
                  </label>
                  <label className="field">
                    요일
                    <select value={customDay} onChange={(event) => setCustomDay(event.target.value as DayKey)}>
                      {weekDayMeta.map((day) => <option key={day.key} value={day.key}>{day.long}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    시작 시간
                    <input type="time" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                  </label>
                </div>
              ) : null}
              {scheduleMode === 'unplaced' ? (
                <p className="review-carryover-empty"><Check size={16} /> 첫 할 일은 만들고 일정에는 배치하지 않습니다. Today나 Planner에서 언제든 시간을 정할 수 있습니다.</p>
              ) : null}
              {invalidCustomSlot ? <p className="slot-conflict-alert" role="alert">현재 이후이면서 자정을 넘지 않는 시간을 선택하세요.</p> : null}
              {scheduleError ? <p className="slot-conflict-alert" role="alert">{scheduleError}</p> : null}
              <div className="field duration-field" role="group" aria-labelledby="duration-field-label">
                <span className="field-label" id="duration-field-label"><Clock3 size={16} /> 예상 시간</span>
                <div className="segmented">
                  {[25, 40, 60, 90].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className={estimateMinutes === minutes ? 'is-selected' : ''}
                      aria-pressed={estimateMinutes === minutes}
                      onClick={() => {
                        const currentSlot = slots.find((item) => item.value === recommendedSlot);
                        const nextAvailableSlot = slots.find((item) => !findSlotConflict(item, minutes, timeBlocks));
                        setEstimateMinutes(minutes);
                        if (scheduleMode === 'recommended' && currentSlot && findSlotConflict(currentSlot, minutes, timeBlocks) && nextAvailableSlot) {
                          setRecommendedSlot(nextAvailableSlot.value);
                        }
                        setScheduleError(scheduleMode === 'recommended' && !nextAvailableSlot ? '이 길이로 예약할 수 있는 추천 시간이 없습니다.' : '');
                      }}
                    >
                      {formatMinutes(minutes)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="onboarding__actions">
          {step > 1 ? (
            <button className="button button--secondary" type="button" onClick={() => setStep((current) => current - 1)}>
              <ArrowLeft size={17} /> 이전
            </button>
          ) : (
            <button className="button button--secondary" type="button" onClick={startWithoutGoal}>
              목표 없이 Todo·캘린더 시작
            </button>
          )}
          <button
            className="button button--primary"
            type="button"
            disabled={!canContinue}
            onClick={() => step < 3 ? setStep((current) => current + 1) : finish()}
          >
            {step < 3 ? '계속' : '첫 실행 만들기'} <ArrowRight size={17} />
          </button>
        </footer>
      </section>

      <aside className="onboarding-preview" aria-label="계획 미리보기">
        <div className="onboarding-preview__intro">
          <p className="eyebrow">PLAN PREVIEW</p>
          <h2>첫 결과와 행동을 만들고, 시간은 선택합니다.</h2>
          <p>온보딩은 시작점입니다. 더 세밀한 계획 구조는 첫 실행 뒤 이어서 정리합니다.</p>
        </div>
        <div className="preview-flow">
          <article className={clsx('preview-node', outcomeTitle && 'is-filled', step === 1 && 'is-active')}>
            <span>01 · 분기 결과</span>
            <strong>{previewValues[0]}</strong>
          </article>
          <ArrowRight size={18} aria-hidden="true" />
          <article className={clsx('preview-node', taskTitle && 'is-filled', step === 2 && 'is-active')}>
            <span>02 · 다음 행동</span>
            <strong>{previewValues[1]}</strong>
          </article>
          <ArrowRight size={18} aria-hidden="true" />
          <article className={clsx('preview-node', step === 3 && 'is-filled', step === 3 && 'is-active')}>
            <span>03 · 시간 선택</span>
            <strong>{previewValues[2]}</strong>
          </article>
        </div>
        <p className="onboarding-preview__note"><Clock3 size={15} /> 계획이 아니라 시작 시간이 행동을 만듭니다.</p>
      </aside>
    </main>
  );
}
