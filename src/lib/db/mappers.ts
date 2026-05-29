import { TelegramMessage } from '@/lib/telegram';
import type { Node } from 'neo4j-driver';

import { 
    FullEntryData, 
    EntryNode, 
    ParticipantNode, 
    TelegramChatNode, 
    TextContentNode, 
    CaptionContentNode, 
    EntityNode, 
    PhotoNode, 
    VoiceNode,
    VoiceChunkNode,
    VoiceWithEntry,
    VoiceProcessingStatus,
    VoiceFailedStage,
    FullEntryInputData,
    VideoNode,
    VideoNoteNode
} from '@/lib/db/models/entry'; 

export function mapTelegramMessageToEntryInputData(msg: TelegramMessage): FullEntryInputData {
    if (!msg.message || !msg.message.chat) {
        throw new Error('Invalid Telegram message: missing message or chat.');
    }

    const replyTo = !!msg.message.reply_to_message && !msg.message.reply_to_message.forum_topic_created
        ? msg.message.reply_to_message
        : undefined;

    const name = msg.message.reply_to_message && msg.message.reply_to_message.forum_topic_created
        ? msg.message.reply_to_message.forum_topic_created.name
        : `${msg.message.chat.type}_${msg.message.chat.username}`;
    
    const rawVideo = msg.message.video;

    return {
        entry: {
            updateId: msg.update_id,
            messageId: msg.message.message_id,
            date: new Date(msg.message.date * 1000).toISOString(),
        },
        participant: {
            handle: msg.message.from?.username || String(msg.message.from?.id) || 'unknown',
        },
        chat: {
            id: msg.message.chat.id,
            title: msg.message.chat.title ? msg.message.chat.title : undefined,
            username: msg.message.chat.username ? msg.message.chat.username : undefined,
            type: msg.message.chat.type,
            isForum: msg.message.chat.is_forum,
            topic: msg.message.reply_to_message?.forum_topic_created ? msg.message.reply_to_message.forum_topic_created.name : undefined
        },
        replyTo: replyTo
            ? {
                messageId: replyTo.message_id
            }
            : undefined,
        textContent: msg.message.text ? { text: msg.message.text } : undefined,
        captionContent: msg.message.caption ? { caption: msg.message.caption } : undefined,
        entities: msg.message.entities?.map(entity => ({
            offset: entity.offset,
            length: entity.length,
            type: entity.type,
        })) || [],
        photos: msg.message.photo
            ? Array.isArray(msg.message.photo)
            ? msg.message.photo.map(photo => ({
                fileId: photo.file_id,
                fileUniqueId: photo.file_unique_id,
                fileSize: photo.file_size,
                width: photo.width,
                height: photo.height,
                }))
            : [{
                fileId: msg.message.photo.file_id,
                fileUniqueId: msg.message.photo.file_unique_id,
                fileSize: msg.message.photo.file_size,
                width: msg.message.photo.width,
                height: msg.message.photo.height,
                }]
            : [],
        voice: msg.message.voice
            ? {
                fileId: msg.message.voice.file_id,
                fileUniqueId: msg.message.voice.file_unique_id,
                fileSize: msg.message.voice.file_size,
                duration: msg.message.voice.duration,
                mimeType: msg.message.voice.mime_type,
            }
            : undefined,
        videos: rawVideo
            ? Array.isArray(rawVideo)
            ? rawVideo.map(video => ({
                duration: video.duration,
                width: video.width,
                height: video.height,
                mimeType: video.mime_type,
                fileId: video.file_id,
                fileUniqueId: video.file_unique_id,
                fileSize: video.file_size,
                }))
            : [{
                duration: rawVideo.duration,
                width: rawVideo.width,
                height: rawVideo.height,
                mimeType: rawVideo.mime_type,
                fileId: rawVideo.file_id,
                fileUniqueId: rawVideo.file_unique_id,
                fileSize: rawVideo.file_size,
                }]
            : [], 
        videoNote: msg.message.video_note
            ? {
                fileId: msg.message.video_note.file_id,
                fileUniqueId: msg.message.video_note.file_unique_id,
                fileSize: msg.message.video_note.file_size,
                duration: msg.message.video_note.duration,
                length: msg.message.video_note.length,
            }
            : undefined,
    }
}
  
function mapEntryNode(node: Node): EntryNode {
    return {
        id: node.properties.id,
        updateId: node.properties.updateId,
        messageId: node.properties.messageId,
        date: node.properties.date,
    };
}

function mapParticipantNode(node: Node): ParticipantNode {
    return {
        handle: node.properties.handle,
    };
}

function mapTelegramChatNode(node: Node): TelegramChatNode {
    return {
        id: node.properties.id,
        type: node.properties.type,
        title: node.properties.title,
        username: node.properties.username,
        topic: node.properties.topic
    };
}

function mapTextContentNode(node: Node): TextContentNode {
    return {
        id: node.properties.id,
        text: node.properties.text,
    };
}

function mapCaptionContentNode(node: Node): CaptionContentNode {
    return {
        id: node.properties.id,
        caption: node.properties.caption,
    };
}

function mapEntityNodes(entities: Node[]): EntityNode[] {
    return entities.map((entity) => ({
        id: entity.properties.id,
        offset: entity.properties.offset,
        length: entity.properties.length,
        type: entity.properties.type,
    }));
}

function mapPhotoNodes(photos: Node[]): PhotoNode[] {
    return photos.map((photo) => ({
        id: photo.properties.id,
        fileId: photo.properties.fileId,
        fileUniqueId: photo.properties.fileUniqueId,
        fileSize: photo.properties.fileSize,
        width: photo.properties.width,
        height: photo.properties.height,
    }));
}

function toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
        return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
}

export function mapVoiceNode(node: Node): VoiceNode {
    const props = node.properties;
    return {
        id: props.id,
        fileId: props.fileId,
        fileUniqueId: props.fileUniqueId,
        fileSize: toNumber(props.fileSize),
        duration: toNumber(props.duration),
        mimeType: props.mimeType,
        transcription: props.transcription ?? undefined,
        processingStatus: (props.processingStatus ?? 'pending') as VoiceProcessingStatus,
        retryCount: toNumber(props.retryCount ?? 0),
        failedStage: props.failedStage as VoiceFailedStage | undefined,
    };
}

export function mapVoiceChunkNode(node: Node): VoiceChunkNode {
    const props = node.properties;
    return {
        id: props.id,
        chunk_text: props.chunk_text,
        embedding: props.embedding,
    };
}

export function mapVoiceWithEntry(record: { get: (key: string) => Node }): VoiceWithEntry {
    const entryNode = record.get('e');
    return {
        entryId: entryNode.properties.id,
        voice: mapVoiceNode(record.get('v')),
    };
}

function mapVideoNodes(videos: Node[]): VideoNode[] {
    return videos.map((video) => ({
        id: video.properties.id,
        duration: video.properties.duration,
        width: video.properties.width,
        height: video.properties.height,
        mimeType: video.properties.mimeType,
        fileId: video.properties.fileId,
        fileUniqueId: video.properties.fileUniqueId,
        fileSize: video.properties.fileSize,
    }));
}

function mapVideoNoteNode(node: Node): VideoNoteNode {
    return {
        id: node.properties.id,
        duration: node.properties.duration,
        length: node.properties.length,
        fileId: node.properties.fileId,
        fileUniqueId: node.properties.fileUniqueId,
        fileSize: node.properties.fileSize,
    };
}

export function mapFullEntryData(record: any): FullEntryData {
    return {
        entry: mapEntryNode(record.get('e')),
        participant: mapParticipantNode(record.get('p')),
        chat: mapTelegramChatNode(record.get('c')),
        textContent: record.get('t') ? mapTextContentNode(record.get('t')) : undefined,
        captionContent: record.get('cap') ? mapCaptionContentNode(record.get('cap')) : undefined,
        entities: record.get('entities') ? mapEntityNodes(record.get('entities')) : [],
        photos: record.get('photos') ? mapPhotoNodes(record.get('photos')) : [],
        voice: record.get('vn') ? mapVoiceNode(record.get('vn')) : undefined,
        videos: record.get('videos') ? mapVideoNodes(record.get('videos')) : [],
        videoNote: record.get('vidnote') ? mapVideoNoteNode(record.get('vidnote')) : undefined,
    };
}
