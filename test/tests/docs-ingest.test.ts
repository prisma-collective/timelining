import { GET, POST } from '@/app/api/docs/ingest/route';
import { runDocsIngest } from '@/services/docs/ingest';
import { NextRequest } from 'next/server';

jest.mock('@/services/docs/ingest', () => ({
  runDocsIngest: jest.fn(),
}));

const mockedRunDocsIngest = runDocsIngest as jest.MockedFunction<typeof runDocsIngest>;

const successResult = {
  status: 'success' as const,
  stats: {
    pages_checked: 10,
    pages_updated: 2,
    pages_created: 1,
  },
  ingestRunId: 'test-run-id',
};

function requestWithAuth(method: string): NextRequest {
  return new NextRequest('http://localhost/api/docs/ingest', {
    method,
    headers: {
      Authorization: 'Bearer test-token',
    },
  });
}

describe('API /api/docs/ingest', () => {
  const originalToken = process.env.PRIVATE_API_TOKEN;

  beforeEach(() => {
    process.env.PRIVATE_API_TOKEN = 'test-token';
    mockedRunDocsIngest.mockReset();
  });

  afterAll(() => {
    process.env.PRIVATE_API_TOKEN = originalToken;
  });

  it('should return 401 without authorization', async () => {
    const res = await GET(new NextRequest('http://localhost/api/docs/ingest'));

    expect(res.status).toBe(401);
    expect(mockedRunDocsIngest).not.toHaveBeenCalled();
  });

  it('should run ingest on GET with x-vercel-cron header', async () => {
    mockedRunDocsIngest.mockResolvedValue(successResult);

    const res = await GET(
      new NextRequest('http://localhost/api/docs/ingest', {
        headers: { 'x-vercel-cron': '1' },
      })
    );

    expect(mockedRunDocsIngest).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('should run ingest on GET with Vercel cron schedule header', async () => {
    mockedRunDocsIngest.mockResolvedValue(successResult);

    const res = await GET(
      new NextRequest('http://localhost/api/docs/ingest', {
        headers: {
          'x-vercel-cron-schedule': '0 */6 * * *',
          'user-agent': 'vercel-cron/1.0',
        },
      })
    );

    expect(mockedRunDocsIngest).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('should run ingest on GET with valid token', async () => {
    mockedRunDocsIngest.mockResolvedValue(successResult);

    const res = await GET(requestWithAuth('GET'));

    expect(mockedRunDocsIngest).toHaveBeenCalled();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual(successResult);
  });

  it('should run ingest on POST with valid token', async () => {
    mockedRunDocsIngest.mockResolvedValue(successResult);

    const res = await POST(requestWithAuth('POST'));

    expect(mockedRunDocsIngest).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('should return 500 when ingest reports error', async () => {
    mockedRunDocsIngest.mockResolvedValue({
      status: 'error',
      message: 'snapshot failed: 503',
      stats: { pages_checked: 0, pages_updated: 0, pages_created: 0 },
    });

    const res = await GET(requestWithAuth('GET'));

    expect(res.status).toBe(500);
  });
});
