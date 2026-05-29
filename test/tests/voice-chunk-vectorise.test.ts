import { GET, POST } from '@/app/api/story/voice-chunk-vectorise/route';
import { runVectoriseTick } from '@/services/vectorise';

jest.mock('@/services/vectorise/index', () => ({
  runVectoriseTick: jest.fn(),
}));

const mockedRunVectoriseTick = runVectoriseTick as jest.MockedFunction<typeof runVectoriseTick>;

describe('API /api/story/voice-chunk-vectorise', () => {
  beforeEach(() => {
    mockedRunVectoriseTick.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should call runVectoriseTick and return result', async () => {
    const fakeResult = {
      status: 'success' as const,
      vectorised: 2,
      failed: 0,
    };
    mockedRunVectoriseTick.mockResolvedValue(fakeResult);

    const res = await GET();

    expect(mockedRunVectoriseTick).toHaveBeenCalled();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Vectorise tick executed',
      result: fakeResult,
    });
  });

  it('should handle runVectoriseTick errors gracefully', async () => {
    mockedRunVectoriseTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
