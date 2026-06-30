import { chunkText } from './chunk';
import { embedTexts } from './embed';

export interface TextChunkEmbedding {
  chunk_text: string;
  embedding: number[];
}

export async function vectoriseText(transcription: string): Promise<TextChunkEmbedding[]> {
  const chunks = await chunkText(transcription);
  if (chunks.length === 0) {
    throw new Error('Chunking produced no chunks');
  }

  const embeddings = await embedTexts(chunks);
  return chunks.map((chunk_text, i) => ({
    chunk_text,
    embedding: embeddings[i],
  }));
}
