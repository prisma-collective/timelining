import { GET, POST } from '@/app/api/story/voice-vectorise/route';
import { runVoiceVectorise } from '@/services/vectorise';

jest.mock('@/services/vectorise/index', () => ({
  runVoiceVectorise: jest.fn(),
}));

const mockedRunVoiceVectorise = runVoiceVectorise as jest.MockedFunction<typeof runVoiceVectorise>;

describe('API /api/story/voice-vectorise', () => {
  beforeEach(() => {
    mockedRunVoiceVectorise.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should call runVoiceVectorise and return result with schedule', async () => {
    const fakeResult = {
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
    mockedRunVoiceVectorise.mockResolvedValue(fakeResult);

    const res = await GET();

    expect(mockedRunVoiceVectorise).toHaveBeenCalled();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Voice vectorise executed',
      result: fakeResult,
    });
  });

  it('should handle runVoiceVectorise errors gracefully', async () => {
    mockedRunVoiceVectorise.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
