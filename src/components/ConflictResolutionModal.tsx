import { useMemo, useState } from 'react';
import { GitCompareArrows, Laptop, Server } from 'lucide-react';
import { Modal } from './Modal';
import { type SnapshotSection, usePlanner } from '../state/PlannerProvider';

const sections: Array<{ key: SnapshotSection; label: string; description: string }> = [
  { key: 'plan', label: '연간·분기 방향', description: '연도, 분기, 방향과 종료일' },
  { key: 'outcomes', label: '성과와 지표', description: '목표값, 현재값, 근거와 결정' },
  { key: 'tasks', label: '다음 행동', description: '할 일, 상태, 예상 시간과 메모' },
  { key: 'timeBlocks', label: '주간 시간 배치', description: '계획 및 외부 일정 블록' },
  { key: 'timeEntries', label: '실행 기록', description: '타이머·수동 시간과 완료 근거' },
  { key: 'timer', label: '현재 타이머', description: '실행 중이거나 일시 정지된 세션' },
  { key: 'review', label: '주간 회고', description: '방해 요인, 지표 초안과 다음 Top 3' },
  { key: 'plannerWeekOffset', label: '표시 중인 주', description: 'Planner가 열어 둔 주차' },
  { key: 'version', label: '데이터 버전', description: '스냅샷 형식 버전' }
];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function ConflictResolutionModal({ onClose }: { onClose: () => void }) {
  const { syncConflict, resolveConflict } = usePlanner();
  const [choices, setChoices] = useState<Partial<Record<SnapshotSection, 'local' | 'server'>>>(() => {
    if (!syncConflict) return {};
    return Object.fromEntries(sections.map(({ key }) => {
      const baseValue = syncConflict.base?.[key];
      const localChanged = !syncConflict.base || !same(baseValue, syncConflict.local[key]);
      const serverChanged = !syncConflict.base || !same(baseValue, syncConflict.server[key]);
      return [key, localChanged || !serverChanged ? 'local' : 'server'];
    })) as Partial<Record<SnapshotSection, 'local' | 'server'>>;
  });

  const changedSections = useMemo(() => {
    if (!syncConflict) return [];
    return sections.filter(({ key }) => !same(syncConflict.local[key], syncConflict.server[key]));
  }, [syncConflict]);

  if (!syncConflict) return null;

  return (
    <Modal
      title="기기와 서버의 변경을 비교합니다"
      description="양쪽 원본은 이 기기의 충돌 백업에 보존했습니다. 항목별로 사용할 내용을 선택한 뒤 병합하세요."
      onClose={onClose}
    >
      <div className="conflict-summary">
        <span><Laptop size={17} aria-hidden="true" /> 이 기기 변경</span>
        <GitCompareArrows size={18} aria-hidden="true" />
        <span><Server size={17} aria-hidden="true" /> 서버 revision {syncConflict.serverRevision}</span>
      </div>
      <div className="conflict-sections">
        {changedSections.map(({ key, label, description }) => (
          <fieldset key={key} className="conflict-section">
            <legend>{label}</legend>
            <p>{description}</p>
            <label>
              <input
                type="radio"
                name={`conflict-${key}`}
                checked={choices[key] === 'local'}
                onChange={() => setChoices((current) => ({ ...current, [key]: 'local' }))}
              />
              이 기기 내용
            </label>
            <label>
              <input
                type="radio"
                name={`conflict-${key}`}
                checked={choices[key] === 'server'}
                onChange={() => setChoices((current) => ({ ...current, [key]: 'server' }))}
              />
              서버 내용
            </label>
          </fieldset>
        ))}
      </div>
      <div className="modal__actions conflict-actions">
        <button className="button button--secondary" type="button" onClick={() => { resolveConflict('server'); onClose(); }}>
          서버 내용 전체 사용
        </button>
        <button className="button button--secondary" type="button" onClick={() => { resolveConflict('local'); onClose(); }}>
          이 기기 내용 전체 유지
        </button>
        <button className="button button--primary" type="button" onClick={() => { resolveConflict('merge', choices); onClose(); }}>
          선택 항목 병합
        </button>
      </div>
    </Modal>
  );
}
