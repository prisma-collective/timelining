import { initDriver } from '@/lib/db/neo4j';
import type { ResolveStatus } from '@/lib/db/models/entry';
import neo4j from 'neo4j-driver';
import { RESOLVE_TOPICS, entryMeetsVoiceGate, handlerForTopic } from './registry';
import type { ResolveContext, ResolveStatusCounts } from './types';

// Must stay aligned with entryMeetsVoiceGate() in registry.ts
const PENDING_PICK_MATCH = `
  MATCH (e:Entry)-[:FROM_CHAT]->(c:TelegramChat)
  WHERE e.resolveStatus = 'pending' AND c.topic IN $topics
  OPTIONAL MATCH (e)-[:HAS_VOICE]->(v:Voice)
  WITH e, v
  WHERE v IS NULL OR v.transcription IS NOT NULL
`;

export async function pickEntriesPendingResolve(limit: number): Promise<string[]> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      ${PENDING_PICK_MATCH}
      RETURN DISTINCT e.id AS entryId
      ORDER BY e.date
      LIMIT $limit
      `,
      { topics: RESOLVE_TOPICS, limit: neo4j.int(limit) }
    );
    return result.records.map((r) => r.get('entryId') as string);
  } finally {
    await session.close();
  }
}

export async function countEntriesPendingResolve(): Promise<number> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      ${PENDING_PICK_MATCH}
      RETURN count(DISTINCT e) AS count
      `,
      { topics: RESOLVE_TOPICS }
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function countResolveStatusByStatus(): Promise<ResolveStatusCounts> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)-[:FROM_CHAT]->(c:TelegramChat)
      WHERE c.topic IN $topics
      RETURN e.resolveStatus AS status, count(DISTINCT e) AS count
      `,
      { topics: RESOLVE_TOPICS }
    );

    const counts: ResolveStatusCounts = {
      unset: 0,
      pending: 0,
      attempted: 0,
      successful: 0,
      failed: 0,
    };

    for (const record of result.records) {
      const status = record.get('status') as ResolveStatus | null;
      const count = record.get('count').toNumber();
      if (status == null) {
        counts.unset += count;
      } else if (status in counts) {
        counts[status] += count;
      }
    }

    return counts;
  } finally {
    await session.close();
  }
}

export async function markEntryResolveAttempted(entryId: string): Promise<boolean> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry { id: $entryId, resolveStatus: 'pending' })
      SET e.resolveStatus = 'attempted',
          e.resolveAttemptedAt = datetime()
      RETURN e.id AS entryId
      `,
      { entryId }
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

export async function markEntryResolveSuccessful(entryId: string): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      SET e.resolveStatus = 'successful',
          e.resolvedAt = datetime(),
          e.resolveFailureReason = null
      `,
      { entryId }
    );
  } finally {
    await session.close();
  }
}

export async function markEntryResolveFailed(
  entryId: string,
  reason: string
): Promise<void> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      SET e.resolveStatus = 'failed',
          e.resolveFailureReason = $reason
      `,
      { entryId, reason }
    );
  } finally {
    await session.close();
  }
}

export async function loadResolveContext(entryId: string): Promise<ResolveContext | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry { id: $entryId })-[:SENT_BY]->(p:Participant)
      MATCH (e)-[:FROM_CHAT]->(c:TelegramChat)
      OPTIONAL MATCH (e)-[:HAS_TEXT]->(t:TextContent)
      OPTIONAL MATCH (e)-[:HAS_VOICE]->(v:Voice)
      RETURN e.id AS entryId,
             c.topic AS topic,
             p.handle AS participantHandle,
             t.text AS textContent,
             v.transcription AS transcription,
             v.processingStatus AS voiceStatus
      `,
      { entryId }
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    const topic = record.get('topic') as string | null;
    const handler = handlerForTopic(topic ?? undefined);
    if (!handler) return null;

    const voiceStatus = record.get('voiceStatus') as string | null;
    const transcription = record.get('transcription') as string | undefined;

    if (!entryMeetsVoiceGate(voiceStatus, transcription)) {
      return null;
    }

    return {
      entryId,
      topic: topic ?? '',
      handler,
      participantHandle: record.get('participantHandle') as string,
      textContent: record.get('textContent') as string | undefined,
      transcription,
    };
  } finally {
    await session.close();
  }
}
