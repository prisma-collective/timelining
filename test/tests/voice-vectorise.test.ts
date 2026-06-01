import { GET, POST } from '@/app/api/story/voice-vectorise/route';
import {
  buildVoiceVectoriseResult,
  runTranscribeTick,
  runVectoriseTick,
} from '@/services/vectorise';
import { NextRequest } from 'next/server';

jest.mock('@/services/vectorise/index', () => ({
  runTranscribeTick: jest.fn(),
  runVectoriseTick: jest.fn(),
  buildVoiceVectoriseResult: jest.fn(),
}));

const mockedRunTranscribeTick = runTranscribeTick as jest.MockedFunction<typeof runTranscribeTick>;
const mockedRunVectoriseTick = runVectoriseTick as jest.MockedFunction<typeof runVectoriseTick>;
const mockedBuildVoiceVectoriseResult = buildVoiceVectoriseResult as jest.MockedFunction<
  typeof buildVoiceVectoriseResult
>;

const transcribeTickResult = {
  status: 'success' as const,
  transcribed: 1,
  skipped_long: 0,
  failed: 0,
};

const vectoriseTickResult = {
  status: 'success' as const,
  vectorised: 2,
  failed: 0,
};

const mergedResult = {
  status: 'success' as const,
  schedule: '30s' as const,
  transcribed: 1,
  vectorised: 2,
  skipped_long: 0,
  failed: 0,
  outstanding: 3,
  pipeline: {
    pending: 1,
    transcribed: 2,
    vectorised: 10,
    failed: 0,
    deferred_long: 0,
  },
  hasMore: true,
};

function buildRequest(method: 'GET' | 'POST') {
  return new NextRequest('http://localhost:3000/api/story/voice-vectorise', {
    method,
    headers: { 'x-vercel-cron': '1' },
  });
}

describe('API /api/story/voice-vectorise', () => {
  beforeEach(() => {
    mockedRunTranscribeTick.mockReset();
    mockedRunVectoriseTick.mockReset();
    mockedBuildVoiceVectoriseResult.mockReset();
  });

  it('should handle POST for internal chaining', async () => {
    mockedRunTranscribeTick.mockResolvedValue(transcribeTickResult);
    mockedRunVectoriseTick.mockResolvedValue(vectoriseTickResult);
    mockedBuildVoiceVectoriseResult.mockResolvedValue({
      ...mergedResult,
      hasMore: false,
    });

    const res = await POST(buildRequest('POST'));
    expect(res.status).toBe(200);
  });

  it('should run both ticks in parallel and return merged result', async () => {
    mockedRunTranscribeTick.mockResolvedValue(transcribeTickResult);
    mockedRunVectoriseTick.mockResolvedValue(vectoriseTickResult);
    mockedBuildVoiceVectoriseResult.mockResolvedValue(mergedResult);

    const res = await GET(buildRequest('GET'));

    expect(mockedRunTranscribeTick).toHaveBeenCalled();
    expect(mockedRunVectoriseTick).toHaveBeenCalled();
    expect(mockedBuildVoiceVectoriseResult).toHaveBeenCalledWith(
      transcribeTickResult,
      vectoriseTickResult
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Voice vectorise executed',
      result: { ...mergedResult, retriggered: true },
    });
  });

  it('should handle tick errors gracefully', async () => {
    mockedRunTranscribeTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET(buildRequest('GET'));

    expect(res.status).toBe(500);
  });
});
