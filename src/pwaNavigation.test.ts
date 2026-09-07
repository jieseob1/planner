import { describe, expect, it } from 'vitest';
import { navigationFallbackDenylist } from './pwaNavigation';

describe('PWA server route isolation', () => {
  it('leaves Grafana, identity and API navigation to the server', () => {
    for (const path of ['/ops', '/ops?x=1', '/ops/grafana/', '/ops/grafana/login', '/ops/grafana/d/nowline-api', '/idp/realms/nowline', '/api/v1/planner']) {
      expect(navigationFallbackDenylist.some(rule => rule.test(path)), path).toBe(true);
    }
  });
  it('retains offline planner navigation without overmatching prefixes', () => {
    for (const path of ['/', '/today', '/plans', '/admin', '/review', '/ops-example']) {
      expect(navigationFallbackDenylist.some(rule => rule.test(path)), path).toBe(false);
    }
  });
});
