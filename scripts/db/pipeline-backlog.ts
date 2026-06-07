import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { RESOLVE_TOPICS } from '../../src/services/resolve/registry';
import type {
  PipelineBacklogSummary,
  PipelineStage,
} from '../../src/services/pipeline/backlog';
import {
  getIngestBacklog,
  getPageVectoriseBacklog,
  getResolveBacklog,
  getVoiceVectoriseBacklog,
  getDocsSyncBacklog,
  getPipelineBacklogSummary,
  pipelineHasBacklog,
  pipelineHasFailures,
} from '../../src/services/pipeline/backlog';
import { loadDbEnv } from './env';

loadDbEnv();

const argv = yargs(hideBin(process.argv))
  .option('stage', {
    choices: ['ingest', 'vectorise', 'resolve', 'all'] as const,
    default: 'all' as const,
    describe: 'Pipeline stage to report (default: all three)',
  })
  .option('skip-docs', {
    type: 'boolean',
    default: false,
    describe: 'Skip docs page sync counts under vectorise',
  })
  .help()
  .parseSync();

function statusIcon(hasIssue: boolean): string {
  return hasIssue ? '⚠' : '✓';
}

function printIngest(summary: PipelineBacklogSummary['ingest']): void {
  console.log('\nStage 1 — Ingest');
  console.log('  webhook → Redis queue → worker → Neo4j (entryService)');
  console.log('────────────────────────────────────────────');

  if (!summary.available) {
    console.log('✗  Redis unavailable — cannot read queue depth');
    console.log('   Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local');
    return;
  }

  const icon = statusIcon(summary.queued > 0);
  console.log(`${icon}  Queue ${summary.queueName}: ${summary.queued}`);
  if (summary.queued > 0) {
    console.log('   Worker: POST /api/story/worker');
  }
}

function printVectorise(summary: Pick<PipelineBacklogSummary, 'voice' | 'page' | 'docsSync'>): void {
  console.log('\nStage 2 — Vectorise');
  console.log('  scheduled DB scan → transcribe/chunk/embed (status on Voice / Page nodes)');
  console.log('────────────────────────────────────────────');

  const { voice, page, docsSync } = summary;
  const voiceIcon = statusIcon(voice.outstanding > 0 || voice.counts.failed > 0);
  console.log(`${voiceIcon}  Voice (Voice.processingStatus)`);
  console.log(`     outstanding: ${voice.outstanding}  (pending + transcribed)`);
  console.log(
    `     pending: ${voice.counts.pending}, transcribed: ${voice.counts.transcribed}, ` +
      `vectorised: ${voice.counts.vectorised}, failed: ${voice.counts.failed}, ` +
      `deferred_long: ${voice.counts.deferred_long}`
  );
  if (voice.outstanding > 0) {
    console.log('     Tick: POST /api/story/voice-vectorise');
  }

  const pageIcon = statusIcon(page.outstanding > 0);
  console.log(`${pageIcon}  Page (Page vectorise pending)`);
  console.log(`     outstanding: ${page.outstanding}`);
  if (page.outstanding > 0) {
    console.log('     Tick: POST /api/story/page-vectorise');
  }

  if (docsSync) {
    const docsIcon = statusIcon(docsSync.needsAttention > 0);
    console.log(`${docsIcon}  Docs page sync (upstream of page vectorise)`);
    console.log(
      `     synced: ${docsSync.fullySynced}/${docsSync.totalPages}, ` +
        `needs attention: ${docsSync.needsAttention}`
    );
    if (docsSync.needsAttention > 0) {
      console.log(
        `     stale: ${docsSync.staleChecksum}, missing: ${docsSync.missingFromNeo4j}, ` +
          `no chunks: ${docsSync.noChunks}, pending vectorise: ${docsSync.pendingVectorise}`
      );
      console.log('     Detail: pnpm db:check:page-ingest');
    }
  } else if (!argv['skip-docs']) {
    console.log('⚠  Docs page sync skipped (DOCS_APP_URL not set)');
  }
}

function printResolve(summary: PipelineBacklogSummary['resolve']): void {
  console.log('\nStage 3 — Resolve');
  console.log('  scheduled DB scan → schema extract → Decision / RoleSnapshot nodes');
  console.log(`  schema topics: ${RESOLVE_TOPICS.join(', ')}`);
  console.log('────────────────────────────────────────────');

  const { outstanding, schemaTopics, allEntries } = summary;
  const resolveIcon = statusIcon(
    outstanding > 0 || schemaTopics.attempted > 0 || schemaTopics.failed > 0
  );

  console.log(`${resolveIcon}  Schema-topic entries (resolve tick)`);
  console.log(`     outstanding (pending, voice-ready): ${outstanding}`);
  console.log(
    `     pending: ${schemaTopics.pending}, attempted: ${schemaTopics.attempted}, ` +
      `successful: ${schemaTopics.successful}, failed: ${schemaTopics.failed}, ` +
      `unset: ${schemaTopics.unset}`
  );
  if (outstanding > 0 || schemaTopics.attempted > 0) {
    console.log('     Tick: POST /api/story/resolve');
  }
  if (schemaTopics.unset > 0) {
    console.log(
      `     ${schemaTopics.unset} schema-topic entr${schemaTopics.unset === 1 ? 'y' : 'ies'} missing resolveStatus (legacy)`
    );
  }
  if (schemaTopics.failed > 0) {
    console.log('     Retry: pnpm db:resolve:backlog --reprocess-failed');
  }

  console.log('  All Entry nodes (any chat topic)');
  console.log(
    `     pending: ${allEntries.pending}, attempted: ${allEntries.attempted}, ` +
      `successful: ${allEntries.successful}, failed: ${allEntries.failed}, ` +
      `unset: ${allEntries.unset}, total: ${allEntries.total}`
  );
  const nonSchemaPending = Math.max(0, allEntries.pending - schemaTopics.pending);
  if (nonSchemaPending > 0) {
    console.log(
      `     non-schema pending (no handler): ${nonSchemaPending}`
    );
  }
}

function printFooter(summary: PipelineBacklogSummary): void {
  console.log('\n────────────────────────────────────────────');
  const backlog = pipelineHasBacklog(summary);
  const failures = pipelineHasFailures(summary);

  if (failures) {
    console.log('Result: FAILURES PRESENT — check failed counts above');
  } else if (backlog) {
    console.log('Result: BACKLOG PRESENT — one or more stages have outstanding work');
  } else {
    console.log('Result: OK — no outstanding backlogs');
  }

  console.log('\nDrill-down scripts');
  console.log('  Stage 2 voice index:  pnpm db:vector-index:check');
  console.log('  Stage 2 page detail:  pnpm db:check:page-ingest');
  console.log('  Stage 2 page seed:    pnpm db:seed:docs-pages');
  console.log('  Stage 3 process:      pnpm db:resolve:backlog');
  console.log('────────────────────────────────────────────');
}

async function loadSummary(stage: PipelineStage | 'all'): Promise<PipelineBacklogSummary> {
  if (stage === 'all') {
    return getPipelineBacklogSummary({ includeDocsSync: !argv['skip-docs'] });
  }

  const partial: PipelineBacklogSummary = {
    ingest: { available: false, queueName: 'telegram_messages', queued: 0 },
    voice: { outstanding: 0, counts: { pending: 0, transcribed: 0, vectorised: 0, failed: 0, deferred_long: 0 } },
    page: { outstanding: 0 },
    docsSync: null,
    resolve: {
      outstanding: 0,
      schemaTopics: { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0 },
      allEntries: { unset: 0, pending: 0, attempted: 0, successful: 0, failed: 0, total: 0 },
    },
  };

  if (stage === 'ingest') {
    partial.ingest = await getIngestBacklog();
    return partial;
  }

  if (stage === 'vectorise') {
    partial.voice = await getVoiceVectoriseBacklog();
    partial.page = await getPageVectoriseBacklog();
    if (!argv['skip-docs']) {
      partial.docsSync = await getDocsSyncBacklog();
    }
    return partial;
  }

  partial.resolve = await getResolveBacklog();
  return partial;
}

async function main(): Promise<void> {
  const stage = argv.stage as PipelineStage | 'all';
  const summary = await loadSummary(stage);

  console.log('\nPipeline backlog summary');
  console.log('════════════════════════════════════════════');

  if (stage === 'all' || stage === 'ingest') {
    printIngest(summary.ingest);
  }
  if (stage === 'all' || stage === 'vectorise') {
    printVectorise(summary);
  }
  if (stage === 'all' || stage === 'resolve') {
    printResolve(summary.resolve);
  }

  if (stage === 'all') {
    printFooter(summary);
  }

  const { closeDriver } = await import('../../src/lib/db/neo4j');
  await closeDriver();

  const exitCode =
    stage === 'all' && (pipelineHasBacklog(summary) || pipelineHasFailures(summary)) ? 1 : 0;
  process.exit(exitCode);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Pipeline backlog check failed:', message);
  try {
    const { closeDriver } = await import('../../src/lib/db/neo4j');
    await closeDriver();
  } catch {
    // ignore
  }
  process.exit(1);
});
