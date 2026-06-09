import { TelegramMessage } from '../../lib/telegram';
import { createEntry, logNodeCreation, readEntry } from '../entryService';
import { logger } from '../../lib/logger';
import { verifyExpectationsMet } from '../entryService';
import { mapTelegramMessageToEntryInputData } from '@/lib/db/mappers';

export async function writeEntry(message: TelegramMessage): Promise<string> {

    let entryInput;
    let id;

    try {
        entryInput = mapTelegramMessageToEntryInputData(message);
    } catch (error) {
        logger.error('Failed to map message data to entry input data object:', error);
        throw error;
    }

    const expected = logNodeCreation(entryInput);
    logger.info(`Chat type: ${entryInput.chat.type}`);
    logger.info(`Chat title: ${entryInput.chat.type === 'supergroup' ? entryInput.chat.title : null}`);
    logger.info(`Chat username: ${entryInput.chat.type === 'private' ? entryInput.chat.username : null}`);

    try {
      try {
          id = await createEntry(entryInput);
      } catch (error) {
          logger.error("Failed to create entry:", error);
          throw error;
      }

      let result;
      try {
          result = await readEntry(id);
      } catch (error) {
          logger.error("Failed to read entry after creation:", error);
          throw error;
      }

      verifyExpectationsMet(expected, result);

    } catch (error: unknown) {
        if (error instanceof Error) {
            logger.error("Entry write failed: " + error.message);
            throw error;
        } else {
            logger.error("Entry write failed with non-Error object:", error);
            throw new Error("Unknown error occurred during entry write.");
        }
    }

    return id;
}
