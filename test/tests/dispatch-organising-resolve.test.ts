import {
  buildOrganisingResolveUrl,
  resolveRouteForTopic,
} from '@organising-config';
import {
  dispatchOrganisingResolve,
  dispatchOrganisingResolves,
} from '@/services/webhook/dispatchOrganisingResolve';

describe('dispatchOrganisingResolve', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.PRIVATE_API_TOKEN;

  beforeEach(() => {
    process.env.PRIVATE_API_TOKEN = 'test-token';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.PRIVATE_API_TOKEN = originalToken;
    jest.resetAllMocks();
  });

  it('no-ops for topics without a resolve route', async () => {
    const result = await dispatchOrganisingResolve('entry-1', '_botEvaluation');
    expect(result).toEqual({ dispatched: false, error: 'no_resolve_route' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the configured resolve URL for enrolment', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const result = await dispatchOrganisingResolve('entry-1', '_botEnrolment');

    const route = resolveRouteForTopic('_botEnrolment');
    expect(route).not.toBeNull();
    const url = buildOrganisingResolveUrl(route!.domain, route!.path, 'entry-1');

    expect(global.fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(result.dispatched).toBe(true);
  });

  it('returns failure when the remote endpoint is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 502 });

    const result = await dispatchOrganisingResolve('entry-1', '_botDecidir');
    expect(result.dispatched).toBe(false);
    expect(result.error).toBe('http_502');
  });

  it('batch dispatches multiple entries', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const result = await dispatchOrganisingResolves([
      { entryId: 'entry-1', topic: '_botEnrolment' },
      { entryId: 'entry-2', topic: '_botAgendar' },
      { entryId: 'entry-3', topic: '_botEvaluation' },
    ]);

    expect(result).toEqual({ dispatched: 2, failed: 0, skipped: 1 });
  });
});
