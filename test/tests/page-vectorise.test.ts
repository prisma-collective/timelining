import { GET, POST } from '@/app/api/story/page-vectorise/route';
import { buildPageVectoriseResult, runPageVectoriseTick } from '@/services/vectorise';

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
};

describe('API /api/story/page-vectorise', () => {
  beforeEach(() => {
    mockedRunPageVectoriseTick.mockReset();
    mockedBuildPageVectoriseResult.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should run page vectorise tick and return merged result', async () => {
    mockedRunPageVectoriseTick.mockResolvedValue(tickResult);
    mockedBuildPageVectoriseResult.mockResolvedValue(mergedResult);

    const res = await GET();

    expect(mockedRunPageVectoriseTick).toHaveBeenCalled();
    expect(mockedBuildPageVectoriseResult).toHaveBeenCalledWith(tickResult);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Page vectorise executed',
      result: mergedResult,
    });
  });

  it('should handle tick errors gracefully', async () => {
    mockedRunPageVectoriseTick.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
