import cron from "node-cron";
import { createInkyMatteucciEventProducer, ImageStorageService, LoggerService } from "inky-matteucci-commons";
import { HistoryRandomPickerService } from "./services/historyRandomPickerService";

const imageStorageService = new ImageStorageService();
const logger = new LoggerService("photo-display-scheduler");
const producer = createInkyMatteucciEventProducer();

logger.info("Starting image display producer...");

async function main() {
  logger.info("Displaying random image...");

  const randomPicker = new HistoryRandomPickerService<string>(imageStorageService.listImages(), 5);
  const randomImageUrl = randomPicker.pick();

  if (!randomImageUrl) {
    logger.warn("No images available to display.");
    return;
  }

  const imageFullPath = imageStorageService.getFileFullPath(randomImageUrl);

  logger.info(`Picked random image: ${imageFullPath}`);

  await producer.produceEvent({
    type: "display_photo",
    data: {
      photoUrl: imageFullPath,
    },
    timestamp: new Date().toISOString(),
  });

  logger.info("Event produced successfully.");
}

cron.schedule("*/15 * * * *", main);
