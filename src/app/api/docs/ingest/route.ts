import { verifyCronOrInfraRequest } from '@/lib/private-auth';
import { logger } from '@/lib/logger';
import { parsePositiveInt, queueInternalContinuation } from '@/lib/internal-continuation';
import { runDocsIngest } from '@/services/docs/ingest';
import { NextRequest, NextResponse } from 'next/server';

async function handleIngest(request: NextRequest) {
  const authError = verifyCronOrInfraRequest(request);
  if (authError) {
    return authError;
  }

  const cursor = parsePositiveInt(request.nextUrl.searchParams.get('cursor')) ?? 0;
  const batchSize = parsePositiveInt(request.nextUrl.searchParams.get('batchSize'));
  const isChained = request.headers.get('x-ingest-chain') === '1';

  logger.info('Docs ingest triggered', { method: request.method, cursor, batchSize, isChained });

  try {
    const result = await runDocsIngest({ cursor, batchSize });

    if (result.status === 'error') {
      return NextResponse.json(result, { status: 500 });
    }

    let retriggered = false;
    if (result.status === 'success' && result.hasMore && result.nextCursor != null) {
      retriggered = true;
      queueInternalContinuation({
        request,
        path: '/api/docs/ingest',
        chainHeader: 'x-ingest-chain',
        query: {
          cursor: result.nextCursor,
          batchSize,
        },
      });
      logger.info('Docs ingest continuation queued', {
        nextCursor: result.nextCursor,
        totalPages: result.totalPages,
      });
    }

    const responsePayload = { ...result, retriggered };
    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Docs ingest route failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleIngest(request);
}

export async function POST(request: NextRequest) {
  return handleIngest(request);
}
