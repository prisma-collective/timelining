import { GET, POST } from '@/app/api/story/ingest/route';
import { runIngest } from '@/services/ingest';
import { NextRequest } from 'next/server';

jest.mock('@/services/ingest/index', () => ({
  runIngest: jest.fn(),
}));

const mockedRunIngest = runIngest as jest.MockedFunction<typeof runIngest>;

describe('API /api/story/ingest', () => {
  beforeEach(() => {
    mockedRunIngest.mockReset();
  });

  it('should return 405 for non-GET requests', async () => {
    const res = await POST();
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).toBe('Method Not Allowed');
  });

  it('should call runIngest and return result', async () => {
    const fakeResult = {
      status: 'success',
      processed_count: 5,
    };
    mockedRunIngest.mockResolvedValue(fakeResult);

    const req = new NextRequest('http://localhost/api/story/ingest', { method: 'GET' });
    const res = await GET(req);

    expect(mockedRunIngest).toHaveBeenCalled();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'Ingest executed',
      result: fakeResult,
    });
  });

  it('should handle runIngest errors gracefully', async () => {
    mockedRunIngest.mockRejectedValue(new Error('Something failed'));

    const res = await GET(new NextRequest('http://localhost/api/story/ingest', { method: 'GET' }));

    expect(res.status).toBe(500);
  });
});
