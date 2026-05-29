import { GET, POST } from '@/app/api/story/voice-vectorise/route';
import {
  buildVoiceVectoriseResult,
  runTranscribeTick,
  runVectoriseTick,
} from '@/services/vectorise';

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
};

describe('API /api/story/voice-vectorise', () => {
  beforeEach(() => {
    mockedRunTranscribeTick.mockReset();
    mockedRunVectoriseTick.mockReset();
    mockedBuildVoiceVectoriseResult.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should run both ticks in parallel and return merged result', async () => {
    mockedRunTranscribeTick.mockResolvedValue(transcribeTickResult);
    mockedRunVectoriseTick.mockResolvedValue(vectoriseTickResult);
    mockedBuildVoiceVectoriseResult.mockResolvedValue(mergedResult);

    const res = await GET();

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
      result: mergedResult,
    });
  });

  it('should handle tick errors gracefully', async () => {
    mockedRunTranscribeTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
