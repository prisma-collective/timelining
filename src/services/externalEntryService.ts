import type { Transaction } from 'neo4j-driver';
import { getDriver } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import type { ExternalEntryEnvelope } from '@/services/external/envelope';

export interface ExternalEntryWrite {
  id: string;
  /** False when (source, externalId) was already there: a resend. */
  created: boolean;
}

/**
 * Writes an entry from another source. It hangs from a Source node instead of a TelegramChat,
 * carries its own source and topic, and is de-duplicated by (source, externalId).
 * The participant handle is prefixed with the source, so it never matches a Telegram handle.
 */
export async function createExternalEntry(envelope: ExternalEntryEnvelope): Promise<ExternalEntryWrite> {
  const session = getDriver().session({ database: 'neo4j' });
  try {
    const result = await session.writeTransaction((tx: Transaction) =>
      tx.run(
        `
        OPTIONAL MATCH (existing:Entry {source: $source, externalId: $externalId})
        WITH existing IS NULL AS created
        MERGE (s:Source {kind: $source, ref: $sourceRef})
        MERGE (p:Participant {handle: $handle})
          ON CREATE SET p.source = $source
        MERGE (e:Entry {source: $source, externalId: $externalId})
          ON CREATE SET
            e.id = randomUUID(),
            e.date = datetime($occurredAt),
            e.topic = $topic,
            e.data = $data,
            e.resolveStatus = 'pending',
            e.resolvedAt = null
        MERGE (e)-[:FROM_SOURCE]->(s)
        MERGE (e)-[:SENT_BY]->(p)
        WITH e, created
        CALL {
          WITH e, created
          WITH e WHERE created AND $text IS NOT NULL
          CREATE (t:TextContent {id: randomUUID(), text: $text})
          MERGE (e)-[:HAS_TEXT]->(t)
        }
        RETURN e.id AS id, created
        `,
        {
          source: envelope.source,
          externalId: envelope.externalId,
          sourceRef: envelope.sourceRef,
          handle: `${envelope.source}:${envelope.participant.handle}`,
          occurredAt: envelope.occurredAt,
          topic: envelope.topic,
          data: envelope.data === undefined ? null : JSON.stringify(envelope.data),
          text: envelope.text ?? null,
        }
      )
    );

    const record = result.records[0];
    const write = { id: record.get('id') as string, created: record.get('created') as boolean };
    logger.info('External entry written', { source: envelope.source, externalId: envelope.externalId, ...write });
    return write;
  } finally {
    await session.close();
  }
}
