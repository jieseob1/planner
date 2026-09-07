import { PlannerApiError } from '../api/plannerApi';

export interface PlannerSaveProblem {
  status: 400;
  kind: 'input' | 'precondition';
  code: string | null;
  detail: string;
  errors: Array<{ field: string; label: string; message: string }>;
  additionalErrors: number;
  localStored: boolean;
}

const fields: Record<string, string> = {
  version: '데이터 버전', plan: '계획', year: '연도', annualDirection: '연간 방향', quarter: '분기',
  quarterFocus: '분기 집중 목표', quarterEndDate: '분기 종료일', plannerWeekOffset: '선택한 주',
  tasks: '할 일', timeBlocks: '시간 블록', timeEntries: '실행 기록', outcomes: '목표', timer: '타이머',
  review: '회고', id: '식별자', title: '제목', outcomeId: '연결한 목표', taskId: '연결한 할 일',
  estimateMinutes: '예상 시간', status: '상태', pinned: '고정 여부', carryCount: '이월 횟수', note: '메모',
  day: '요일', startMinutes: '시작 시간', durationMinutes: '배정 시간', external: '외부 일정 여부',
  weekOffset: '주', date: '날짜', durationSeconds: '실행 시간', source: '기록 방식', observedAt: '관측 시각',
  evidence: '근거', parentTitle: '상위 목표', current: '현재 지표', target: '목표 지표', unit: '단위',
  confidence: '확신도', lastUpdatedDays: '마지막 갱신', metricUpdatedAt: '지표 갱신 시각',
  nextCheckDate: '다음 점검일', metricHistory: '지표 이력', value: '지표값', actualHours: '실행 시간',
  neededHours: '필요 시간', availableHours: '가능 시간', evidenceLabel: '지표 근거', changeLabel: '변경 내용',
  attention: '점검 상태', decision: '목표 결정', startedAt: '시작 시각', accumulatedSeconds: '누적 시간',
  paused: '일시 정지 상태', blocker: '방해 요인', selectedTopTaskIds: '다음 주 우선 할 일',
  metricDraft: '회고 지표', completedAt: '완료 시각', headers: '저장 요청 설정'
};
const details = new Set([
  '요청 값이 유효성 규칙을 충족하지 않습니다.', '유효하지 않은 값입니다.',
  '필수 요청 헤더와 조건부 요청 헤더를 확인해 주세요.', '요청 헤더 값을 확인해 주세요.',
  '요청 JSON 형식과 enum 값을 확인해 주세요.',
  '일시 정지된 타이머의 startedAt은 null이어야 합니다.', '실행 중인 타이머에는 startedAt이 필요합니다.',
  '기존 지표 이력은 삭제할 수 없습니다.', '기존 지표 이력은 수정하거나 재정렬할 수 없습니다.',
  '지표 변경에는 값, 시각, 근거 이력이 필요합니다.', '지표 관측 시각이 서버 현재 시각보다 너무 미래입니다.',
  '지표 이력 시각은 단조 증가해야 합니다.', '갱신 시각에는 지표 이력이 필요합니다.',
  '현재 지표는 가장 최근 이력과 같아야 합니다.', '최초 지표값에는 값, 시각, 근거 이력이 필요합니다.'
]);
const dynamicMessages: Array<[string, string]> = [
  ['할 일이 존재하지 않는 outcomeId를 참조합니다:', '할 일에 연결된 목표를 확인해 주세요.'],
  ['존재하지 않는 taskId를 참조합니다:', '연결된 할 일이 존재하는지 확인해 주세요.'],
  ['시간 블록은 하루 24시를 넘을 수 없습니다:', '시간 블록은 하루 24시를 넘을 수 없습니다.'],
  ['같은 날짜의 시간 블록이 겹칩니다:', '같은 날짜의 시간 블록이 겹칩니다.'],
  ['중복 ID를 사용할 수 없습니다:', '중복된 항목 식별자가 있습니다.']
];

const safeMessage = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 2000) return null;
  const text = value.trim();
  if (details.has(text)) return text;
  for (const [prefix, message] of dynamicMessages) if (text.startsWith(prefix)) return message;
  if (['must not be blank', 'must not be empty', '공백일 수 없습니다', '비어 있을 수 없습니다'].includes(text)) return '비워 둘 수 없습니다.';
  if (['must not be null', '널이어서는 안됩니다'].includes(text)) return '값을 입력해 주세요.';
  const bound = text.match(/^must be (greater than or equal to|less than or equal to|greater than|less than) (-?\d{1,10}(?:\.\d{1,6})?)$/);
  if (bound) {
    const relation: Record<string, string> = { 'greater than or equal to': '이상', 'less than or equal to': '이하', 'greater than': '초과', 'less than': '미만' };
    return `${bound[2]} ${relation[bound[1]]} 값을 입력해 주세요.`;
  }
  const size = text.match(/^size must be between (\d{1,10}) and (\d{1,10})$/);
  if (size) return `길이 또는 개수를 ${size[1]}–${size[2]} 범위로 맞춰 주세요.`;
  const digits = text.match(/^numeric value out of bounds \(<(\d{1,2}) digits>\.<(\d{1,2}) digits> expected\)$/);
  if (digits) return `정수 ${digits[1]}자리, 소수 ${digits[2]}자리 이내로 입력해 주세요.`;
  return null;
};

const safeField = (value: unknown): { field: string; label: string } | null => {
  if (typeof value !== 'string' || value.length > 180) return null;
  const parts = value.split('.');
  if (!parts.every((part) => /^[A-Za-z]+(?:\[\d{0,5}\])?$/.test(part) && Object.hasOwn(fields, part.replace(/\[\d*\]/, '')))) return null;
  return { field: value, label: parts.map((part) => {
    const name = part.replace(/\[\d*\]/, '');
    const index = part.match(/\[(\d+)\]/)?.[1];
    return fields[name] + (index === undefined ? '' : ` ${Number(index) + 1}번째`);
  }).join(' · ') };
};

/** Retain only known validation metadata; never retain payloads, rejected values or raw server text. */
export function plannerSaveProblem(error: unknown, localStored: boolean): PlannerSaveProblem | null {
  if (!(error instanceof PlannerApiError) || error.status !== 400) return null;
  const problem = error.problem;
  const codes = ['validation-failed', 'invalid-planner-snapshot', 'malformed-json', 'invalid-request-header', 'invalid-precondition'];
  const code = typeof problem?.code === 'string' && codes.includes(problem.code) ? problem.code : null;
  const kind = code === 'invalid-precondition' ? 'precondition' : 'input';
  const rawErrors: unknown[] = kind === 'input' && Array.isArray(problem?.errors) ? problem.errors : [];
  const errors = rawErrors.slice(0, 5).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const field = safeField(item.field);
    return field ? [{ ...field, message: safeMessage(item.message) ?? '이 항목의 입력값을 확인해 주세요.' }] : [];
  });
  return {
    status: 400, kind, code,
    detail: kind === 'precondition'
      ? '입력값의 문제가 아닙니다. 서버가 저장 버전 정보를 확인하지 못했습니다. 할 일이나 일정 내용을 바꾸지 말고 다시 저장해 주세요. 반복되면 앱 버전과 동기화 상태 확인이 필요합니다.'
      : safeMessage(problem?.detail) ?? '서버가 저장할 내용을 받아들이지 못했습니다. 입력값을 확인해 주세요.',
    errors, additionalErrors: Math.max(0, rawErrors.length - errors.length), localStored
  };
}
