import { GET, POST } from '@/app/api/story/resource-vectorise/route';
import { runResourceVectoriseWithAvailabilityCheck } from '@/services/vectorise/resource';
import { NextRequest } from 'next/server';

jest.mock('@/services/vectorise/resource', () => ({
  runResourceVectoriseWithAvailabilityCheck: jest.fn(),
  buildResourceVectoriseResult: jest.fn(async (run: { chunked: number; vectorised: number; failed: number }) => ({
    status: 'success',
    schedule: '15min',
    chunked: run.chunked,
    vectorised: run.vectorised,
    failed: run.failed,
    outstanding: 0,
    pipeline: { pending: 0, transcribed: 0, chunked: 0, vectorised: 0, failed: 0 },
    hasMore: false,
  })),
}));

jest.mock('@/services/vectorise/resource/chunk', () => ({
  chunkStage: jest.fn(),
}));

jest.mock('@/services/vectorise/resource/stage', () => ({
  embedStage: jest.fn(),
}));

const mockedRun = runResourceVectoriseWithAvailabilityCheck as jest.MockedFunction<
  typeof runResourceVectoriseWithAvailabilityCheck
>;

function buildRequest(method: 'GET' | 'POST', query = '') {
  return new NextRequest(`http://localhost:3000/api/story/resource-vectorise${query}`, {
    method,
    headers: { 'x-vercel-cron': '1' },
  });
}

describe('API /api/story/resource-vectorise', () => {
  beforeEach(() => {
    mockedRun.mockReset();
  });

  it('runs resource vectorise on cron GET', async () => {
    mockedRun.mockResolvedValue({ status: 'success', chunked: 1, vectorised: 2, failed: 0 });

    const res = await GET(buildRequest('GET'));
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalled();
  });

  it('handles skipped neo4j state', async () => {
    mockedRun.mockResolvedValue({
      status: 'skipped',
      message: 'Neo4j not configured.',
      chunked: 0,
      vectorised: 0,
      failed: 0,
    });

    const res = await POST(buildRequest('POST'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.status).toBe('skipped');
  });
});
