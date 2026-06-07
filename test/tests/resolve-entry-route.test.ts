import { POST } from '@/app/api/story/resolve/entry/route';
import { runEntryResolve } from '@/services/resolve';
import { NextRequest } from 'next/server';

jest.mock('@/services/resolve/index', () => ({
  runEntryResolve: jest.fn(),
  runResolveEntriesTick: jest.fn(),
  buildResolveEntriesResult: jest.fn(),
  dispatchEntryResolves: jest.fn(),
}));

const mockedRunEntryResolve = runEntryResolve as jest.MockedFunction<typeof runEntryResolve>;

function buildRequest(body: object, token = 'test-token') {
  return new NextRequest('http://localhost:3000/api/story/resolve/entry', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('API /api/story/resolve/entry', () => {
  const originalToken = process.env.PRIVATE_API_TOKEN;

  beforeEach(() => {
    process.env.PRIVATE_API_TOKEN = 'test-token';
    mockedRunEntryResolve.mockReset();
  });

  afterAll(() => {
    process.env.PRIVATE_API_TOKEN = originalToken;
  });

  it('rejects missing entryId', async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects unauthorized requests', async () => {
    const res = await POST(buildRequest({ entryId: 'e1' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  it('runs entry resolve for valid request', async () => {
    mockedRunEntryResolve.mockResolvedValue({
      entryId: 'e1',
      handler: 'enrolment',
      resolveStatus: 'successful',
    });

    const res = await POST(buildRequest({ entryId: 'e1' }));
    expect(res.status).toBe(200);
    expect(mockedRunEntryResolve).toHaveBeenCalledWith('e1');

    const json = await res.json();
    expect(json.result.resolveStatus).toBe('successful');
  });
});
