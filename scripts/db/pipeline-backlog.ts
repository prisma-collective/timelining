import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type {
  PipelineBacklogSummary,
  PipelineStage,
} from '../../src/services/pipeline/backlog';
import {
  getIngestBacklog,
  getFailedQueuesBacklog,
  getPageVectoriseBacklog,
  getResourceVectoriseBacklog,
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
    choices: ['ingest', 'vectorise', 'all'] as const,
    default: 'all' as const,
    describe: 'Pipeline stage to report (default: both)',
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
  console.log('  webhook → ingest backlog → chain dispatch → Neo4j (entryService)');
  console.log('────────────────────────────────────────────');

  if (!summary.available) {
    console.log('✗  Redis unavailable — cannot read queue depth');
    console.log('   Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local');
    return;
  }

  const icon = statusIcon(summary.queued > 0 || summary.failed > 0);
  console.log(`${icon}  Queue ${summary.queueName}: ${summary.queued}`);
  console.log(`     failed queue: ${summary.failed}`);
  if (summary.queued > 0) {
    console.log('   Chain: webhook dispatches ingest; cron retries stuck backlog');
  }
  if (summary.failed > 0) {
    console.log('   Retry: GET /api/story/ingest?mode=retry');
  }
}

function printVectorise(summary: Pick<PipelineBacklogSummary, 'voice' | 'page' | 'resource' | 'docsSync'>): void {
  console.log('\nStage 2 — Vectorise');
  console.log('  scheduled DB scan → transcribe/chunk/embed (status on Voice / Page / Resource nodes)');
  console.log('────────────────────────────────────────────');

  const { voice, page, resource, docsSync } = summary;
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

  const resourceIcon = statusIcon(resource.outstanding > 0 || resource.counts.failed > 0);
  console.log(`${resourceIcon}  Resource (Resource.processingStatus)`);
  console.log(`     outstanding: ${resource.outstanding}  (transcribed + chunked)`);
  console.log(
    `     pending: ${resource.counts.pending}, transcribed: ${resource.counts.transcribed}, ` +
      `chunked: ${resource.counts.chunked}, vectorised: ${resource.counts.vectorised}, ` +
      `failed: ${resource.counts.failed}`
  );
  if (resource.outstanding > 0) {
    console.log('     Tick: POST /api/story/resource-vectorise (chunk/embed chain)');
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

  console.log('\nResolve backlog is owned by sibling apps (enrol, enact, etc.)');
  console.log('Use each app\'s own resolve backlog tooling or status API.');

  console.log('\nDrill-down scripts');
  console.log('  Stage 2 voice index:  pnpm db:vector-index:check');
  console.log('  Stage 2 page detail:  pnpm db:check:page-ingest');
  console.log('  Stage 2 page seed:    pnpm db:seed:docs-pages');
  console.log('────────────────────────────────────────────');
}

async function loadSummary(stage: PipelineStage | 'all'): Promise<PipelineBacklogSummary> {
  if (stage === 'all') {
    return getPipelineBacklogSummary({ includeDocsSync: !argv['skip-docs'] });
  }

  const partial: PipelineBacklogSummary = {
    ingest: { available: false, queueName: 'timelining::ingest::backlog', queued: 0, failed: 0 },
    failedQueues: { ingest: 0, transcribe: 0, resolve: 0 },
    voice: { outstanding: 0, counts: { pending: 0, transcribed: 0, vectorised: 0, failed: 0, deferred_long: 0 } },
    page: { outstanding: 0 },
    resource: { outstanding: 0, counts: { pending: 0, transcribed: 0, chunked: 0, vectorised: 0, failed: 0 } },
    docsSync: null,
  };

  if (stage === 'ingest') {
    partial.ingest = await getIngestBacklog();
    partial.failedQueues = await getFailedQueuesBacklog();
    return partial;
  }

  partial.voice = await getVoiceVectoriseBacklog();
  partial.page = await getPageVectoriseBacklog();
  partial.resource = await getResourceVectoriseBacklog();
  if (!argv['skip-docs']) {
    partial.docsSync = await getDocsSyncBacklog();
  }
  return partial;
}

async function main(): Promise<void> {
  const stage = argv.stage as PipelineStage | 'all';
  const summary = await loadSummary(stage);

  console.log('\nPipeline backlog summary');
  console.log('  Stages: ingest → transcribe → resolve (chained); vectorise on cron; crons retry failures');
  console.log('════════════════════════════════════════════');

  if (stage === 'all' || stage === 'ingest') {
    printIngest(summary.ingest);
  }
  if (stage === 'all' || stage === 'vectorise') {
    printVectorise(summary);
  }

  if (stage === 'all' || stage === 'ingest') {
    const fq = summary.failedQueues;
    console.log('\nFailed queues (retry cron)');
    console.log(`  ingest: ${fq.ingest}, transcribe: ${fq.transcribe}, resolve: ${fq.resolve}`);
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
