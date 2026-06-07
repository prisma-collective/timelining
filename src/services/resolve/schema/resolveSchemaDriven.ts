import { fetchProtocolSchema } from '@/services/docs/client';
import type { ResolveContext, ResolveHandlerName, SchemaResolveResult } from '../types';
import { getEntrySourceText } from './entryText';
import { extractFieldsFromText } from './extract';
import { persistDecision, persistRoleSnapshot } from './persist';

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

/** Load protocol schema, extract fields from entry text, persist Role or Decision. */
export async function resolveSchemaDrivenEntry(ctx: ResolveContext): Promise<void> {
  const result = await extractFromEntry(ctx);

  if (ctx.handler === 'enrolment') {
    await persistRoleSnapshot(ctx, result);
  } else {
    await persistDecision(ctx, result);
  }
}
