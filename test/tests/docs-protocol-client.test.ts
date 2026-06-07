import { fetchProtocolSchema } from '@/services/docs/client';

describe('fetchProtocolSchema', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env.DOCS_APP_URL = 'https://docs.example.com';
    process.env.PRIVATE_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it('returns content and commitSha on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: '# Schema\nfield: string',
        commitSha: 'abc123',
      }),
    });

    const result = await fetchProtocolSchema('enrolment');
    expect(result).toEqual({
      content: '# Schema\nfield: string',
      commitSha: 'abc123',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://docs.example.com/api/protocol/enrolment',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );
  });

  it('throws schema_not_found on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(fetchProtocolSchema('deciding')).rejects.toThrow('schema_not_found: deciding');
  });
});
