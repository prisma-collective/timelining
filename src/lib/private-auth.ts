import { NextRequest, NextResponse } from 'next/server';

export function verifyInfraRequest(request: NextRequest): NextResponse | null {
  const expected = process.env.PRIVATE_API_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'PRIVATE_API_TOKEN not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = header.slice('Bearer '.length);
  if (token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
