import { runExternalIngest } from '@/services/ingest/external';
import { redis } from '@/lib/redis';
import { createExternalEntry } from '@/services/externalEntryService';
import { triggerResolve } from '@/services/resolve';

jest.mock('@/lib/redis', () => ({
  redis: { rpop: jest.fn(), lpush: jest.fn().mockResolvedValue(1), llen: jest.fn().mockResolvedValue(0) },
}));
jest.mock('@/lib/db/neo4j', () => ({ isNeo4jAvailable: jest.fn().mockResolvedValue(true) }));
jest.mock('@/services/externalEntryService', () => ({ createExternalEntry: jest.fn() }));
jest.mock('@/services/resolve', () => ({ triggerResolve: jest.fn().mockResolvedValue(undefined) }));

const envelope = {
  source: 'github',
  externalId: 'abc123:D13',
  topic: '_botDecidir',
  occurredAt: '2026-10-28T12:00:00.000Z',
  sourceRef: 'prisma-collective/at-tap',
  participant: { handle: 'jikaidoko' },
  text: 'D13 is now Proposed',
};

const queue = (...items: unknown[]) => {
  const rpop = redis.rpop as jest.Mock;
  for (const item of items) rpop.mockResolvedValueOnce(JSON.stringify(item));
  rpop.mockResolvedValueOnce(null);
};

describe('External ingest worker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes a new entry and sends it to its resolver', async () => {
    queue(envelope);
    (createExternalEntry as jest.Mock).mockResolvedValueOnce({ id: 'entry-1', created: true });

    const result = await runExternalIngest();

    expect(createExternalEntry).toHaveBeenCalledWith(envelope);
    expect(triggerResolve).toHaveBeenCalledWith('entry-1', '_botDecidir', { source: 'text' });
    expect(result).toMatchObject({ status: 'success', processed_count: 1, failed_count: 0 });
  });

  it("doesn't resolve a resend again", async () => {
    queue(envelope);
    (createExternalEntry as jest.Mock).mockResolvedValueOnce({ id: 'entry-1', created: false });

    await runExternalIngest();

    expect(triggerResolve).not.toHaveBeenCalled();
  });

  it("doesn't resolve an entry without text", async () => {
    const { text: _text, ...noText } = envelope;
    queue(noText);
    (createExternalEntry as jest.Mock).mockResolvedValueOnce({ id: 'entry-2', created: true });

    await runExternalIngest();

    expect(triggerResolve).not.toHaveBeenCalled();
  });

  it('moves a failed entry to the failed queue and goes on', async () => {
    queue(envelope, { ...envelope, externalId: 'second' });
    (createExternalEntry as jest.Mock)
      .mockRejectedValueOnce(new Error('neo4j down'))
      .mockResolvedValueOnce({ id: 'entry-3', created: true });

    const result = await runExternalIngest();

    expect(redis.lpush).toHaveBeenCalledWith('timelining::ingest::external::failed', expect.stringContaining('neo4j down'));
    expect(result).toMatchObject({ processed_count: 1, failed_count: 1 });
  });
});
