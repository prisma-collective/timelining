import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export function verifyInfraRequest(request: NextRequest): NextResponse | null {
  const expected = process.env.PRIVATE_API_TOKEN;
  if (!expected) {
    logger.warn('Infra auth rejected: PRIVATE_API_TOKEN not configured', { path: request.nextUrl.pathname });
    // #region agent log
    fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'private-auth.ts:verifyInfraRequest',message:'auth fail: token not configured',data:{reason:'missing_env'},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: 'PRIVATE_API_TOKEN not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    logger.warn('Infra auth rejected: missing or invalid Authorization header', {
      path: request.nextUrl.pathname,
      hasAuthHeader: !!header,
    });
    // #region agent log
    fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'private-auth.ts:verifyInfraRequest',message:'auth fail: no bearer header',data:{hasAuthHeader:!!header,authPrefix:header?.slice(0,10)??null,path:request.nextUrl.pathname},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = header.slice('Bearer '.length);
  if (token !== expected) {
    logger.warn('Infra auth rejected: token mismatch', {
      path: request.nextUrl.pathname,
      tokenLen: token.length,
      expectedLen: expected.length,
      tokenTrimmed: token.trim() === token,
      expectedTrimmed: expected.trim() === expected,
    });
    // #region agent log
    fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'private-auth.ts:verifyInfraRequest',message:'auth fail: token mismatch',data:{tokenLen:token.length,expectedLen:expected.length,tokenTrimmed:token.trim()===token,expectedTrimmed:expected.trim()===expected,path:request.nextUrl.pathname},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // #region agent log
  fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'private-auth.ts:verifyInfraRequest',message:'auth ok',data:{path:request.nextUrl.pathname},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  return null;
}

/** Allows Vercel cron invocations or Bearer PRIVATE_API_TOKEN. */
export function verifyCronOrInfraRequest(request: NextRequest): NextResponse | null {
  const cronHeader = request.headers.get('x-vercel-cron');
  const cronSchedule = request.headers.get('x-vercel-cron-schedule');
  const userAgent = request.headers.get('user-agent') ?? '';
  const path = request.nextUrl.pathname;

  // #region agent log
  fetch('http://127.0.0.1:7306/ingest/22c645d7-1877-4241-b0fd-e0b88d11a716',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fce763'},body:JSON.stringify({sessionId:'fce763',location:'private-auth.ts:verifyCronOrInfraRequest',message:'cron auth check',data:{cronHeader,cronSchedule,userAgentPrefix:userAgent.slice(0,20),method:request.method,path,hasAuthHeader:!!request.headers.get('authorization')},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
  // #endregion

  if (cronHeader === '1') {
    logger.info('Cron auth accepted', { path, method: request.method, via: 'x-vercel-cron' });
    return null;
  }

  // Vercel docs: cron invocations include x-vercel-cron-schedule and user-agent vercel-cron/1.0
  if (cronSchedule != null && userAgent.startsWith('vercel-cron/')) {
    logger.info('Cron auth accepted', { path, method: request.method, via: 'x-vercel-cron-schedule', schedule: cronSchedule });
    return null;
  }

  return verifyInfraRequest(request);
}
