import { describe, expect, it } from 'vitest';
import { oidcStateReturnTo, safeAppReturnTo } from './returnPath';

describe('OIDC application return paths', () => {
  it('restores ordinary admin login as well as interactive reauthentication', () => {
    expect(oidcStateReturnTo({ returnTo: '/admin' })).toBe('/admin');
    expect(oidcStateReturnTo({ returnTo: '/settings', interaction: 'reauthenticate' })).toBe('/settings');
    expect(oidcStateReturnTo({ returnTo: '/planner?date=2026-09-08#calendar' })).toBe('/planner?date=2026-09-08#calendar');
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/%2fevil.test', '/admin\n', '/auth/callback?code=secret', '/ops/grafana', '/unknown', '', null, 3])('rejects non-app or ambiguous return %s', (candidate) => {
    expect(safeAppReturnTo(candidate)).toBe('/today');
  });
  it('sanitizes fallback paths and absent state', () => {
    expect(oidcStateReturnTo(undefined, '/settings')).toBe('/settings');
    expect(oidcStateReturnTo(null, '//evil.test')).toBe('/today');
    expect(oidcStateReturnTo({ returnTo: '//evil.test' }, '/admin')).toBe('/today');
  });
});
