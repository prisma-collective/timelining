import { Driver } from 'neo4j-driver';
import {
  CHUNK_VECTOR_DIMENSIONS,
  CHUNK_VECTOR_INDEX_LABEL,
  CHUNK_VECTOR_INDEX_NAME,
  LEGACY_VOICE_VECTOR_INDEX_NAME,
} from '../../src/lib/db/vectorIndex';
import { createNeo4jDriver, loadDbEnv } from './env';

interface IndexRow {
  name: string;
  state: string;
  populationPercent: number;
  populationPercentRaw: string | null;
  labelsOrTypes: string[];
  properties: string[];
}

function parsePopulationPercent(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && 'toNumber' in raw) {
    return (raw as { toNumber: () => number }).toNumber();
  }
  return 0;
}

async function fetchIndex(driver: Driver, name: string): Promise<IndexRow | null> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const result = await session.run(
      `
      SHOW INDEXES
      YIELD name, type, state, populationPercent, labelsOrTypes, properties
      WHERE name = $indexName AND type = 'VECTOR'
      RETURN name, state, populationPercent, labelsOrTypes, properties
      `,
      { indexName: name }
    );
    if (result.records.length === 0) return null;
    const record = result.records[0];
    const rawPop = record.get('populationPercent');

    return {
      name: record.get('name'),
      state: record.get('state'),
      populationPercent: parsePopulationPercent(rawPop),
      populationPercentRaw: rawPop == null ? null : String(rawPop),
      labelsOrTypes: record.get('labelsOrTypes'),
      properties: record.get('properties'),
    };
  } finally {
    await session.close();
  }
}

async function countLabelledChunks(
  driver: Driver,
  primaryLabel: 'VoiceChunk' | 'PageChunk'
): Promise<{ total: number; indexed: number }> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const result = await session.run(
      `
      MATCH (c:${primaryLabel})
      WHERE c.embedding IS NOT NULL
      RETURN count(c) AS total,
             count(CASE WHEN c:IndexedChunk THEN 1 END) AS indexed
      `
    );
    const record = result.records[0];
    return {
      total: record.get('total').toNumber(),
      indexed: record.get('indexed').toNumber(),
    };
  } finally {
    await session.close();
  }
}

async function probeVectorSearch(
  driver: Driver,
  queryEmbedding: number[]
): Promise<{ hits: number; sample: string }> {
  const session = driver.session({ database: 'neo4j' });
  try {
    const result = await session.run(
      `
      CALL db.index.vector.queryNodes($indexName, 3, $queryEmbedding)
      YIELD node, score
      RETURN labels(node) AS labels, coalesce(node.id, '') AS id, score
      ORDER BY score DESC
      LIMIT 3
      `,
      {
        indexName: CHUNK_VECTOR_INDEX_NAME,
        queryEmbedding,
      }
    );

    const lines = result.records.map((r) => {
      const labels = (r.get('labels') as string[]).join(':');
      const id = r.get('id') as string;
      const score = r.get('score');
      return `  ${labels} id=${id || '(none)'} score=${score}`;
    });

    return {
      hits: result.records.length,
      sample: lines.length > 0 ? lines.join('\n') : '  (no results)',
    };
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  loadDbEnv();
  const driver = await createNeo4jDriver();
  let exitCode = 0;
    let probeHits = 0;
    let probeSample = '';

  try {
    const unified = await fetchIndex(driver, CHUNK_VECTOR_INDEX_NAME);
    const legacy = await fetchIndex(driver, LEGACY_VOICE_VECTOR_INDEX_NAME);
    const voice = await countLabelledChunks(driver, 'VoiceChunk');
    const page = await countLabelledChunks(driver, 'PageChunk');
    const unlabeledVoice = voice.total - voice.indexed;
    const unlabeledPage = page.total - page.indexed;
    const chunkTotal = voice.total + page.total;

    if (process.env.OPENAI_API_KEY && unified) {
      const { embedTexts } = await import('../../src/services/vectorise/shared/embed');
      const [queryEmbedding] = await embedTexts(['vector index health check']);
      if (queryEmbedding.length !== CHUNK_VECTOR_DIMENSIONS) {
        throw new Error(
          `Unexpected embedding dimensions: ${queryEmbedding.length} (expected ${CHUNK_VECTOR_DIMENSIONS})`
        );
      }
      try {
        const probe = await probeVectorSearch(driver, queryEmbedding);
        probeHits = probe.hits;
        probeSample = probe.sample;
      } catch {
        probeHits = 0;
        probeSample = '  (probe failed)';
      }
    }

    // #region agent log
    fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '9f51fa' },
      body: JSON.stringify({
        sessionId: '9f51fa',
        location: 'vector-index-check.ts:main',
        message: 'index check metrics',
        data: {
          unifiedState: unified?.state ?? null,
          populationPercent: unified?.populationPercent ?? null,
          populationPercentRaw: unified?.populationPercentRaw ?? null,
          probeHits,
          legacyPresent: legacy != null,
          chunkTotal,
        },
        timestamp: Date.now(),
        hypothesisId: 'B-C',
      }),
    }).catch(() => {});
    // #endregion

    console.log('\nVector index check');
    console.log('────────────────────────────────────────────');

    if (!unified) {
      console.log(`✗  ${CHUNK_VECTOR_INDEX_NAME} — NOT FOUND`);
      console.log(`   Run: pnpm db:vector-index:create`);
      exitCode = 1;
    } else {
      const populationReported = unified.populationPercent >= 100;
      const probeOk = probeHits > 0;
      const ready = unified.state === 'ONLINE' && (populationReported || probeOk);
      const icon = ready ? '✓' : '⚠';
      const popNote =
        populationReported || unified.populationPercent === 0
          ? `${unified.populationPercent}% populated`
          : `${unified.populationPercent}% populated (metadata; probe ${probeOk ? 'ok' : 'pending'})`;
      console.log(`${icon}  ${unified.name} — ${unified.state}, ${popNote}`);
      console.log(`    labels: ${unified.labelsOrTypes.join(', ')}`);
      console.log(`    property: ${unified.properties.join(', ')}`);
      if (!ready) {
        if (!process.env.OPENAI_API_KEY) {
          console.log('    Set OPENAI_API_KEY to run vector probe, or wait for index population.');
        } else {
          console.log('    Index not queryable yet (offline or probe returned no hits).');
        }
        exitCode = 1;
      } else if (!populationReported && probeOk) {
        console.log('    SHOW INDEXES reports 0% populated; vector probe succeeded (index is usable).');
      }
    }

    if (legacy) {
      console.log(
        `✗  ${LEGACY_VOICE_VECTOR_INDEX_NAME} still present — run: pnpm db:vector-index:recreate`
      );
      exitCode = 1;
    }

    console.log('\nChunk labels');
    console.log('────────────────────────────────────────────');
    console.log(
      `VoiceChunk: ${voice.indexed}/${voice.total} labeled :${CHUNK_VECTOR_INDEX_LABEL}`
    );
    console.log(
      `PageChunk:  ${page.indexed}/${page.total} labeled :${CHUNK_VECTOR_INDEX_LABEL}`
    );

    if (unlabeledVoice + unlabeledPage > 0) {
      console.log(
        `✗  ${unlabeledVoice + unlabeledPage} chunk(s) missing :${CHUNK_VECTOR_INDEX_LABEL}`
      );
      console.log('   Run: pnpm db:vector-index:backfill');
      exitCode = 1;
    }

    if (process.env.OPENAI_API_KEY) {
      console.log('\nVector search probe (top 3)');
      console.log('────────────────────────────────────────────');
      console.log(probeSample || '  (no probe run — index missing)');
      if (probeHits === 0 && chunkTotal > 0 && unified) {
        console.log('✗  Index query returned no hits despite labeled chunks.');
        exitCode = 1;
      }
    } else {
      console.log('\nVector search probe skipped (OPENAI_API_KEY not set).');
    }

    console.log('────────────────────────────────────────────');
    if (exitCode === 0) {
      console.log('Result: OK');
    } else {
      console.log('Result: ISSUES FOUND');
    }

    process.exit(exitCode);
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Vector index check failed:', message);
  process.exit(1);
});
