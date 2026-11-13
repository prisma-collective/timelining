import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import { runExternalIngest } from '@/services/ingest/external';

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function handle(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) return authError;

  try {
    const result = await runExternalIngest({ limit: parseLimit(request.nextUrl.searchParams.get('limit')) });
    logger.info('External ingest result', { result });
    return NextResponse.json({ status: 'External ingest executed', result }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('External ingest route failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
