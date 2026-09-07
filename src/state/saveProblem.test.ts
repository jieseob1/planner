import { describe, expect, it } from 'vitest';
import { PlannerApiError } from '../api/plannerApi';
import { plannerSaveProblem } from './saveProblem';

describe('safe planner validation messages', () => {
  it('distinguishes conditional-save metadata errors from editable input errors', () => {
    const result = plannerSaveProblem(new PlannerApiError(400, 'PRIVATE', {
      code: 'invalid-precondition',
      detail: 'If-Match에는 현재 계정에 발급된 strong ETag 한 개가 필요합니다.'
    }), true);
    expect(result).toMatchObject({ kind: 'precondition', code: 'invalid-precondition', localStored: true });
    expect(result?.detail).toContain('입력값의 문제가 아닙니다');
    expect(result?.detail).not.toContain('PRIVATE');
  });

  it('retains validation field paths and translates normal Bean Validation messages', () => {
    const problem = plannerSaveProblem(new PlannerApiError(400, 'unused raw message', {
      code: 'validation-failed', detail: '요청 값이 유효성 규칙을 충족하지 않습니다.',
      errors: [
        { field: 'plan.annualDirection', message: 'must not be blank', rejectedValue: 'PRIVATE_VALUE' },
        { field: 'tasks[0].estimateMinutes', message: 'must be less than or equal to 10080' },
        { field: 'outcomes[2].current', message: 'numeric value out of bounds (<14 digits>.<6 digits> expected)' }
      ], token: 'PRIVATE_TOKEN'
    }), true);
    expect(problem).toMatchObject({
      status: 400, code: 'validation-failed', localStored: true,
      detail: '요청 값이 유효성 규칙을 충족하지 않습니다.',
      errors: [
        { field: 'plan.annualDirection', label: '계획 · 연간 방향', message: '비워 둘 수 없습니다.' },
        { field: 'tasks[0].estimateMinutes', label: '할 일 1번째 · 예상 시간', message: '10080 이하 값을 입력해 주세요.' },
        { field: 'outcomes[2].current', label: '목표 3번째 · 현재 지표', message: '정수 14자리, 소수 6자리 이내로 입력해 주세요.' }
      ]
    });
    expect(JSON.stringify(problem)).not.toContain('PRIVATE');
  });

  it('strips identifiers from domain validation and rejects arbitrary raw details and fields', () => {
    const problem = plannerSaveProblem(new PlannerApiError(400, 'Bearer PRIVATE_TOKEN', {
      code: 'invalid-planner-snapshot', detail: '같은 날짜의 시간 블록이 겹칩니다: PRIVATE_ID',
      errors: [
        { field: 'timeBlocks', message: '같은 날짜의 시간 블록이 겹칩니다: PRIVATE_ID, PRIVATE_TITLE' },
        { field: 'tasks[PRIVATE_KEY].title', message: 'PRIVATE_MESSAGE' },
        { field: 'plan.annualDirection', message: '<script>PRIVATE_SCRIPT</script>' }
      ]
    }), false);
    expect(problem?.detail).toBe('같은 날짜의 시간 블록이 겹칩니다.');
    expect(problem?.errors).toHaveLength(2);
    expect(problem?.localStored).toBe(false);
    expect(JSON.stringify(problem)).not.toMatch(/PRIVATE|script|Bearer/);
    const unknown = plannerSaveProblem(new PlannerApiError(400, 'PRIVATE', {
      code: 'PRIVATE', detail: 'SQL PRIVATE', errors: [{ field: 'headers', message: 'Bearer PRIVATE' }]
    }), true);
    expect(unknown?.code).toBeNull();
    expect(JSON.stringify(unknown)).not.toContain('PRIVATE');
  });

  it('handles absent or malformed problem fields and bounds the visible list', () => {
    expect(plannerSaveProblem(new PlannerApiError(400, 'PRIVATE'), true)?.errors).toEqual([]);
    expect(plannerSaveProblem(new PlannerApiError(400, 'PRIVATE', { detail: {} as string, errors: 'PRIVATE' }), true)?.errors).toEqual([]);
    const result = plannerSaveProblem(new PlannerApiError(400, 'unused', {
      errors: Array.from({ length: 20 }, () => ({ field: 'tasks[].title', message: 'size must be between 0 and 500' }))
    }), true);
    expect(result?.errors).toHaveLength(5);
    expect(result?.additionalErrors).toBe(15);
    expect(result?.errors[0].message).toBe('길이 또는 개수를 0–500 범위로 맞춰 주세요.');
  });

  it('does not relabel connectivity, conflict, or server availability failures as input validation', () => {
    for (const error of [new TypeError('Failed to fetch'), new PlannerApiError(503, 'unavailable'), new PlannerApiError(409, 'conflict')]) {
      expect(plannerSaveProblem(error, true)).toBeNull();
    }
  });
});
