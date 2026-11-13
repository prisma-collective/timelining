// Needs the test Neo4j from test/test-env (pnpm test starts it).
import { Session } from 'neo4j-driver';
import { closeDriver, getDriver, initDriver } from '../../src/lib/db/neo4j';
import type { ExternalEntryEnvelope } from '../../src/services/external/envelope';
import { createExternalEntry } from '../../src/services/externalEntryService';

jest.setTimeout(30000);

// Synthetic ids, so cleanup can't touch real data.
const envelope: ExternalEntryEnvelope = {
  source: 'github',
  externalId: 'external-entry-test:D13',
  topic: '_botDecidir',
  occurredAt: '2026-10-28T12:00:00.000Z',
  sourceRef: 'external-entry-test/repo',
  participant: { handle: 'external_entry_test' },
  text: 'D13 is now Proposed',
  data: { decision: 'D13', status: 'Proposed' },
};

async function cleanup(session: Session): Promise<void> {
  await session.run(
    `MATCH (e:Entry {source: 'github'}) WHERE e.externalId STARTS WITH 'external-entry-test'
     OPTIONAL MATCH (e)-[:HAS_TEXT]->(t:TextContent) DETACH DELETE e, t`
  );
  await session.run(`MATCH (s:Source {ref: 'external-entry-test/repo'}) DETACH DELETE s`);
  await session.run(`MATCH (p:Participant {handle: 'github:external_entry_test'}) DETACH DELETE p`);
}

describe('External entries in Neo4j', () => {
  let session: Session;

  beforeAll(async () => {
    await initDriver();
    session = getDriver().session();
    await cleanup(session);
  });

  afterAll(async () => {
    await cleanup(session);
    await session.close();
    await closeDriver();
  });

  it('writes the entry with its source, topic, data, text, Source and participant', async () => {
    const write = await createExternalEntry(envelope);
    expect(write.created).toBe(true);

    const result = await session.run(
      `
      MATCH (e:Entry {id: $id})-[:FROM_SOURCE]->(s:Source), (e)-[:SENT_BY]->(p:Participant), (e)-[:HAS_TEXT]->(t:TextContent)
      RETURN e.source AS source, e.topic AS topic, e.data AS data, e.resolveStatus AS status,
             s.kind AS kind, s.ref AS ref, p.handle AS handle, t.text AS text
      `,
      { id: write.id }
    );
    const row = result.records[0].toObject();
    expect(row).toEqual({
      source: 'github',
      topic: '_botDecidir',
      data: JSON.stringify(envelope.data),
      status: 'pending',
      kind: 'github',
      ref: 'external-entry-test/repo',
      handle: 'github:external_entry_test',
      text: 'D13 is now Proposed',
    });
  });

  it('stores a resend once, with one text', async () => {
    const first = await createExternalEntry(envelope);
    const again = await createExternalEntry(envelope);
    expect(again).toEqual({ id: first.id, created: false });

    const counts = await session.run(
      `MATCH (e:Entry {source: 'github', externalId: $externalId}) OPTIONAL MATCH (e)-[:HAS_TEXT]->(t)
       RETURN count(DISTINCT e) AS entries, count(t) AS texts`,
      { externalId: envelope.externalId }
    );
    expect(Number(counts.records[0].get('entries'))).toBe(1);
    expect(Number(counts.records[0].get('texts'))).toBe(1);
  });

  it('keeps the participant apart from a Telegram one with the same name', async () => {
    const write = await createExternalEntry({ ...envelope, externalId: 'external-entry-test:other' });
    const result = await session.run(
      `MATCH (:Entry {id: $id})-[:SENT_BY]->(p:Participant) RETURN p.handle AS handle, p.source AS source`,
      { id: write.id }
    );
    expect(result.records[0].toObject()).toEqual({ handle: 'github:external_entry_test', source: 'github' });
  });
});
