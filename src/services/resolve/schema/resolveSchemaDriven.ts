import { fetchProtocolSchema } from '@/services/docs/client';
import type { ResolveContext, SchemaResolveResult } from '../types';
import { getEntrySourceText } from './entryText';
import { extractFieldsFromText } from './extract';
import { persistDecision } from './persist';

async function extractFromEntry(ctx: ResolveContext): Promise<SchemaResolveResult> {
  const channel = ctx.handler;
  const { content: schemaContent, commitSha: schemaCommitSha } =
    await fetchProtocolSchema(channel);

  const { text: sourceText, sourceKind } = getEntrySourceText(ctx);
  const extractedFields = await extractFieldsFromText(schemaContent, sourceText);

  return {
    schemaChannel: channel,
    schemaCommitSha,
    schemaContent,
    extractedFields,
    sourceText,
    sourceKind,
  };
}

/** Load protocol schema, extract fields from entry text, persist Decision. */
export async function resolveSchemaDrivenEntry(ctx: ResolveContext): Promise<void> {
  const result = await extractFromEntry(ctx);
  await persistDecision(ctx, result);
}
