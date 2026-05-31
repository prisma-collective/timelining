/** Docs snapshot API — one entry per locale-prefixed page from GET /api/pages/snapshot */
export interface PageSnapshotEntry {
  slug: string;
  title: string;
  checksum: string;
  created_at: string;
  last_modified: string;
  commit_history: CommitHistoryEntry[];
  authors: PageAuthorEntry[];
}

export interface CommitHistoryEntry {
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: string;
}

export interface PageAuthorEntry {
  name: string;
  email: string;
  commit_count: number;
}

export interface DocsPageUpsertInput {
  slug: string;
  title: string;
  checksum: string;
  created_at: string;
  last_modified: string;
}

export interface DocsIngestStats {
  pages_checked: number;
  pages_updated: number;
  pages_created: number;
}

export type DocsIngestStatus = 'success' | 'skipped' | 'error';

export interface DocsIngestResult {
  status: DocsIngestStatus;
  message?: string;
  stats: DocsIngestStats;
  ingestRunId?: string;
}

export interface DocsPageViewEvent {
  slug: string;
  timestamp: string;
}

export interface LogDrainProcessResult {
  processed: number;
  recorded: number;
  skipped: number;
}

/** Raw log drain payload entries (Vercel / proxy shapes vary) */
export interface LogDrainEntry {
  path?: string;
  url?: string;
  message?: string;
  timestamp?: string;
  [key: string]: unknown;
}
