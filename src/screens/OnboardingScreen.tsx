import { useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Check, Clock3, Compass, Target, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { DayKey, OnboardingPayload, TimeBlock } from '../domain/types';
import { formatClock, formatMinutes } from '../lib/format';
import { findTimeBlockConflict } from '../lib/timeBlocks';
import { usePlanner } from '../state/PlannerProvider';
import { getToday, weekDayMeta } from '../lib/calendarDate';

interface OnboardingSlot {
  value: OnboardingPayload['slot'];
  label: string;
  detail: string;
  day: DayKey;
  startMinutes: number;
  weekOffset: number;
}

const buildSlots = (): OnboardingSlot[] => {
  const today = getToday();
  const tomorrowIndex = (today.index + 1) % 7;
  const daysUntilSaturday = (5 - today.index + 7) % 7;
  return [
    { value: 'today-evening', label: '오늘 저녁', detail: '19:30부터', day: today.key, startMinutes: 1170, weekOffset: 0 },
    {
      value: 'tomorrow-morning', label: '내일 아침', detail: '07:00부터',
      day: weekDayMeta[tomorrowIndex].key, startMinutes: 420, weekOffset: today.index === 6 ? 1 : 0
    },
    {
      value: 'saturday-morning', label: daysUntilSaturday === 0 ? '오늘 오전' : '토요일 오전', detail: '10:00부터',
      day: 'sat', startMinutes: 600, weekOffset: today.index > 5 ? 1 : 0
    }
  ];
};

const stepLabels = ['결과', '다음 행동', '실행 시간'];

function findSlotConflict(slot: OnboardingSlot, durationMinutes: number, timeBlocks: TimeBlock[]) {
  return findTimeBlockConflict(timeBlocks, {
    day: slot.day,
    startMinutes: slot.startMinutes,
    durationMinutes,
    weekOffset: slot.weekOffset
  }) ?? undefined;
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const { finishOnboarding, timeBlocks } = usePlanner();
  const [slots] = useState(buildSlots);
  const [step, setStep] = useState(1);
  const [outcomeTitle, setOutcomeTitle] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [slot, setSlot] = useState<OnboardingPayload['slot']>(() => (
    slots.find((item) => !findSlotConflict(item, 40, timeBlocks))?.value ?? slots[0].value
  ));
  const [estimateMinutes, setEstimateMinutes] = useState(40);
  const [scheduleError, setScheduleError] = useState('');

  const selectedSlot = slots.find((item) => item.value === slot);
  const selectedSlotConflict = selectedSlot ? findSlotConflict(selectedSlot, estimateMinutes, timeBlocks) : undefined;
  const canContinue = step === 1
    ? outcomeTitle.trim().length > 2
    : step === 2
      ? taskTitle.trim().length > 2
      : Boolean(selectedSlot && !selectedSlotConflict);
  const previewValues = [
    outcomeTitle.trim() || '원하는 변화 한 문장',
    taskTitle.trim() || (step > 1 ? '바로 시작할 행동 입력 중' : '다음 단계에서 정합니다.'),
    step === 3 ? `${selectedSlot?.label} · ${formatMinutes(estimateMinutes)}` : '마지막 단계에서 예약합니다.'
  ];

  const finish = () => {
    if (!selectedSlot || selectedSlotConflict) {
      setScheduleError('선택한 시간에 이미 일정이 있습니다. 비어 있는 시간을 선택하세요.');
      return;
    }
    finishOnboarding({
      outcomeTitle: outcomeTitle.trim(),
      taskTitle: taskTitle.trim(),
      slot,
      estimateMinutes,
      day: selectedSlot.day,
      startMinutes: selectedSlot.startMinutes,
      weekOffset: selectedSlot.weekOffset
    });
    navigate('/today');
  };

  return (
    <main className="onboarding">
      <div className="onboarding__brand">
        <span className="brand__mark"><Compass size={20} /></span>
        <strong>NOWLINE</strong>
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
              <p>완료 여부를 확인할 수 있는 결과 하나만 적어주세요.</p>
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
              <p>완벽한 주간 계획 대신, 이 행동을 시작할 시간 하나만 예약합니다.</p>
              <div className="selected-outcome selected-outcome--action"><Zap size={15} /><span>{taskTitle}</span></div>
              <div className="slot-grid" role="radiogroup" aria-label="실행 시간">
                {slots.map((item) => {
                  const conflict = findSlotConflict(item, estimateMinutes, timeBlocks);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={slot === item.value}
                      className={clsx(slot === item.value && 'is-selected', conflict && 'is-conflict')}
                      disabled={Boolean(conflict)}
                      onClick={() => {
                        setSlot(item.value);
                        setScheduleError('');
                      }}
                    >
                      <CalendarClock size={18} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{conflict ? `시간 겹침 · ${formatClock(conflict.startMinutes)} ${conflict.title}` : item.detail}</small>
                      </span>
                      <i>{slot === item.value && !conflict ? <Check size={13} /> : null}</i>
                    </button>
                  );
                })}
              </div>
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
                        const currentSlot = slots.find((item) => item.value === slot);
                        const nextAvailableSlot = slots.find((item) => !findSlotConflict(item, minutes, timeBlocks));
                        setEstimateMinutes(minutes);
                        if (currentSlot && findSlotConflict(currentSlot, minutes, timeBlocks) && nextAvailableSlot) {
                          setSlot(nextAvailableSlot.value);
                        }
                        setScheduleError(nextAvailableSlot ? '' : '이 길이로 예약할 수 있는 추천 시간이 없습니다.');
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
          ) : <span />}
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
          <h2>결과를 실제 시간까지 연결합니다.</h2>
          <p>세 문장이 연결되면 첫 계획이 완성됩니다.</p>
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
            <span>03 · 시간 블록</span>
            <strong>{previewValues[2]}</strong>
          </article>
        </div>
        <p className="onboarding-preview__note"><Clock3 size={15} /> 계획이 아니라 시작 시간이 행동을 만듭니다.</p>
      </aside>
    </main>
  );
}
