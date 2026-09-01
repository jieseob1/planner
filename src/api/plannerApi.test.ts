import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../data/demo';
import {
  createPlannerApiClient,
  PlannerConflictError
} from './plannerApi';

const aggregateResponse = (revision: number) => new Response(JSON.stringify({
  revision,
  snapshot: createDemoSnapshot()
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` }
});

describe('plannerApi', () => {
  it('uses an absolute native API base and conditional GET headers', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => aggregateResponse(12));
    const client = createPlannerApiClient({
      baseUrl: 'http://10.0.2.2:8080/',
      accessTokenProvider: async () => 'test-access-token',
      fetchImpl
    });

    const result = await client.get('"11"');

    expect(result.kind).toBe('found');
    expect(fetchImpl).toHaveBeenCalledWith('http://10.0.2.2:8080/api/v1/planner', expect.objectContaining({
      method: 'GET'
    }));
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-access-token');
    expect(headers.get('If-None-Match')).toBe('"11"');
  });

  it('uses create and update preconditions with caller-supplied idempotency keys', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => aggregateResponse(1));
    const client = createPlannerApiClient({ fetchImpl, accessTokenProvider: async () => 'test-access-token' });
    const snapshot = createDemoSnapshot();

    await client.put(snapshot, null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await client.put(snapshot, 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    const createHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(createHeaders.get('If-None-Match')).toBe('*');
    expect(createHeaders.get('If-Match')).toBeNull();
    expect(createHeaders.get('Idempotency-Key')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    const updateHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(updateHeaders.get('If-None-Match')).toBeNull();
    expect(updateHeaders.get('If-Match')).toBe('"1"');
    expect(updateHeaders.get('Idempotency-Key')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('sends revision and idempotency headers when deleting', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 204 })
    ));
    const client = createPlannerApiClient({ fetchImpl, accessTokenProvider: async () => 'test-access-token' });

    await client.delete(9, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('DELETE');
    expect(headers.get('If-Match')).toBe('"9"');
    expect(headers.get('Idempotency-Key')).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('turns 409 and 412 problem details into explicit conflict errors', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      title: 'Revision conflict',
      status: 412,
      detail: 'Expected revision 3.'
    }), { status: 412, headers: { 'Content-Type': 'application/problem+json' } }));
    const client = createPlannerApiClient({ fetchImpl, accessTokenProvider: async () => 'test-access-token' });

    const error = await client.put(
      createDemoSnapshot(),
      2,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PlannerConflictError);
    expect(error).toMatchObject({
      name: 'PlannerConflictError',
      status: 412,
      message: 'Expected revision 3.'
    });
  });
});
