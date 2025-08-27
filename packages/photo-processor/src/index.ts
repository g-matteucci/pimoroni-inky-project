// packages/photo-processor/src/index.ts
import fs from "fs";
import sharp from "sharp";
import { match } from "ts-pattern";
import {
  consumeInkyMatteucciEvents,
  ImageStorageService,
  LoggerService,
  PhotoRegistryService,
} from "inky-matteucci-commons";

const logger = new LoggerService("photo-processor");
const imageStorageService = new ImageStorageService();
const registry = new PhotoRegistryService();

logger.info("Starting image manager consumer...");

consumeInkyMatteucciEvents((event) => {
  match(event)
    .with({ type: "added_photo" }, async (e) => {
      const { photoId, photoUrl, chatId, userId, username, firstName, lastName, timestamp } = e.data;
      logger.info(`Adding photo: ${photoId}`);

      try {
        const resp = await fetch(photoUrl);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} while fetching ${photoUrl}`);
        }

        const srcBuffer = Buffer.from(await resp.arrayBuffer());

        const optimizedImage = await sharp(srcBuffer)
          .resize({ width: 800, height: 600, fit: "contain", withoutEnlargement: true })
          .jpeg({ quality: 50 })
          .toBuffer();

        // Salva su disco
        imageStorageService.saveImage(photoId, optimizedImage);
        const absPath = imageStorageService.getFileFullPath(photoId);
        const st = fs.statSync(absPath);

        // Append nel registro JSONL (writer unico)
        registry.appendPhoto({
          basename: photoId, // es. "AgAC..."
          absPath,
          bytes: st.size,
          telegram: {
            chatId,
            userId,
            username,
            firstName,
            lastName,
            timestamp, // ISO dal bot
          },
          // addedAtIso: default = now
        });

        logger.info(`Photo saved & registered: ${photoId}`);
      } catch (err) {
        logger.error(`Failed to add ${photoId}: ${(err as Error).message}`);
      }
    })
    .with({ type: "removed_photo" }, (e) => {
      const { photoId } = e.data;
      logger.info(`Removing photo: ${photoId}`);

      try {
        imageStorageService.deleteImage(photoId);

        // Tombstone nel registro
        registry.appendTombstone(photoId);

        logger.info(`Photo deleted & tombstoned: ${photoId}`);
      } catch (err) {
        logger.error(`Failed to remove ${photoId}: ${(err as Error).message}`);
      }
    })
    // Eventi non di interesse per questo servizio
    .with({ type: "display_photo" }, () => {})
    .exhaustive();
});
