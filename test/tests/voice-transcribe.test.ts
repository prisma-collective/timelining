import { GET, POST } from '@/app/api/story/voice-transcribe/route';
import { runTranscribeTick } from '@/services/vectorise';

jest.mock('@/services/vectorise/index', () => ({
  runTranscribeTick: jest.fn(),
}));

const mockedRunTranscribeTick = runTranscribeTick as jest.MockedFunction<typeof runTranscribeTick>;

describe('API /api/story/voice-transcribe', () => {
  beforeEach(() => {
    mockedRunTranscribeTick.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should call runTranscribeTick and return result', async () => {
    const fakeResult = {
      status: 'success' as const,
      transcribed: 1,
      skipped_long: 0,
      failed: 0,
    };
    mockedRunTranscribeTick.mockResolvedValue(fakeResult);

    const res = await GET();

    expect(mockedRunTranscribeTick).toHaveBeenCalled();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Transcribe tick executed',
      result: fakeResult,
    });
  });

  it('should handle runTranscribeTick errors gracefully', async () => {
    mockedRunTranscribeTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
