import neo4j from 'neo4j-driver';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolveRouteForTopic, resolveTopics } from '@organising-config';
import type { ResolveStatus } from '../../src/lib/db/models/entry';
import { entryMeetsVoiceGate } from '../../src/services/resolve/neo4j';
import { dispatchOrganisingResolve } from '../../src/services/webhook/dispatchOrganisingResolve';
import { loadDbEnv, resolveNeo4jCredentials } from './env';

loadDbEnv();

const argv = yargs(hideBin(process.argv))
  .option('limit', {
    alias: 'l',
    type: 'number',
    describe: 'Maximum entries to process (default: all)',
  })
  .option('reprocess-failed', {
    type: 'boolean',
    default: false,
    describe: 'Also retry entries with resolveStatus failed',
  })
  .help()
  .parseSync();

interface BacklogEntry {
  entryId: string;
  topic: string | null;
  voiceStatus: string | null;
  transcription: string | null;
  priorStatus: 'unset' | 'failed' | 'pending';
}

interface ProcessedFailure {
  entryId: string;
  topic: string | null;
  reason: string;
}

interface ProcessedSuccess {
  entryId: string;
  topic: string | null;
  url?: string;
}

interface ResolveStatusSnapshot {
  unset: number;
  pending: number;
  attempted: number;
  successful: number;
  failed: number;
  total: number;
}

interface BacklogSummary {
  total: number;
  unsetScanned: number;
  failedScanned: number;
  markedPendingNoProtocol: BacklogEntry[];
  markedPendingVoiceNotReady: BacklogEntry[];
  successful: ProcessedSuccess[];
  failed: ProcessedFailure[];
}

function ensureNeo4jEnv(): void {
  const { uri, user, password } = resolveNeo4jCredentials();
  process.env.NEO4J_URI = uri;
  process.env.NEO4J_USERNAME = user;
  process.env.NEO4J_PASSWORD = password;
}

function requireDispatchEnv(): void {
  if (!process.env.PRIVATE_API_TOKEN?.trim()) {
    throw new Error('PRIVATE_API_TOKEN is not configured (required to dispatch resolve)');
  }
}

function emptyStatusSnapshot(): ResolveStatusSnapshot {
  return { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0, total: 0 };
}

async function fetchAllEntriesByResolveStatus(): Promise<ResolveStatusSnapshot> {
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)
      RETURN e.resolveStatus AS status, count(e) AS count
      `
    );

    const snapshot = emptyStatusSnapshot();

    for (const record of result.records) {
      const status = record.get('status') as ResolveStatus | null;
      const count = record.get('count').toNumber();
      snapshot.total += count;

      if (status == null) {
        snapshot.unset += count;
      } else if (
        status === 'pending' ||
        status === 'attempted' ||
        status === 'successful' ||
        status === 'failed'
      ) {
        snapshot[status] += count;
      }
    }

    return snapshot;
  } finally {
    await session.close();
  }
}

async function fetchBacklogEntries(options: {
  limit?: number;
  includeFailed?: boolean;
}): Promise<BacklogEntry[]> {
  const { limit, includeFailed = false } = options;
  const topics = resolveTopics();
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });
  const limitClause = limit != null ? 'LIMIT $limit' : '';

  try {
    const result = await session.run(
      `
      MATCH (e:Entry)-[:FROM_CHAT]->(c:TelegramChat)
      WHERE c.topic IN $topics
        AND (
          e.resolveStatus IS NULL
          OR e.resolveStatus = 'pending'
          OR ($includeFailed AND e.resolveStatus = 'failed')
        )
      OPTIONAL MATCH (e)-[:HAS_VOICE]->(v:Voice)
      RETURN e.id AS entryId,
             c.topic AS topic,
             v.processingStatus AS voiceStatus,
             v.transcription AS transcription,
             e.resolveStatus AS priorStatus
      ORDER BY e.date
      ${limitClause}
      `,
      {
        topics,
        includeFailed,
        ...(limit != null ? { limit: neo4j.int(limit) } : {}),
      }
    );

    return result.records.map((record) => {
      const priorStatus = record.get('priorStatus') as ResolveStatus | null;
      return {
        entryId: record.get('entryId') as string,
        topic: record.get('topic') as string | null,
        voiceStatus: record.get('voiceStatus') as string | null,
        transcription: record.get('transcription') as string | null,
        priorStatus:
          priorStatus === 'failed'
            ? 'failed'
            : priorStatus === 'pending'
              ? 'pending'
              : 'unset',
      };
    });
  } finally {
    await session.close();
  }
}

async function markEntryResolvePending(entryId: string): Promise<void> {
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      SET e.resolveStatus = 'pending',
          e.resolvedAt = null,
          e.resolveFailureReason = null
      `,
      { entryId }
    );
  } finally {
    await session.close();
  }
}

function printStatusSnapshot(label: string, snapshot: ResolveStatusSnapshot): void {
  console.log(`\n${label}`);
  console.log(`  (unset):     ${snapshot.unset}`);
  console.log(`  pending:     ${snapshot.pending}`);
  console.log(`  attempted:   ${snapshot.attempted}`);
  console.log(`  successful:  ${snapshot.successful}`);
  console.log(`  failed:      ${snapshot.failed}`);
  console.log(`  total:       ${snapshot.total}`);
}

function printVerboseSummary(
  summary: BacklogSummary,
  statusBefore: ResolveStatusSnapshot,
  statusAfter: ResolveStatusSnapshot
): void {
  console.log('\nResolve backlog summary');
  console.log('────────────────────────────────────────────');
  console.log(`Entries scanned:                     ${summary.total}`);
  console.log(`  unset/pending:                       ${summary.unsetScanned}`);
  console.log(`  failed (reprocess):                  ${summary.failedScanned}`);
  console.log(`Marked pending (no resolve route):   ${summary.markedPendingNoProtocol.length}`);
  console.log(`Marked pending (voice not ready):    ${summary.markedPendingVoiceNotReady.length}`);
  console.log(`Dispatched successfully:             ${summary.successful.length}`);
  console.log(`Dispatch failed:                     ${summary.failed.length}`);
  console.log('────────────────────────────────────────────');

  printStatusSnapshot('All entries by resolveStatus (before)', statusBefore);
  printStatusSnapshot('All entries by resolveStatus (after)', statusAfter);

  if (summary.successful.length > 0) {
    console.log('\nSuccessful dispatches:');
    for (const entry of summary.successful) {
      console.log(`  ✓ ${entry.entryId}  topic=${entry.topic ?? '(none)'}  ${entry.url ?? ''}`);
    }
  }

  if (summary.failed.length > 0) {
    console.log('\nFailed dispatches:');
    for (const entry of summary.failed) {
      console.log(`  ✗ ${entry.entryId}  topic=${entry.topic ?? '(none)'}  reason=${entry.reason}`);
    }
  }

  console.log('\nResolve topics (for reference):', resolveTopics().join(', '));
  console.log('────────────────────────────────────────────');

  if (summary.failed.length > 0) {
    console.log(`Result: INCOMPLETE — ${summary.failed.length} dispatch(es) failed`);
  } else if (summary.total === 0) {
    console.log('Result: OK — no matching entries to process');
  } else {
    console.log('Result: OK');
  }
}

async function processBacklog(entries: BacklogEntry[]): Promise<{
  summary: BacklogSummary;
  exitCode: number;
}> {
  const summary: BacklogSummary = {
    total: entries.length,
    unsetScanned: entries.filter((entry) => entry.priorStatus !== 'failed').length,
    failedScanned: entries.filter((entry) => entry.priorStatus === 'failed').length,
    markedPendingNoProtocol: [],
    markedPendingVoiceNotReady: [],
    successful: [],
    failed: [],
  };

  if (entries.length === 0) {
    return { summary, exitCode: 0 };
  }

  requireDispatchEnv();

  for (const entry of entries) {
    const topic = entry.topic ?? undefined;
    const route = resolveRouteForTopic(topic);
    if (!route) {
      if (entry.priorStatus === 'unset') {
        summary.markedPendingNoProtocol.push(entry);
      }
      continue;
    }

    if (!entryMeetsVoiceGate(entry.voiceStatus, entry.transcription)) {
      if (entry.priorStatus === 'unset') {
        await markEntryResolvePending(entry.entryId);
      }
      summary.markedPendingVoiceNotReady.push(entry);
      continue;
    }

    console.log(`→ ${entry.entryId}  topic=${entry.topic ?? '(none)'}`);
    const result = await dispatchOrganisingResolve(entry.entryId, topic!);

    if (result.dispatched) {
      summary.successful.push({
        entryId: entry.entryId,
        topic: entry.topic,
        url: result.url,
      });
      console.log('  ✓ dispatched');
      continue;
    }

    summary.failed.push({
      entryId: entry.entryId,
      topic: entry.topic,
      reason: result.error ?? 'unknown_error',
    });
    console.log(`  ✗ failed: ${result.error ?? 'unknown_error'}`);
  }

  const exitCode = summary.failed.length > 0 ? 1 : 0;
  return { summary, exitCode };
}

async function main(): Promise<void> {
  ensureNeo4jEnv();

  const limit =
    typeof argv.limit === 'number' && argv.limit > 0 ? argv.limit : undefined;
  const includeFailed = argv['reprocess-failed'] || false;

  const { initDriver, closeDriver } = await import('../../src/lib/db/neo4j');
  await initDriver();

  const statusBefore = await fetchAllEntriesByResolveStatus();
  const backlogEntries = await fetchBacklogEntries({ limit, includeFailed });

  console.log('\nResolve backlog');
  console.log(
    `Candidates on resolve topics` +
      (includeFailed ? ' (including failed)' : '') +
      (limit != null ? ` | limit ${limit}` : ' | no limit')
  );
  console.log(`Processing ${backlogEntries.length} entr${backlogEntries.length === 1 ? 'y' : 'ies'}\n`);

  const { summary, exitCode } = await processBacklog(backlogEntries);
  const statusAfter = await fetchAllEntriesByResolveStatus();

  printVerboseSummary(summary, statusBefore, statusAfter);
  await closeDriver();
  process.exit(exitCode);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Resolve backlog failed:', message);
  try {
    const { closeDriver } = await import('../../src/lib/db/neo4j');
    await closeDriver();
  } catch {
    // ignore
  }
  process.exit(1);
});
