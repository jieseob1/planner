import type { PlannerAggregate, PlannerSnapshot, ProblemDetails } from '../domain/types';

const PLANNER_PATH = '/api/v1/planner';
const DEFAULT_LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PlannerReadResult =
  | { kind: 'found'; aggregate: PlannerAggregate; etag: string }
  | { kind: 'missing' }
  | { kind: 'not-modified'; etag: string | null };

export interface PlannerApiClient {
  get: (etag?: string | null) => Promise<PlannerReadResult>;
  put: (
    snapshot: PlannerSnapshot,
    revision: number | null,
    idempotencyKey: string
  ) => Promise<{ aggregate: PlannerAggregate; etag: string }>;
  delete: (revision: number, idempotencyKey: string) => Promise<void>;
}

export interface PlannerApiClientOptions {
  baseUrl?: string;
  userId?: string;
  fetchImpl?: FetchLike;
}

export class PlannerApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, message: string, problem: ProblemDetails | null = null) {
    super(message);
    this.name = 'PlannerApiError';
    this.status = status;
    this.problem = problem;
  }
}

export class PlannerConflictError extends PlannerApiError {
  constructor(status: 409 | 412, problem: ProblemDetails | null) {
    super(status, problem?.detail ?? 'Planner revision conflict', problem);
    this.name = 'PlannerConflictError';
  }
}

const normalizeBaseUrl = (value: string | undefined) => (value ?? '').trim().replace(/\/+$/, '');

const revisionEtag = (revision: number) => `"${revision}"`;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isPlannerAggregate = (value: unknown): value is PlannerAggregate => (
  isRecord(value)
  && typeof value.revision === 'number'
  && Number.isSafeInteger(value.revision)
  && value.revision >= 0
  && isRecord(value.snapshot)
  && value.snapshot.version === 1
);

const readProblem = async (response: Response): Promise<ProblemDetails | null> => {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value as ProblemDetails : null;
  } catch {
    return null;
  }
};

const readAggregate = async (response: Response): Promise<PlannerAggregate> => {
  let value: unknown;
  try {
    value = await response.json() as unknown;
  } catch {
    throw new PlannerApiError(response.status, 'Planner API returned invalid JSON');
  }
  if (!isPlannerAggregate(value)) {
    throw new PlannerApiError(response.status, 'Planner API returned an invalid aggregate');
  }
  return value;
};

const throwForResponse = async (response: Response): Promise<never> => {
  const problem = await readProblem(response);
  if (response.status === 409 || response.status === 412) {
    throw new PlannerConflictError(response.status, problem);
  }
  throw new PlannerApiError(
    response.status,
    problem?.detail ?? problem?.title ?? `Planner API request failed (${response.status})`,
    problem
  );
};

export const createIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createPlannerApiClient = ({
  baseUrl,
  userId = DEFAULT_LOCAL_USER_ID,
  fetchImpl = (input, init) => fetch(input, init)
}: PlannerApiClientOptions = {}): PlannerApiClient => {
  const url = `${normalizeBaseUrl(baseUrl)}${PLANNER_PATH}`;
  const commonHeaders = {
    Accept: 'application/json',
    'X-Nowline-User-Id': userId
  };

  return {
    async get(etag) {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          ...commonHeaders,
          ...(etag ? { 'If-None-Match': etag } : {})
        }
      });
      if (response.status === 404) return { kind: 'missing' };
      if (response.status === 304) {
        return { kind: 'not-modified', etag: response.headers.get('ETag') };
      }
      if (!response.ok) return throwForResponse(response);

      const aggregate = await readAggregate(response);
      return {
        kind: 'found',
        aggregate,
        etag: response.headers.get('ETag') ?? revisionEtag(aggregate.revision)
      };
    },

    async put(snapshot, revision, idempotencyKey) {
      const response = await fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          ...(revision === null
            ? { 'If-None-Match': '*' }
            : { 'If-Match': revisionEtag(revision) })
        },
        body: JSON.stringify(snapshot)
      });
      if (!response.ok) return throwForResponse(response);

      const aggregate = await readAggregate(response);
      return {
        aggregate,
        etag: response.headers.get('ETag') ?? revisionEtag(aggregate.revision)
      };
    },

    async delete(revision, idempotencyKey) {
      const response = await fetchImpl(url, {
        method: 'DELETE',
        headers: {
          ...commonHeaders,
          'Idempotency-Key': idempotencyKey,
          'If-Match': revisionEtag(revision)
        }
      });
      if (response.status === 404 || response.status === 204) return;
      if (!response.ok) return throwForResponse(response);
    }
  };
};

export const plannerApi = createPlannerApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  userId: import.meta.env.VITE_NOWLINE_USER_ID || DEFAULT_LOCAL_USER_ID
});
