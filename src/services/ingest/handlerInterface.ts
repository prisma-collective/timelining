// types/Handler.ts
import { TelegramMessage } from '../../lib/telegram';

export interface MessageHandler {
    canHandle(message: TelegramMessage['message']): boolean;
    handle(message: TelegramMessage['message']): Promise<boolean>;
}
