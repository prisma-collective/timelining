import { initDriver } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';
import type {
  CommitHistoryEntry,
  DocsIngestStats,
  DocsPageUpsertInput,
  DocsPageViewEvent,
  PageSnapshotEntry,
} from '@/lib/db/models/page';
import type { Session, Transaction } from 'neo4j-driver';

const DOCS_SOURCE = 'docs';

export async function getDocsPageChecksum(slug: string): Promise<string | null> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      RETURN p.checksum AS checksum
      `,
      { slug, source: DOCS_SOURCE }
    );

    if (result.records.length === 0) {
      return null;
    }

    const checksum = result.records[0].get('checksum');
    return typeof checksum === 'string' ? checksum : null;
  } finally {
    await session.close();
  }
}

export async function getDocsPageChecksums(
  slugs: string[],
  existingSession?: Session
): Promise<Map<string, string | null>> {
  const checksums = new Map<string, string | null>();
  if (slugs.length === 0) {
    return checksums;
  }

  const session = existingSession ?? (await initDriver()).session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      UNWIND $slugs AS slug
      OPTIONAL MATCH (p:Page { slug: slug, source: $source })
      RETURN slug, p.checksum AS checksum
      `,
      { slugs, source: DOCS_SOURCE }
    );

    for (const record of result.records) {
      const slug = record.get('slug') as string;
      const checksum = record.get('checksum');
      checksums.set(slug, typeof checksum === 'string' ? checksum : null);
    }

    return checksums;
  } finally {
    if (!existingSession) {
      await session.close();
    }
  }
}

async function upsertDocsPageInTx(tx: Transaction, input: DocsPageUpsertInput): Promise<void> {
  await tx.run(
    `
    MERGE (p:Page { slug: $slug })
    SET p.title = $title,
        p.checksum = $checksum,
        p.created_at = datetime($created_at),
        p.last_modified = datetime($last_modified),
        p.source = $source
    `,
    { ...input, source: DOCS_SOURCE }
  );
}

async function upsertDocsCommitsInTx(
  tx: Transaction,
  slug: string,
  commitHistory: CommitHistoryEntry[]
): Promise<void> {
  if (commitHistory.length === 0) {
    return;
  }

  await tx.run(
    `
    MATCH (p:Page { slug: $slug, source: $source })
    UNWIND $commits AS commit
    MERGE (c:Commit { sha: commit.sha })
    SET c.message = commit.message,
        c.author_name = commit.author_name,
        c.author_email = commit.author_email,
        c.timestamp = datetime(commit.timestamp)
    MERGE (c)-[:MODIFIES]->(p)
    `,
    {
      slug,
      source: DOCS_SOURCE,
      commits: commitHistory,
    }
  );
}

async function upsertDocsUnresolvedAuthorsInTx(
  tx: Transaction,
  slug: string,
  authors: PageSnapshotEntry['authors']
): Promise<void> {
  if (authors.length === 0) {
    return;
  }

  await tx.run(
    `
    MATCH (p:Page { slug: $slug, source: $source })
    UNWIND $authors AS author
    MERGE (u:UnresolvedAuthor { email: author.email })
    SET u.name = author.name
    MERGE (u)-[:CONTRIBUTED_TO]->(p)
    `,
    { authors, slug, source: DOCS_SOURCE }
  );
}

/** Upsert page metadata, commits, and authors in one transaction. */
export async function syncDocsPageFromSnapshot(entry: PageSnapshotEntry): Promise<void> {
  const session = (await initDriver()).session({ database: 'neo4j' });

  try {
    await session.writeTransaction(async (tx) => {
      await upsertDocsPageInTx(tx, {
        slug: entry.slug,
        title: entry.title,
        checksum: entry.checksum,
        created_at: entry.created_at,
        last_modified: entry.last_modified,
      });
      await upsertDocsCommitsInTx(tx, entry.slug, entry.commit_history);
      await upsertDocsUnresolvedAuthorsInTx(tx, entry.slug, entry.authors);
    });
  } finally {
    await session.close();
  }
}

export async function syncDocsPagesFromSnapshotBatch(
  entries: PageSnapshotEntry[],
  session: Session
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await session.writeTransaction(async (tx) => {
    for (const entry of entries) {
      await upsertDocsPageInTx(tx, {
        slug: entry.slug,
        title: entry.title,
        checksum: entry.checksum,
        created_at: entry.created_at,
        last_modified: entry.last_modified,
      });
      await upsertDocsCommitsInTx(tx, entry.slug, entry.commit_history);
      await upsertDocsUnresolvedAuthorsInTx(tx, entry.slug, entry.authors);
    }
  });
}

export async function writeDocsIngestRun(stats: DocsIngestStats, existingSession?: Session): Promise<string> {
  const id = crypto.randomUUID();
  const session = existingSession ?? (await initDriver()).session({ database: 'neo4j' });

  try {
    await session.run(
      `
      CREATE (r:IngestRun {
        id: $id,
        timestamp: datetime(),
        pages_checked: $pages_checked,
        pages_updated: $pages_updated,
        pages_created: $pages_created
      })
      `,
      {
        id,
        pages_checked: stats.pages_checked,
        pages_updated: stats.pages_updated,
        pages_created: stats.pages_created,
      }
    );
    return id;
  } finally {
    if (!existingSession) {
      await session.close();
    }
  }
}

/** Returns true if a docs Page node was updated. */
export async function recordDocsPageView({
  slug,
  timestamp,
}: DocsPageViewEvent): Promise<boolean> {
  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(
      `
      MATCH (p:Page { slug: $slug, source: $source })
      SET p.viewCount = coalesce(p.viewCount, 0) + 1
      MERGE (t:Timestamp { time: $timestamp })
      MERGE (p)-[:VIEWED_AT]->(t)
      RETURN p.slug AS slug
      `,
      { slug, timestamp, source: DOCS_SOURCE }
    );

    return result.records.length > 0;
  } catch (error) {
    logger.error('recordDocsPageView failed', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await session.close();
  }
}
