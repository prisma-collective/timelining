import { NextRequest, NextResponse } from 'next/server';
import { initDriver, isNeo4jAvailable } from '@/lib/db/neo4j';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest, {
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params

  const neo4jReady = await isNeo4jAvailable();
  if (!neo4jReady) {
    logger.warn(`Neo4j not available. Cannot fetch data for handle: ${handle}`);
    return NextResponse.json(
      {
        error: 'Database not configured',
        message: 'Neo4j is not available. Please configure Neo4j credentials to access this data.'
      },
      { status: 503 } // Service Unavailable
    );
  }

  const driver = await initDriver();
  const session = driver.session({ database: 'neo4j' })

  logger.info(`Fetching connected nodes for participant handle: ${handle}`);

  try {
    const result = await session.run(
      `
      MATCH (p:Participant {handle: $handle})<-[:SENT_BY]-(e:Entry)
      OPTIONAL MATCH (e)-[:HAS_TEXT]->(t:TextContent)
      OPTIONAL MATCH (e)-[:HAS_CAPTION]->(cap:CaptionContent)
      OPTIONAL MATCH (e)-[:HAS_ENTITY]->(en:Entity)
      OPTIONAL MATCH (e)-[:HAS_PHOTO]->(pht:Photo)
      OPTIONAL MATCH (e)-[:HAS_VOICE]->(vn:Voice)
      OPTIONAL MATCH (e)-[:HAS_VIDEO]->(vid:Video)
      OPTIONAL MATCH (e)-[:HAS_VIDEO_NOTE]->(vidnote:VideoNote)
      OPTIONAL MATCH (e)-[:FROM_CHAT]->(chat:TelegramChat)

      RETURN 
        count(DISTINCT e) as entries,
        count(DISTINCT t) as textContents,
        count(DISTINCT cap) as captionContents,
        count(DISTINCT en) as entities,
        count(DISTINCT pht) as photos,
        count(DISTINCT vn) as voices,
        count(DISTINCT vid) as videos,
        count(DISTINCT vidnote) as videoNotes,
        count(DISTINCT chat) as chats
      `,
      { handle }
    );

    const record = result.records[0];

    const responseData = {
      entries: record.get('entries').toInt(),
      textContents: record.get('textContents').toInt(),
      captionContents: record.get('captionContents').toInt(),
      entities: record.get('entities').toInt(),
      photos: record.get('photos').toInt(),
      voices: record.get('voices').toInt(),
      videos: record.get('videos').toInt(),
      videoNotes: record.get('videoNotes').toInt(),
      chats: record.get('chats').toInt(),
    };

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    logger.error('Failed to fetch participant connections', { error });

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: 'Unknown error occurred' }, { status: 500 });
  } finally {
    await session.close();
  }
}

export async function POST() {
  return new NextResponse('Method Not Allowed', { status: 405 });
}
