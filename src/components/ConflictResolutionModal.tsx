import { tr, useLocale } from '../i18n';
import { useMemo, useState } from 'react';
import { GitCompareArrows, Laptop, Server } from 'lucide-react';
import { Modal } from './Modal';
import { type SnapshotSection, usePlanner } from '../state/PlannerProvider';
import { mergeSnapshots } from '../state/mergeSnapshots';

const sections = (): Array<{ key: SnapshotSection; label: string; description: string }> => [
  { key: 'plan', label: tr("연간·분기 방향"), description: tr("연도, 분기, 방향과 종료일") },
  { key: 'outcomes', label: tr("성과와 지표"), description: tr("목표값, 현재값, 근거와 결정") },
  { key: 'tasks', label: tr("다음 행동"), description: tr("할 일, 상태, 예상 시간과 메모") },
  { key: 'timeBlocks', label: tr("주간 시간 배치"), description: tr("계획 및 외부 일정 블록") },
  { key: 'timeEntries', label: tr("실행 기록"), description: tr("타이머·수동 시간과 완료 근거") },
  { key: 'timer', label: tr("현재 타이머"), description: tr("실행 중이거나 일시 정지된 세션") },
  { key: 'review', label: tr("주간 회고"), description: tr("방해 요인, 지표 초안과 다음 Top 3") },
  { key: 'plannerWeekOffset', label: tr("표시 중인 주"), description: tr("Planner가 열어 둔 주차") },
  { key: 'version', label: tr("데이터 버전"), description: tr("스냅샷 형식 버전") }
];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function ConflictResolutionModal({ onClose }: { onClose: () => void }) {
  useLocale();
  const { syncConflict, resolveConflict } = usePlanner();
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>(() => {
    if (!syncConflict || syncConflict.base) return {};
    return Object.fromEntries(sections().map(({ key }) => {
      const baseValue = syncConflict.base?.[key];
      const localChanged = !syncConflict.base || !same(baseValue, syncConflict.local[key]);
      const serverChanged = !syncConflict.base || !same(baseValue, syncConflict.server[key]);
      return [key, localChanged || !serverChanged ? 'local' : 'server'];
    })) as Record<string, 'local' | 'server'>;
  });

  const changedSections = useMemo(() => {
    if (!syncConflict) return [];
    return sections().filter(({ key }) => !same(syncConflict.local[key], syncConflict.server[key]));
  }, [syncConflict]);

  const granular = useMemo(() => syncConflict?.base
    ? mergeSnapshots(syncConflict.base, syncConflict.local, syncConflict.server) : null, [syncConflict]);
  const complex = syncConflict?.serverMissing || granular?.conflicts.some(item => item.path === 'references' || item.path === 'timeBlocks.overlap');
  const entries = granular ? granular.conflicts.filter(item => item.path !== 'references' && item.path !== 'timeBlocks.overlap').map(item => {
    const [section, id, field] = item.path.split('.');
    const task = syncConflict?.local.tasks.find(task => task.id === id) ?? syncConflict?.server.tasks.find(task => task.id === id);
    const fieldNames: Record<string, string> = { title: tr("제목"), note: tr("메모"), completion: tr("완료 상태"), plannedDate: tr("날짜"), slot: tr("시간"), subtasks: tr("하위 할 일"), done: tr("체크"), estimateMinutes: tr("예상 시간"), order: tr("순서"), metricHistory: tr("지표 변경 이력") };
    return { key: item.path, label: `${task?.title ?? sections().find(entry => entry.key === section)?.label ?? section} · ${fieldNames[field] ?? field ?? tr("삭제 / 수정")}`,
      description: tr("이 항목만 양쪽에서 변경했습니다. 나머지 변경은 자동으로 보존합니다."), local: item.local, server: item.server };
  }) : changedSections.map(item => ({ ...item, local: syncConflict?.local[item.key], server: syncConflict?.server[item.key] }));
  const preview = (value: unknown) => value === undefined ? tr("삭제됨") : JSON.stringify(value).slice(0, 240);

  if (!syncConflict) return null;

  return (
    <Modal
      eyebrow={tr("동기화 충돌")}
      title={tr("기기와 서버의 변경을 비교합니다")}
      description={tr("양쪽 원본은 이 기기의 충돌 백업에 보존했습니다. 항목별로 사용할 내용을 선택한 뒤 병합하세요.")}
      className="conflict-resolution-modal"
      onClose={onClose}
    >
      <div className="conflict-summary">
        <span><Laptop size={17} aria-hidden="true" /> {' '}{tr("이 기기 변경")}</span>
        <GitCompareArrows size={18} aria-hidden="true" />
        <span><Server size={17} aria-hidden="true" /> {syncConflict.serverMissing ? tr("서버에서 계획이 종료·삭제됨") : tr("서버 revision {{v0}}", { v0: syncConflict.serverRevision })}</span>
      </div>
      <div className="conflict-sections">
        {complex && <p className="form-error" role="alert">{syncConflict.serverMissing ? tr("다른 기기에서 계획을 종료·삭제했습니다. 자동으로 복원하지 않습니다. 서버 상태를 따르거나, 이 기기 원본을 새 계획으로 저장할지 선택하세요.") : tr("삭제와 연결된 기록 또는 겹친 시간 배치가 있습니다. 원본 전체 사용을 선택해 주세요.")} {' '}{tr("선택하지 않은 원본은 기기 백업에 보존됩니다.")}</p>}
        {entries.map(({ key, label, description, local, server }) => (
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
              {tr("이 기기 내용")}<small className="conflict-value">{preview(local)}</small>
            </label>
            <label>
              <input
                type="radio"
                name={`conflict-${key}`}
                checked={choices[key] === 'server'}
                onChange={() => setChoices((current) => ({ ...current, [key]: 'server' }))}
              />
              {tr("서버 내용")}<small className="conflict-value">{preview(server)}</small>
            </label>
          </fieldset>
        ))}
      </div>
      <div className="modal__actions conflict-actions">
        <button className="button button--secondary" type="button" onClick={() => { resolveConflict('server'); onClose(); }}>
          {tr("서버 내용 전체 사용")}</button>
        <button className="button button--secondary" type="button" onClick={() => { resolveConflict('local'); onClose(); }}>
          {tr("이 기기 내용 전체 유지")}</button>
        <button className="button button--primary" type="button" disabled={Boolean(complex) || entries.some(item => !choices[item.key])} onClick={() => { resolveConflict('merge', choices); onClose(); }}>
          {tr("선택 항목 병합")}</button>
      </div>
    </Modal>
  );
}
