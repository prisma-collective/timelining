import { GET, POST } from '@/app/api/story/voice-vectorise/route';
import { buildVoiceVectoriseResult } from '@/services/vectorise';

jest.mock('@/services/vectorise/index', () => ({
  buildVoiceVectoriseResult: jest.fn(),
}));

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
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockedBuildVoiceVectoriseResult.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should fetch both sub-routes in parallel and return merged result', async () => {
    mockedBuildVoiceVectoriseResult.mockResolvedValue(mergedResult);

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('voice-transcribe')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: transcribeTickResult }),
        });
      }
      if (url.includes('voice-chunk-vectorise')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: vectoriseTickResult }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    const res = await GET();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/story/voice-transcribe')
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/story/voice-chunk-vectorise')
    );
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

  it('should surface partial results when a sub-route fails', async () => {
    const partialMerged = {
      ...mergedResult,
      status: 'error' as const,
      message: 'transcribe tick returned 500',
    };
    mockedBuildVoiceVectoriseResult.mockResolvedValue(partialMerged);

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('voice-transcribe')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Whisper failed' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: vectoriseTickResult }),
      });
    });

    const res = await GET();

    expect(mockedBuildVoiceVectoriseResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', message: 'Whisper failed' }),
      vectoriseTickResult
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.result.status).toBe('error');
  });

  it('should handle buildVoiceVectoriseResult errors gracefully', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: transcribeTickResult }),
    });
    mockedBuildVoiceVectoriseResult.mockRejectedValue(new Error('Something failed'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
