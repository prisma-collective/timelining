import { NextRequest } from 'next/server';
import { POST } from '@/app/api/github/webhook/route';
import { redis } from '@/lib/redis';
import { dispatchInternalRoute } from '@/lib/internal-dispatch';

jest.mock('@/lib/redis', () => ({
  redis: { lpush: jest.fn().mockResolvedValue(1) },
}));

jest.mock('@/lib/internal-dispatch', () => ({
  ...jest.requireActual('@/lib/internal-dispatch'),
  dispatchInternalRoute: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: (fn: () => unknown) => fn(),
}));

const envelope = {
  source: 'github',
  externalId: 'abc123:D13',
  topic: '_botDecidir',
  occurredAt: '2026-10-28T12:00:00Z',
  sourceRef: 'prisma-collective/at-tap',
  participant: { handle: 'jikaidoko' },
  text: 'D13 is now Proposed',
};

function request(body: unknown, token?: string) {
  return new NextRequest('https://timelining.test/api/github/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/github/webhook', () => {
  const env = process.env.EXTERNAL_ENTRY_TOKENS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXTERNAL_ENTRY_TOKENS = 'github=gh-secret,enrol=enrol-secret';
  });

  afterAll(() => {
    process.env.EXTERNAL_ENTRY_TOKENS = env;
  });

  it('queues a valid entry and starts the worker', async () => {
    const res = await POST(request(envelope, 'gh-secret'));

    expect(res.status).toBe(202);
    expect(redis.lpush).toHaveBeenCalledWith(
      'timelining::ingest::external',
      JSON.stringify({ ...envelope, occurredAt: '2026-10-28T12:00:00.000Z' })
    );
    expect(dispatchInternalRoute).toHaveBeenCalledWith(
      'https://timelining.test',
      '/api/entries/ingest?limit=1',
      { chain: true }
    );
  });

  it('refuses an unknown token', async () => {
    const res = await POST(request(envelope, 'wrong'));
    expect(res.status).toBe(401);
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it("refuses another source's token", async () => {
    const res = await POST(request(envelope, 'enrol-secret'));
    expect(res.status).toBe(401);
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('refuses everything while no github token is configured', async () => {
    process.env.EXTERNAL_ENTRY_TOKENS = 'enrol=enrol-secret';
    const res = await POST(request(envelope, 'enrol-secret'));
    expect(res.status).toBe(503);
  });

  it('refuses everything while no token is configured', async () => {
    delete process.env.EXTERNAL_ENTRY_TOKENS;
    const res = await POST(request(envelope, 'gh-secret'));
    expect(res.status).toBe(503);
  });

  it('refuses a bad envelope with the reason', async () => {
    const res = await POST(request({ ...envelope, topic: '_botNope' }, 'gh-secret'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'topic must be a known organising channel' });
    expect(redis.lpush).not.toHaveBeenCalled();
  });

  it('refuses invalid JSON', async () => {
    const res = await POST(request('{not json', 'gh-secret'));
    expect(res.status).toBe(400);
  });
});
