import { pipelineActionsAfterIngest, pipelineActionsForReceipt } from '@/services/pipeline/routing';
import type { FullEntryData, FullEntryInputData } from '@/lib/db/models/entry';

const origin = 'https://timelining.example.com';

function makeEntryInput(overrides: Partial<FullEntryInputData> = {}): FullEntryInputData {
  return {
    entry: { updateId: 1, messageId: 2, date: new Date().toISOString() },
    participant: { handle: 'user' },
    chat: { id: 1, type: 'supergroup', topic: '_botAgendar' },
    entities: [],
    photos: [],
    videos: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<FullEntryData> = {}): FullEntryData {
  return {
    entry: { id: 'entry-1', updateId: 1, messageId: 2, date: new Date().toISOString() },
    participant: { handle: 'user' },
    chat: { id: 1, type: 'supergroup', topic: '_botAgendar' },
    entities: [],
    photos: [],
    videos: [],
    ...overrides,
  };
}

describe('pipelineActionsForReceipt', () => {
  it('forwards enrol webhook and dispatches ingest for non-reply messages', () => {
    const actions = pipelineActionsForReceipt('_botEnrolment', origin, { message: {} });
    expect(actions).toEqual([
      {
        kind: 'forward-webhook',
        domain: 'register.prisma.events',
        path: '/api/webhook',
        payload: { message: {} },
      },
      { kind: 'dispatch-ingest', origin },
    ]);
  });

  it('forwards enrol webhook without ingest for replies', () => {
    const actions = pipelineActionsForReceipt('_botEnrolment', origin, { message: {} }, { isReply: true });
    expect(actions).toEqual([
      {
        kind: 'forward-webhook',
        domain: 'register.prisma.events',
        path: '/api/webhook',
        payload: { message: {} },
      },
    ]);
  });

  it('dispatches ingest for agendar without forward on non-replies', () => {
    const actions = pipelineActionsForReceipt('_botAgendar', origin, { message: {} });
    expect(actions).toEqual([{ kind: 'dispatch-ingest', origin }]);
  });

  it('forwards schedule replies to enact update endpoint', () => {
    const actions = pipelineActionsForReceipt('_botAgendar', origin, { message: {} }, { isReply: true });
    expect(actions).toEqual([
      {
        kind: 'forward-webhook',
        domain: 'enact.prisma.events',
        path: '/api/webhook/resolve/schedule/update',
        payload: { message: {} },
      },
    ]);
  });

  it('dispatches ingest for decidir without forward', () => {
    const actions = pipelineActionsForReceipt('_botDecidir', origin, { message: {} });
    expect(actions).toEqual([{ kind: 'dispatch-ingest', origin }]);
  });

  it('dispatches ingest for unconfigured _bot topics', () => {
    const actions = pipelineActionsForReceipt('_botHotdog', origin, { message: {} });
    expect(actions).toEqual([{ kind: 'dispatch-ingest', origin }]);
  });

  it('skips ingest for replies on unconfigured _bot topics', () => {
    const actions = pipelineActionsForReceipt('_botHotdog', origin, { message: {} }, { isReply: true });
    expect(actions).toEqual([]);
  });
});

describe('pipelineActionsAfterIngest', () => {
  it('triggers resolve for agendar text', () => {
    const actions = pipelineActionsAfterIngest(
      '_botAgendar',
      makeEntryInput({ textContent: { text: 'Schedule meeting' } }),
      makeEntry(),
      origin
    );
    expect(actions).toEqual([
      { kind: 'trigger-resolve', entryId: 'entry-1', topic: '_botAgendar' },
    ]);
  });

  it('dispatches transcribe for agendar voice', () => {
    const actions = pipelineActionsAfterIngest(
      '_botAgendar',
      makeEntryInput({
        voice: {
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 10,
          mimeType: 'audio/ogg',
        },
      }),
      makeEntry({
        voice: {
          id: 'voice-1',
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 10,
          mimeType: 'audio/ogg',
          processingStatus: 'pending',
          retryCount: 0,
        },
      }),
      origin
    );
    expect(actions).toEqual([
      { kind: 'dispatch-transcribe', origin, voiceId: 'voice-1' },
    ]);
  });

  it('chains transcribe for enrol voice', () => {
    const actions = pipelineActionsAfterIngest(
      '_botEnrolment',
      makeEntryInput({
        chat: { id: 1, type: 'supergroup', topic: '_botEnrolment' },
        voice: {
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 10,
          mimeType: 'audio/ogg',
        },
      }),
      makeEntry({
        chat: { id: 1, type: 'supergroup', topic: '_botEnrolment' },
        voice: {
          id: 'voice-1',
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 10,
          mimeType: 'audio/ogg',
          processingStatus: 'pending',
          retryCount: 0,
        },
      }),
      origin
    );
    expect(actions).toEqual([
      { kind: 'dispatch-transcribe', origin, voiceId: 'voice-1' },
    ]);
  });

  it('dispatches long voice to transcribe service', () => {
    const actions = pipelineActionsAfterIngest(
      '_botAgendar',
      makeEntryInput({
        voice: {
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 200,
          mimeType: 'audio/ogg',
        },
      }),
      makeEntry({
        voice: {
          id: 'voice-1',
          fileId: 'f1',
          fileUniqueId: 'fu1',
          fileSize: 1,
          duration: 200,
          mimeType: 'audio/ogg',
          processingStatus: 'pending',
          retryCount: 0,
        },
      }),
      origin
    );
    expect(actions).toEqual([
      {
        kind: 'dispatch-transcribe-service',
        voiceId: 'voice-1',
        telegramFileId: 'f1',
      },
    ]);
  });

  it('triggers resolve for enrol text on ingest', () => {
    const actions = pipelineActionsAfterIngest(
      '_botEnrolment',
      makeEntryInput({
        chat: { id: 1, type: 'supergroup', topic: '_botEnrolment' },
        textContent: { text: 'not /ask' },
      }),
      makeEntry({ chat: { id: 1, type: 'supergroup', topic: '_botEnrolment' } }),
      origin
    );
    expect(actions).toEqual([
      { kind: 'trigger-resolve', entryId: 'entry-1', topic: '_botEnrolment' },
    ]);
  });

  it('returns none for evaluation channel without resolve', () => {
    const actions = pipelineActionsAfterIngest(
      '_botEvaluation',
      makeEntryInput({
        chat: { id: 1, type: 'supergroup', topic: '_botEvaluation' },
        textContent: { text: 'hello' },
      }),
      makeEntry({ chat: { id: 1, type: 'supergroup', topic: '_botEvaluation' } }),
      origin
    );
    expect(actions).toEqual([{ kind: 'none' }]);
  });

  it('triggers resolve for recursos text', () => {
    const actions = pipelineActionsAfterIngest(
      '_botRecursos',
      makeEntryInput({
        chat: { id: 1, type: 'supergroup', topic: '_botRecursos' },
        textContent: { text: 'https://www.youtube.com/watch?v=abc123' },
      }),
      makeEntry({ chat: { id: 1, type: 'supergroup', topic: '_botRecursos' } }),
      origin
    );
    expect(actions).toEqual([
      { kind: 'trigger-resolve', entryId: 'entry-1', topic: '_botRecursos' },
    ]);
  });

  it('triggers resolve for resources alias topic', () => {
    const actions = pipelineActionsAfterIngest(
      '_botResources',
      makeEntryInput({
        chat: { id: 1, type: 'supergroup', topic: '_botResources' },
        textContent: { text: 'https://youtu.be/abc123' },
      }),
      makeEntry({ chat: { id: 1, type: 'supergroup', topic: '_botResources' } }),
      origin
    );
    expect(actions).toEqual([
      { kind: 'trigger-resolve', entryId: 'entry-1', topic: '_botResources' },
    ]);
  });
});
