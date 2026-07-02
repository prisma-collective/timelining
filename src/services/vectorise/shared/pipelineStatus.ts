export const MAX_RETRIES = 2;

export type PipelineFailedStage = 'transcribe' | 'chunk' | 'vectorise';

export interface RecordStageFailureParams {
  nodeLabel: 'Voice' | 'Resource';
  idParam: string;
  id: string;
  stage: PipelineFailedStage;
  statusProperty?: string;
}

export function buildStageFailureCypher(params: RecordStageFailureParams): string {
  const statusProperty = params.statusProperty ?? 'processingStatus';
  return `
    MATCH (n:${params.nodeLabel} { ${params.idParam}: $id })
    SET n.retryCount = coalesce(n.retryCount, 0) + 1
    WITH n
    SET n.${statusProperty} = CASE
          WHEN n.retryCount >= $maxRetries THEN 'failed'
          ELSE n.${statusProperty}
        END,
        n.failedStage = CASE
          WHEN n.retryCount >= $maxRetries THEN $stage
          ELSE n.failedStage
        END
  `;
}
