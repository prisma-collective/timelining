import { GET, POST } from '@/app/api/story/page-vectorise/route';
import { buildPageVectoriseResult, runPageVectoriseTick } from '@/services/vectorise';
import { NextRequest } from 'next/server';

jest.mock('@/services/vectorise/index', () => ({
  runPageVectoriseTick: jest.fn(),
  buildPageVectoriseResult: jest.fn(),
  runTranscribeTick: jest.fn(),
  runVectoriseTick: jest.fn(),
  buildVoiceVectoriseResult: jest.fn(),
}));

const mockedRunPageVectoriseTick = runPageVectoriseTick as jest.MockedFunction<
  typeof runPageVectoriseTick
>;
const mockedBuildPageVectoriseResult = buildPageVectoriseResult as jest.MockedFunction<
  typeof buildPageVectoriseResult
>;

const tickResult = {
  status: 'success' as const,
  vectorised: 2,
  failed: 0,
};

const mergedResult = {
  status: 'success' as const,
  schedule: '30s' as const,
  vectorised: 2,
  failed: 0,
  outstanding: 5,
  hasMore: true,
};

function buildRequest(method: 'GET' | 'POST') {
  return new NextRequest('http://localhost:3000/api/story/page-vectorise', {
    method,
    headers: { 'x-vercel-cron': '1' },
  });
}

describe('API /api/story/page-vectorise', () => {
  beforeEach(() => {
    mockedRunPageVectoriseTick.mockReset();
    mockedBuildPageVectoriseResult.mockReset();
  });

  it('should handle POST for internal chaining', async () => {
    mockedRunPageVectoriseTick.mockResolvedValue(tickResult);
    mockedBuildPageVectoriseResult.mockResolvedValue({
      ...mergedResult,
      hasMore: false,
    });

    const res = await POST(buildRequest('POST'));
    expect(res.status).toBe(200);
  });

  it('should run page vectorise tick and return merged result', async () => {
    mockedRunPageVectoriseTick.mockResolvedValue(tickResult);
    mockedBuildPageVectoriseResult.mockResolvedValue(mergedResult);

    const res = await GET(buildRequest('GET'));

    expect(mockedRunPageVectoriseTick).toHaveBeenCalled();
    expect(mockedBuildPageVectoriseResult).toHaveBeenCalledWith(tickResult);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Page vectorise executed',
      result: { ...mergedResult, retriggered: true },
    });
  });

  it('should handle tick errors gracefully', async () => {
    mockedRunPageVectoriseTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET(buildRequest('GET'));

    expect(res.status).toBe(500);
  });
});
