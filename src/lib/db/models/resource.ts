export type ResourceProcessingStatus =
  | 'pending'
  | 'transcribed'
  | 'chunked'
  | 'vectorised'
  | 'failed';

export type ResourceFailedStage = 'transcribe' | 'chunk' | 'vectorise';

export interface ResourceNode {
  id: string;
  url: string;
  youtubeVideoId: string;
  sourceKind: 'youtube';
  transcription?: string;
  processingStatus: ResourceProcessingStatus;
  retryCount: number;
  failedStage?: ResourceFailedStage;
}

export interface ResourceChunkInput {
  chunk_text: string;
  embedding: number[];
}
