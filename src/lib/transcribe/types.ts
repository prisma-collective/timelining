export type TranscribeSourceKind = 'youtube' | 'telegram_voice';

export type TranscribeJob =
  | {
      sourceKind: 'youtube';
      nodeId: string;
      youtubeVideoId: string;
    }
  | {
      sourceKind: 'telegram_voice';
      nodeId: string;
      telegramFileId: string;
    };

export interface TranscribeAccepted {
  jobId: string;
  sourceKind: TranscribeSourceKind;
  nodeId: string;
  status: 'accepted';
}

export interface TranscriptionCallback {
  jobId: string;
  sourceKind: TranscribeSourceKind;
  nodeId: string;
  status: 'completed' | 'failed';
  transcription?: string;
  transcriptSource: 'whisper';
  language?: string;
  error?: string;
}

export interface DispatchTranscribeResult {
  dispatched: boolean;
  jobId?: string;
  error?: string;
}
