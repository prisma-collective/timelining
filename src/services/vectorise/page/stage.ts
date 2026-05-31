import { logger } from '@/lib/logger';
import { fetchDocsPageContent } from '@/services/docs/client';
import { chunkText } from '../shared/chunk';
import { embedTexts } from '../shared/embed';
import type { VectoriseStageResult } from '../shared/types';
import { markPageVectorised, upsertPageChunks } from './neo4j';
import type { PageChunkInput } from './types';

function tokenCount(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

function buildPageChunkInputs(slug: string, chunks: string[], embeddings: number[][]): PageChunkInput[] {
  return chunks.map((content, chunk_index) => ({
    id: `${slug}::chunk::${chunk_index}`,
    content,
    embedding: embeddings[chunk_index],
    chunk_index,
    token_count: tokenCount(content),
  }));
}

export async function vectorisePageStage(slug: string): Promise<VectoriseStageResult> {
  try {
    const content = await fetchDocsPageContent(slug);

    if (!content.trim()) {
      logger.warn('Page missing content, skipping vectorise', { slug });
      await markPageVectorised(slug);
      return 'skipped';
    }

    const chunks = await chunkText(content);
    if (chunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    const embeddings = await embedTexts(chunks);
    const chunkInputs = buildPageChunkInputs(slug, chunks, embeddings);

    await upsertPageChunks(slug, chunkInputs);
    await markPageVectorised(slug);
    logger.info('Page vectorised', { slug, chunkCount: chunks.length });
    return 'vectorised';
  } catch (error) {
    logger.error('Page vectorise stage failed', { slug, error });
    return 'failed';
  }
}
