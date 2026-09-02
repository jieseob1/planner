import { describe, expect, it } from 'vitest';
import { formatMinutes } from './format';

describe('formatMinutes', () => {
  it('rounds floating-point artifacts before showing calendar durations', () => {
    expect(formatMinutes(25.000000000000007)).toBe('25분');
    expect(formatMinutes(89.99999999999999)).toBe('1시간 30분');
  });
});
