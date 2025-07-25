import { createInkyMatteucciEventProducer, ImageStorageService, LoggerService } from "inky-matteucci-commons";

class HistoryRandomPickerService<T> {
  private history: T[] = [];
  constructor(private items: T[], private cooldown: number = 5) {}

  pick(): T | null {
    const candidates = this.items.filter((item) => !this.history.includes(item));
    if (candidates.length === 0) {
      this.history = [];
      return this.pick();
    }
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (!choice) return null;

    this.history.push(choice);
    if (this.history.length > this.cooldown) this.history.shift();
    return choice;
  }
}

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
  await producer.quit();
}

main();
