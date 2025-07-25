import path from "path";
import { storagePath, TelegramPhotoMetadataDb } from "inky-matteucci-commons";
import { ImageStorageManager } from "./imageStorageManager";
import { CooldownRandomPicker } from "./cooldownRandomPicker";
import Redis from "ioredis";
const redis = new Redis(); // di default su localhost:6379

// Per aggiungere un messaggio alla coda
async function produce(queue: string, message: string) {
  await redis.rpush(queue, message); // rpush aggiunge in coda
}

const imageStorageManager = new ImageStorageManager(path.join(storagePath, "images"));
const photoMetadataDb = new TelegramPhotoMetadataDb();
const randomPhotoPicker = new CooldownRandomPicker(photoMetadataDb.getAllItems(), 10);

async function main() {
  const randomPhoto = randomPhotoPicker.pick();

  if (!randomPhoto) {
    console.log("No items found in the database. Exiting...");
    return;
  }

  console.log("Chosen image metadata:", randomPhoto);
  console.log(`Downloading image from URL: ${randomPhoto.photoUrl}`);

  console.log("Producing message to image-queue with photo metadata...");
  await produce("image-queue", JSON.stringify(randomPhoto));
  console.log("Produced message to image-queue");

  // function printImageToInky(filePath: string) {
  //   console.log(`Printing image to Inky: ${filePath}`);
  //   // spawnSync("python", [`/Pimoroni/inky/examples/spectra6/image.py`, "--file", imagePath], { stdio: "inherit" });
  //   console.log("Image printed successfully.");
  // }

  // imageStorageManager.withDownloadedImage(randomPhoto.photoUrl, printImageToInky);
}

main();
