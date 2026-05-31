import { verifyInfraRequest } from '@/lib/private-auth';
import { logger } from '@/lib/logger';
import { processLogDrain } from '@/services/docs/logDrain';
import { NextRequest, NextResponse } from 'next/server';

const VERCEL_VERIFY_HEADER = 'x-vercel-verify';
const VERCEL_VERIFY_VALUE = '72062fa2aabce4106de99743f55a6b6a4f0ba296';

export async function POST(req: NextRequest) {
  const verifyChallenge = req.headers.get(VERCEL_VERIFY_HEADER);
  if (verifyChallenge) {
    return NextResponse.json(
      { ok: true },
      {
        status: 200,
        headers: { [VERCEL_VERIFY_HEADER]: VERCEL_VERIFY_VALUE },
      }
    );
  }

  const authError = verifyInfraRequest(req);
  if (authError) {
    return authError;
  }

  try {
    const body: unknown = await req.json();
    const result = await processLogDrain(body);
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';

    if (message.startsWith('Invalid log format')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    logger.error('Log drain failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
