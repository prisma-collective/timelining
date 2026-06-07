import { getEntrySourceText } from '@/services/resolve/schema/entryText';
import { extractFieldsFromText } from '@/services/resolve/schema/extract';
import type { ResolveContext } from '@/services/resolve/types';

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

import OpenAI from 'openai';

const mockCreate = jest.fn();

beforeEach(() => {
  mockCreate.mockReset();
  (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
    () =>
      ({
        chat: { completions: { create: mockCreate } },
      }) as unknown as OpenAI
  );
  process.env.OPENAI_API_KEY = 'test-key';
});

function buildCtx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    entryId: 'entry-1',
    topic: '_botEnrolment',
    handler: 'enrolment',
    participantHandle: 'alice',
    ...overrides,
  };
}

describe('resolve schema entryText', () => {
  it('prefers transcription over text', () => {
    const { text, sourceKind } = getEntrySourceText(
      buildCtx({ transcription: ' voice note ', textContent: 'text msg' })
    );
    expect(text).toBe('voice note');
    expect(sourceKind).toBe('voice');
  });

  it('uses text when no transcription', () => {
    const { text, sourceKind } = getEntrySourceText(buildCtx({ textContent: 'hello' }));
    expect(text).toBe('hello');
    expect(sourceKind).toBe('text');
  });

  it('throws when no source text', () => {
    expect(() => getEntrySourceText(buildCtx())).toThrow('no_entry_text');
  });
});

describe('resolve schema extract', () => {
  it('parses JSON object from OpenAI response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"role":"facilitator","intent":"onboard"}' } }],
    });

    const result = await extractFieldsFromText('schema doc', 'user said hello');
    expect(result).toEqual({ role: 'facilitator', intent: 'onboard' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      })
    );
  });

  it('throws on invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    await expect(extractFieldsFromText('schema', 'text')).rejects.toThrow(
      'openai_extract_invalid_json'
    );
  });

  it('throws on empty object', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
    });

    await expect(extractFieldsFromText('schema', 'text')).rejects.toThrow(
      'openai_extract_empty_object'
    );
  });
});
