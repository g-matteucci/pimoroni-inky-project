import { consumeInkyMatteucciEvents, ImageStorageService, LoggerService } from "inky-matteucci-commons";
import sharp from "sharp";
import { match } from "ts-pattern";

const imageStorageService = new ImageStorageService();
const logger = new LoggerService("photo-processor");

logger.info("Starting image manager consumer...");

consumeInkyMatteucciEvents((event) => {
  match(event)
    .with({ type: "added_photo" }, async (e) => {
      logger.info("Adding photo:", e.data.photoId);
      const response = await fetch(e.data.photoUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const optimizedImage = await sharp(buffer)
        .resize({ width: 800, height: 600, fit: "contain" })
        .jpeg({ quality: 50 })
        .toBuffer();

      imageStorageService.saveImage(e.data.photoId, optimizedImage);
      logger.info(`Photo saved for ${e.data.photoId}`);
    })
    .with({ type: "removed_photo" }, (e) => {
      logger.info("Removing photo:", e.data.photoId);
      imageStorageService.deleteImage(e.data.photoId);
      logger.info(`Photo deleted: ${e.data.photoId}`);
    })
    // Do nothing
    .with({ type: "display_photo" }, () => {})
    .exhaustive();
});
