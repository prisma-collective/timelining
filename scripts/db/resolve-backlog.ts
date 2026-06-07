import neo4j from 'neo4j-driver';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { ResolveStatus } from '../../src/lib/db/models/entry';
import {
  RESOLVE_TOPIC_HANDLERS,
  RESOLVE_TOPICS,
  entryMeetsVoiceGate,
  handlerForTopic,
} from '../../src/services/resolve/registry';
import type { ResolveHandlerName } from '../../src/services/resolve/types';
import { loadDbEnv, resolveNeo4jCredentials } from './env';

loadDbEnv();

const rawArgv = hideBin(process.argv);
const argv = yargs(rawArgv)
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
  .option('reprocess', {
    type: 'string',
    describe:
      'Re-resolve entries with existing output nodes (decision | deciding | enrolment | role | rolesnapshot)',
  })
  .help()
  .parseSync();

function limitFromRawArgv(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' || arg === '-l') {
      const next = Number(args[i + 1]);
      if (!Number.isNaN(next) && next > 0) return next;
    }
    const eq = arg.match(/^--limit=(\d+)$/);
    if (eq) return Number(eq[1]);
  }
  return undefined;
}

function reprocessTypeFromRawArgv(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reprocess') {
      return args[i + 1];
    }
    const eq = arg.match(/^--reprocess=(.+)$/);
    if (eq) return eq[1];
  }
  return undefined;
}

type ReprocessNodeType = 'decision' | 'enrolment';

const REPROCESS_ALIASES: Record<string, ReprocessNodeType> = {
  decision: 'decision',
  decisions: 'decision',
  deciding: 'decision',
  enrolment: 'enrolment',
  role: 'enrolment',
  rolesnapshot: 'enrolment',
  'role-snapshot': 'enrolment',
};

const REPROCESS_NODE_LABEL: Record<ReprocessNodeType, string> = {
  decision: 'Decision',
  enrolment: 'RoleSnapshot',
};

function parseReprocessType(raw: string): ReprocessNodeType {
  const mapped = REPROCESS_ALIASES[raw.trim().toLowerCase()];
  if (!mapped) {
    throw new Error(
      `Unknown --reprocess type "${raw}". Use: decision, deciding, enrolment, role, rolesnapshot`
    );
  }
  return mapped;
}

function topicsForHandler(handler: ResolveHandlerName): string[] {
  return RESOLVE_TOPICS.filter((topic) => RESOLVE_TOPIC_HANDLERS[topic] === handler);
}

const limit =
  typeof argv.limit === 'number' && argv.limit > 0 ? argv.limit : limitFromRawArgv(rawArgv);
const includeFailed = argv['reprocess-failed'] || rawArgv.includes('--reprocess-failed');
const reprocessArg =
  (typeof argv.reprocess === 'string' && argv.reprocess.trim() ? argv.reprocess : undefined) ??
  reprocessTypeFromRawArgv(rawArgv);
const reprocessType = reprocessArg ? parseReprocessType(reprocessArg) : undefined;

const NO_PROTOCOL_REASON = 'no_protocol';

interface BacklogEntry {
  entryId: string;
  topic: string | null;
  voiceStatus: string | null;
  transcription: string | null;
  priorStatus: 'unset' | 'failed' | 'reprocess';
}

interface ProcessedFailure {
  entryId: string;
  handler: ResolveHandlerName;
  topic: string | null;
  reason: string;
}

interface ProcessedSuccess {
  entryId: string;
  handler: ResolveHandlerName;
  topic: string | null;
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
  reprocessScanned: number;
  reprocessNodeType?: ReprocessNodeType;
  markedPendingNoProtocol: BacklogEntry[];
  markedPendingVoiceNotReady: BacklogEntry[];
  successful: ProcessedSuccess[];
  failed: ProcessedFailure[];
  reprocessedFromFailed: number;
  reprocessedFromNodes: number;
  reprocessFailedFromFailed: number;
  reprocessFailedFromNodes: number;
}

interface FetchBacklogOptions {
  limit?: number;
  includeFailed?: boolean;
  reprocessType?: ReprocessNodeType;
}

function ensureNeo4jEnv(): void {
  const { uri, user, password } = resolveNeo4jCredentials();
  process.env.NEO4J_URI = uri;
  process.env.NEO4J_USERNAME = user;
  process.env.NEO4J_PASSWORD = password;
}

function requireResolveEnv(): void {
  for (const name of ['DOCS_APP_URL', 'PRIVATE_API_TOKEN', 'OPENAI_API_KEY']) {
    if (!process.env[name]?.trim()) {
      throw new Error(`${name} is not configured (required to resolve schema entries)`);
    }
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

async function fetchBacklogEntries(options: FetchBacklogOptions = {}): Promise<BacklogEntry[]> {
  const { limit, includeFailed = false, reprocessType } = options;
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const limitClause = limit != null ? 'LIMIT $limit' : '';

    if (reprocessType) {
      const handler = reprocessType === 'decision' ? 'deciding' : 'enrolment';
      const topics = topicsForHandler(handler);
      const matchClause =
        reprocessType === 'decision'
          ? 'MATCH (e:Entry)-[:RESOLVED_TO]->(:Decision)'
          : 'MATCH (e:Entry)<-[:FOR_ENTRY]-(:RoleSnapshot)';

      const result = await session.run(
        `
        ${matchClause}
        MATCH (e)-[:FROM_CHAT]->(c:TelegramChat)
        WHERE c.topic IN $topics
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
          ...(limit != null ? { limit: neo4j.int(limit) } : {}),
        }
      );

      return result.records.map((record) => ({
        entryId: record.get('entryId') as string,
        topic: record.get('topic') as string | null,
        voiceStatus: record.get('voiceStatus') as string | null,
        transcription: record.get('transcription') as string | null,
        priorStatus: 'reprocess' as const,
      }));
    }

    const result = await session.run(
      `
      MATCH (e:Entry)
      WHERE e.resolveStatus IS NULL
         OR ($includeFailed AND e.resolveStatus = 'failed')
      OPTIONAL MATCH (e)-[:FROM_CHAT]->(c:TelegramChat)
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
        priorStatus: priorStatus === 'failed' ? 'failed' : 'unset',
      };
    });
  } finally {
    await session.close();
  }
}

async function markEntryResolvePending(
  entryId: string,
  failureReason: string | null
): Promise<void> {
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      SET e.resolveStatus = 'pending',
          e.resolvedAt = null,
          e.resolveFailureReason = $failureReason
      `,
      { entryId, failureReason }
    );
  } finally {
    await session.close();
  }
}

async function fetchResolveFailureReason(entryId: string): Promise<string> {
  const { initDriver } = await import('../../src/lib/db/neo4j');
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (e:Entry { id: $entryId })
      RETURN e.resolveFailureReason AS reason
      `,
      { entryId }
    );
    return (result.records[0]?.get('reason') as string | null) ?? 'unknown_error';
  } finally {
    await session.close();
  }
}

function groupByTopic(entries: BacklogEntry[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const entry of entries) {
    counts.set(entry.topic, (counts.get(entry.topic) ?? 0) + 1);
  }
  return counts;
}

function countByHandler<T extends { handler: ResolveHandlerName }>(
  items: T[]
): Record<ResolveHandlerName, number> {
  return {
    enrolment: items.filter((item) => item.handler === 'enrolment').length,
    deciding: items.filter((item) => item.handler === 'deciding').length,
  };
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
  console.log(`  unset:                               ${summary.unsetScanned}`);
  console.log(`  failed (reprocess):                  ${summary.failedScanned}`);
  if (summary.reprocessNodeType) {
    console.log(
      `  reprocess (${REPROCESS_NODE_LABEL[summary.reprocessNodeType]}):` +
        ' '.repeat(Math.max(1, 24 - REPROCESS_NODE_LABEL[summary.reprocessNodeType].length)) +
        `${summary.reprocessScanned}`
    );
  }
  console.log(`Marked pending (no protocol):        ${summary.markedPendingNoProtocol.length}`);
  console.log(`Marked pending (voice not ready):    ${summary.markedPendingVoiceNotReady.length}`);
  console.log(`Processed successfully:                ${summary.successful.length}`);
  console.log(`  reprocessed (failed):                ${summary.reprocessedFromFailed}`);
  console.log(`  reprocessed (output nodes):          ${summary.reprocessedFromNodes}`);
  console.log(`Processed failed:                    ${summary.failed.length}`);
  console.log(`  reprocessed (failed):                ${summary.reprocessFailedFromFailed}`);
  console.log(`  reprocessed (output nodes):          ${summary.reprocessFailedFromNodes}`);
  console.log('────────────────────────────────────────────');

  printStatusSnapshot('All entries by resolveStatus (before)', statusBefore);
  printStatusSnapshot('All entries by resolveStatus (after)', statusAfter);

  if (summary.markedPendingNoProtocol.length > 0) {
    console.log('\nMarked pending — no protocol handler for topic:');
    const byTopic = groupByTopic(summary.markedPendingNoProtocol);
    for (const [topic, count] of [...byTopic.entries()].sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    )) {
      console.log(`  ${topic ?? '(no topic)'}: ${count}`);
    }
  }

  if (summary.markedPendingVoiceNotReady.length > 0) {
    console.log('\nMarked pending — voice awaiting transcription:');
    for (const entry of summary.markedPendingVoiceNotReady) {
      console.log(`  ${entry.entryId}  topic=${entry.topic ?? '(none)'}`);
    }
  }

  if (summary.successful.length > 0) {
    const byHandler = countByHandler(summary.successful);
    console.log('\nSuccessful resolves:');
    console.log(`  enrolment: ${byHandler.enrolment}`);
    console.log(`  deciding:  ${byHandler.deciding}`);
    for (const entry of summary.successful) {
      console.log(`  ✓ ${entry.entryId}  ${entry.handler}  topic=${entry.topic ?? '(none)'}`);
    }
  }

  if (summary.failed.length > 0) {
    console.log('\nFailed resolves:');
    for (const entry of summary.failed) {
      console.log(
        `  ✗ ${entry.entryId}  ${entry.handler}  topic=${entry.topic ?? '(none)'}  reason=${entry.reason}`
      );
    }
  }

  console.log('\nSchema topics (for reference):', RESOLVE_TOPICS.join(', '));
  console.log('────────────────────────────────────────────');

  if (summary.failed.length > 0) {
    console.log(`Result: INCOMPLETE — ${summary.failed.length} resolve(s) failed`);
  } else if (
    summary.successful.length === 0 &&
    summary.total > 0 &&
    summary.markedPendingNoProtocol.length + summary.markedPendingVoiceNotReady.length ===
      summary.total
  ) {
    console.log('Result: OK — backlog classified; no eligible resolves in this run');
  } else if (summary.total === 0) {
    console.log('Result: OK — no matching entries to process');
  } else {
    console.log('Result: OK');
  }
}

async function processBacklog(
  entries: BacklogEntry[],
  reprocessType?: ReprocessNodeType
): Promise<{ summary: BacklogSummary; exitCode: number }> {
  const summary: BacklogSummary = {
    total: entries.length,
    unsetScanned: entries.filter((entry) => entry.priorStatus === 'unset').length,
    failedScanned: entries.filter((entry) => entry.priorStatus === 'failed').length,
    reprocessScanned: entries.filter((entry) => entry.priorStatus === 'reprocess').length,
    reprocessNodeType: reprocessType,
    markedPendingNoProtocol: [],
    markedPendingVoiceNotReady: [],
    successful: [],
    failed: [],
    reprocessedFromFailed: 0,
    reprocessedFromNodes: 0,
    reprocessFailedFromFailed: 0,
    reprocessFailedFromNodes: 0,
  };

  if (entries.length === 0) {
    return { summary, exitCode: 0 };
  }

  const { runEntryResolve } = await import('../../src/services/resolve/entry');
  let resolveEnvChecked = false;

  for (const entry of entries) {
    const handler = handlerForTopic(entry.topic ?? undefined);
    if (!handler) {
      if (entry.priorStatus === 'unset') {
        await markEntryResolvePending(entry.entryId, NO_PROTOCOL_REASON);
        summary.markedPendingNoProtocol.push(entry);
      }
      continue;
    }

    if (!entryMeetsVoiceGate(entry.voiceStatus, entry.transcription)) {
      if (entry.priorStatus !== 'reprocess') {
        await markEntryResolvePending(entry.entryId, null);
      }
      summary.markedPendingVoiceNotReady.push(entry);
      continue;
    }

    if (!resolveEnvChecked) {
      requireResolveEnv();
      resolveEnvChecked = true;
    }

    const reprocessLabel =
      entry.priorStatus === 'failed'
        ? ' (reprocess failed)'
        : entry.priorStatus === 'reprocess'
          ? ` (reprocess ${REPROCESS_NODE_LABEL[reprocessType ?? 'decision']})`
          : '';
    console.log(
      `→ ${entry.entryId}  handler=${handler}  topic=${entry.topic ?? '(none)'}${reprocessLabel}`
    );
    const result = await runEntryResolve(entry.entryId);

    if (result.resolveStatus === 'successful') {
      summary.successful.push({
        entryId: entry.entryId,
        handler,
        topic: entry.topic,
      });
      if (entry.priorStatus === 'failed') {
        summary.reprocessedFromFailed += 1;
      } else if (entry.priorStatus === 'reprocess') {
        summary.reprocessedFromNodes += 1;
      }
      console.log(`  ✓ resolved`);
      continue;
    }

    const reason = await fetchResolveFailureReason(entry.entryId);
    summary.failed.push({
      entryId: entry.entryId,
      handler,
      topic: entry.topic,
      reason,
    });
    if (entry.priorStatus === 'failed') {
      summary.reprocessFailedFromFailed += 1;
    } else if (entry.priorStatus === 'reprocess') {
      summary.reprocessFailedFromNodes += 1;
    }
    console.log(`  ✗ failed: ${reason}`);
  }

  const exitCode = summary.failed.length > 0 ? 1 : 0;
  return { summary, exitCode };
}

async function main(): Promise<void> {
  ensureNeo4jEnv();

  const { initDriver, closeDriver } = await import('../../src/lib/db/neo4j');
  await initDriver();

  const statusBefore = await fetchAllEntriesByResolveStatus();
  const backlogEntries = await fetchBacklogEntries({ limit, includeFailed, reprocessType });

  console.log(`\nResolve backlog`);
  if (reprocessType) {
    console.log(
      `Mode: reprocess ${REPROCESS_NODE_LABEL[reprocessType]} (${reprocessType})` +
        (limit != null ? ` | limit ${limit}` : ' | no limit')
    );
  } else {
    console.log(
      `Candidates: ${statusBefore.unset} unset` +
        (includeFailed ? `, ${statusBefore.failed} failed` : '') +
        (limit != null ? ` | limit ${limit}` : ' | no limit')
    );
  }
  console.log(`Processing ${backlogEntries.length} entr${backlogEntries.length === 1 ? 'y' : 'ies'}\n`);

  const { summary, exitCode } = await processBacklog(backlogEntries, reprocessType);
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
