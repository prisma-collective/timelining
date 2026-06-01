import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resetDocsSnapshotCache } from '../../src/services/docs/snapshotCache';
import { loadDbEnv } from './env';

loadDbEnv();

type Phase = 'ingest' | 'vectorise' | 'both';

function icon(result: string): string {
  if (result === 'vectorised') return '✓';
  if (result === 'failed') return '✗';
  return '⚠';
}

async function runIngestPhase(batchSize: number): Promise<number> {
  const { runDocsIngestUntilComplete } = await import('../../src/services/docs/ingest');
  const { initDriver } = await import('../../src/lib/db/neo4j');

  await initDriver();
  console.log(`\n=== Docs ingest (batch size ${batchSize}) ===\n`);

  const result = await runDocsIngestUntilComplete({ batchSize });

  console.log('Ingest rounds:', result.rounds);
  console.log('Status:', result.status);
  console.log('Pages checked:', result.stats.pages_checked);
  console.log('Created:', result.stats.pages_created);
  console.log('Updated:', result.stats.pages_updated);
  console.log('Changed remaining:', result.changedPagesRemaining ?? 0);

  if (result.status !== 'success') {
    console.error('Ingest failed:', result.message ?? 'unknown');
    return 1;
  }
  return 0;
}

async function runVectorisePhase(): Promise<number> {
  const { runAllPagesVectorisation } = await import('../../src/services/vectorise/page/runAll');
  const { initDriver } = await import('../../src/lib/db/neo4j');

  await initDriver();
  console.log('\n=== Page vectorise (all pending) ===\n');

  const slugWidth = 60;
  const result = await runAllPagesVectorisation({
    onProgress(slug, stageResult) {
      console.log(`${icon(stageResult)}  ${slug.padEnd(slugWidth)}  ${stageResult}`);
    },
  });

  console.log('\n────────────────────────────────────────────');
  console.log(`Rounds:     ${result.rounds}`);
  console.log(`Vectorised: ${result.vectorised}`);
  console.log(`Skipped:    ${result.skipped}`);
  console.log(`Failed:     ${result.failed}`);
  console.log('────────────────────────────────────────────');

  return result.failed > 0 ? 1 : 0;
}

async function runVerifyPhase(): Promise<number> {
  const { runDocsPageVerification } = await import('../../src/services/docs/pageVerify');

  console.log('\n=== Verification ===\n');
  const report = await runDocsPageVerification();
  const { summary } = report;

  console.log(`Total pages:               ${summary.totalPages}`);
  console.log(`Fully synced:              ${summary.fullySynced}`);
  console.log(`Stale (checksum mismatch): ${summary.staleChecksum}`);
  console.log(`Missing from Neo4j:        ${summary.missingFromNeo4j}`);
  console.log(`Pages with no chunks:      ${summary.noChunks}`);
  console.log(`Pages pending vectorise:   ${summary.pendingVectorise}`);

  return summary.fullySynced === summary.totalPages ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('phase', {
      choices: ['ingest', 'vectorise', 'both'] as const,
      default: 'both' as Phase,
      describe: 'Which pipeline phase(s) to run',
    })
    .option('batch-size', {
      type: 'number',
      default: 500,
      describe: 'Docs ingest batch size per round (loops until complete)',
    })
    .option('verify', {
      type: 'boolean',
      default: true,
      describe: 'Run db:check:page-ingest summary after phases',
    })
    .help()
    .parse();

  resetDocsSnapshotCache();

  let exitCode = 0;
  const phase = argv.phase as Phase;

  if (phase === 'ingest' || phase === 'both') {
    exitCode = await runIngestPhase(argv['batch-size']);
    resetDocsSnapshotCache();
    if (exitCode !== 0) {
      await closeDriverAndExit(exitCode);
    }
  }

  if (phase === 'vectorise' || phase === 'both') {
    resetDocsSnapshotCache();
    const vectoriseCode = await runVectorisePhase();
    resetDocsSnapshotCache();
    if (vectoriseCode !== 0) {
      exitCode = vectoriseCode;
    }
  }

  if (argv.verify) {
    resetDocsSnapshotCache();
    const verifyCode = await runVerifyPhase();
    if (verifyCode !== 0) {
      exitCode = verifyCode;
    }
  }

  await closeDriverAndExit(exitCode);
}

async function closeDriverAndExit(code: number): Promise<void> {
  const { closeDriver } = await import('../../src/lib/db/neo4j');
  await closeDriver();
  process.exit(code);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Seed failed:', message);
  try {
    const { closeDriver } = await import('../../src/lib/db/neo4j');
    await closeDriver();
  } catch {
    // ignore
  }
  process.exit(1);
});
