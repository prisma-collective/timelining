import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await openai.embeddings.create({
    input: texts,
    model: 'text-embedding-3-large',
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
