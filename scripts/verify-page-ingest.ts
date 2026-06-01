import dotenv from 'dotenv';
import path from 'path';
import type { PageVerifyLine, PageVerifyReport } from '../src/services/docs/pageVerify';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

function statusIcon(line: PageVerifyLine): string {
  if (line.status === 'ok') return '✓';
  if (line.status === 'fail') return '✗';
  return '⚠';
}

function formatLine(line: PageVerifyLine, slugWidth: number): string {
  const icon = statusIcon(line);

  if (!line.nodePresent) {
    return `${icon}  ${line.slug.padEnd(slugWidth)}  [node MISSING]`;
  }

  const checksumLabel = line.checksumCurrent
    ? 'current'
    : 'STALE — ingest needed';
  const vectorisedLabel = line.vectorisePending ? 'PENDING' : 'current';

  return [
    `${icon}  ${line.slug.padEnd(slugWidth)}`,
    `[node ✓]`,
    `[chunks: ${line.chunkCount}]`,
    `[checksum: ${checksumLabel}]`,
    `[vectorised: ${vectorisedLabel}]`,
  ].join(' ');
}

function printReport(report: PageVerifyReport): void {
  const { lines, summary } = report;
  const slugWidth = Math.max(...lines.map((l) => l.slug.length), 0);

  console.log(`Verifying ${summary.totalPages} pages from docs snapshot...\n`);

  for (const line of lines) {
    console.log(formatLine(line, slugWidth));
  }

  console.log('\n────────────────────────────────────────────');
  console.log(`Total pages in docs:       ${summary.totalPages}`);
  console.log(`Fully synced:              ${summary.fullySynced}`);
  console.log(`Stale (checksum mismatch): ${summary.staleChecksum}`);
  console.log(`Missing from Neo4j:        ${summary.missingFromNeo4j}`);
  console.log(`Pages with no chunks:      ${summary.noChunks}`);
  console.log(`Pages pending vectorise:   ${summary.pendingVectorise}`);
  console.log('────────────────────────────────────────────');

  if (summary.fullySynced === summary.totalPages) {
    console.log('Result: OK');
  } else {
    console.log(`Result: INCOMPLETE — ${summary.needsAttention} pages need attention`);
  }
}

async function main(): Promise<void> {
  const { runDocsPageVerification } = await import('../src/services/docs/pageVerify');
  const report = await runDocsPageVerification();
  printReport(report);

  if (report.summary.fullySynced !== report.summary.totalPages) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Verification failed:', message);
  process.exit(1);
});
