import { randomUUID } from 'crypto';
import type { TranscribeAccepted, TranscribeJob } from './types.js';
import { runTranscribeJob } from './worker.js';

const activeJobs = new Set<string>();

export function enqueueTranscribeJob(job: TranscribeJob): TranscribeAccepted {
  const jobId = randomUUID();

  if (activeJobs.has(job.nodeId)) {
    return {
      jobId,
      sourceKind: job.sourceKind,
      nodeId: job.nodeId,
      status: 'accepted',
    };
  }

  activeJobs.add(job.nodeId);

  setImmediate(() => {
    runTranscribeJob(job, jobId)
      .catch((error) => {
        console.error('Transcribe job failed unexpectedly', { jobId, error });
      })
      .finally(() => {
        activeJobs.delete(job.nodeId);
      });
  });

  return {
    jobId,
    sourceKind: job.sourceKind,
    nodeId: job.nodeId,
    status: 'accepted',
  };
}
