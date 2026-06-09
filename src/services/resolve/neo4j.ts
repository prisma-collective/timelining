import { initDriver } from '@/lib/db/neo4j';
import type { ResolveStatus } from '@/lib/db/models/entry';
import neo4j from 'neo4j-driver';
import { resolveTopics } from '@organising-config';
import type { ResolveStatusCounts } from './types';

export interface PendingResolveEntry {
  entryId: string;
  topic: string;
}

/** Voice entries are ready when transcribed; text-only entries have no voice node. */
export function entryMeetsVoiceGate(
  voiceStatus: string | null,
  transcription?: string | null
): boolean {
  if (!voiceStatus) return true;
  return !!transcription?.trim();
}

function pendingPickMatch(topics: string[]): { cypher: string; params: { topics: string[] } } {
  return {
    cypher: `
      MATCH (e:Entry)-[:FROM_CHAT]->(c:TelegramChat)
      WHERE e.resolveStatus = 'pending' AND c.topic IN $topics
      OPTIONAL MATCH (e)-[:HAS_VOICE]->(v:Voice)
      WITH e, c, v
      WHERE v IS NULL OR v.transcription IS NOT NULL
    `,
    params: { topics },
  };
}

export async function pickEntriesPendingResolve(limit: number): Promise<PendingResolveEntry[]> {
  const topics = resolveTopics();
  if (topics.length === 0) {
    return [];
  }

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });
  const { cypher, params } = pendingPickMatch(topics);

  try {
    const result = await session.run(
      `
      ${cypher}
      RETURN DISTINCT e.id AS entryId, c.topic AS topic
      ORDER BY e.date
      LIMIT $limit
      `,
      { ...params, limit: neo4j.int(limit) }
    );

    return result.records.map((record) => ({
      entryId: record.get('entryId') as string,
      topic: record.get('topic') as string,
    }));
  } finally {
    await session.close();
  }
}

export async function countEntriesPendingResolve(): Promise<number> {
  const topics = resolveTopics();
  if (topics.length === 0) {
    return 0;
  }

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });
  const { cypher, params } = pendingPickMatch(topics);

  try {
    const result = await session.run(
      `
      ${cypher}
      RETURN count(DISTINCT e) AS count
      `,
      params
    );
    return result.records[0].get('count').toNumber();
  } finally {
    await session.close();
  }
}

export async function countResolveStatusByStatus(): Promise<ResolveStatusCounts> {
  const topics = resolveTopics();
  if (topics.length === 0) {
    return { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0 };
  }

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)-[:FROM_CHAT]->(c:TelegramChat)
      WHERE c.topic IN $topics
      RETURN e.resolveStatus AS status, count(DISTINCT e) AS count
      `,
      { topics }
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
