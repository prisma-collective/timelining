import OpenAI from 'openai';

const DEFAULT_EXTRACT_MODEL = 'gpt-4o-mini';

function getExtractModel(): string {
  return process.env.OPENAI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}

export async function extractFieldsFromText(
  schemaContent: string,
  sourceText: string
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: getExtractModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You extract structured data from user text using a schema document. ' +
          'Return only a JSON object whose keys are the field names defined in the schema. ' +
          'Use null for missing values.',
      },
      {
        role: 'user',
        content: `Schema:\n${schemaContent}\n\nText:\n${sourceText}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw?.trim()) {
    throw new Error('openai_extract_empty_response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('openai_extract_invalid_json');
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('openai_extract_not_object');
  }

  const keys = Object.keys(parsed as object);
  if (keys.length === 0) {
    throw new Error('openai_extract_empty_object');
  }

  return parsed as Record<string, unknown>;
}
