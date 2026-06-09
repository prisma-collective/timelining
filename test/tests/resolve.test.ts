import { GET, POST } from '@/app/api/story/resolve/route';
import { buildResolveEntriesResult, runResolveEntriesTick } from '@/services/resolve';
import { NextRequest } from 'next/server';

jest.mock('@/services/resolve/index', () => ({
  runResolveEntriesTick: jest.fn(),
  buildResolveEntriesResult: jest.fn(),
}));

const mockedRunResolveEntriesTick = runResolveEntriesTick as jest.MockedFunction<
  typeof runResolveEntriesTick
>;
const mockedBuildResolveEntriesResult = buildResolveEntriesResult as jest.MockedFunction<
  typeof buildResolveEntriesResult
>;

const tickResult = {
  status: 'success' as const,
  attempted: 2,
  dispatched: 2,
  failed: 0,
  skipped: 0,
  entryIds: ['entry-1', 'entry-2'],
};

const mergedResult = {
  status: 'success' as const,
  schedule: '30s' as const,
  attempted: 2,
  dispatched: 2,
  failed: 1,
  skipped: 0,
  outstanding: 3,
  resolved: 10,
  attemptedInFlight: 2,
  hasMore: true,
  counts: { unset: 0, pending: 3, attempted: 2, successful: 10, failed: 1 },
};

function buildRequest(method: 'GET' | 'POST') {
  return new NextRequest('http://localhost:3000/api/story/resolve', {
    method,
    headers: { 'x-vercel-cron': '1' },
  });
}

describe('API /api/story/resolve', () => {
  beforeEach(() => {
    mockedRunResolveEntriesTick.mockReset();
    mockedBuildResolveEntriesResult.mockReset();
  });

  it('should handle POST requests', async () => {
    mockedRunResolveEntriesTick.mockResolvedValue(tickResult);
    mockedBuildResolveEntriesResult.mockResolvedValue({
      ...mergedResult,
      hasMore: false,
    });

    const res = await POST(buildRequest('POST'));
    expect(res.status).toBe(200);
  });

  it('should run resolve tick and return merged result', async () => {
    mockedRunResolveEntriesTick.mockResolvedValue(tickResult);
    mockedBuildResolveEntriesResult.mockResolvedValue(mergedResult);

    const res = await GET(buildRequest('GET'));

    expect(mockedRunResolveEntriesTick).toHaveBeenCalled();
    expect(mockedBuildResolveEntriesResult).toHaveBeenCalledWith(tickResult);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Resolve tick executed',
      result: mergedResult,
    });
  });

  it('should handle tick errors gracefully', async () => {
    mockedRunResolveEntriesTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET(buildRequest('GET'));

    expect(res.status).toBe(500);
  });
});
