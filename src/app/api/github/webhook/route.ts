import { NextRequest } from 'next/server';
import { receiveEntry } from '@/lib/entry-intake';

/**
 * Entries from Prisma's GitHub repos, posted by their workflows (D13). For example,
 * at-tap sends each change to its decisions table. Bearer token: the `github` one
 * in EXTERNAL_ENTRY_TOKENS.
 */
export async function POST(request: NextRequest) {
  return receiveEntry(request, 'github');
}
