import { logger } from '@/lib/logger';
import { verifyInfraRequest } from '@/lib/private-auth';
import { runEntryResolve } from '@/services/resolve';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const authError = verifyInfraRequest(request);
  if (authError) {
    return authError;
  }

  let entryId: string;
  try {
    const body = (await request.json()) as { entryId?: string };
    if (!body.entryId || typeof body.entryId !== 'string') {
      return NextResponse.json({ error: 'entryId is required' }, { status: 400 });
    }
    entryId = body.entryId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  logger.info('Resolve entry worker invoked', { entryId });

  try {
    const result = await runEntryResolve(entryId);
    return NextResponse.json({ status: 'ok', result }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Resolve entry worker failed', { entryId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
