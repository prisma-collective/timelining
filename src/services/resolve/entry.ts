import { logger } from '@/lib/logger';
import {
  loadResolveContext,
  markEntryResolveFailed,
  markEntryResolveSuccessful,
} from './neo4j';
import { resolveSchemaDrivenEntry } from './schema/resolveSchemaDriven';
import type { EntryResolveResult, ResolveHandlerName } from './types';

export async function runEntryResolve(entryId: string): Promise<EntryResolveResult> {
  const ctx = await loadResolveContext(entryId);

  if (!ctx) {
    const reason = 'resolve_context_unavailable';
    await markEntryResolveFailed(entryId, reason);
    logger.error('Resolve failed: could not load context', { entryId, reason });
    return { entryId, resolveStatus: 'failed' };
  }

  const { handler } = ctx;

  logger.info('Resolve entry started', { entryId, handler, topic: ctx.topic });

  try {
    await resolveSchemaDrivenEntry(ctx);
    await markEntryResolveSuccessful(entryId);
    logger.info('Resolve entry successful', { entryId, handler });
    return { entryId, handler, resolveStatus: 'successful' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await markEntryResolveFailed(entryId, message);
    logger.error('Resolve entry failed', { entryId, handler, error: message });
    return { entryId, handler, resolveStatus: 'failed' };
  }
}

export type { ResolveHandlerName };
