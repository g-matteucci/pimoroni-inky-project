import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";
import { createInkyMatteucciEventProducer, LoggerService } from "inky-matteucci-commons";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in the environment variables");
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const logger = new LoggerService("telegram-bot");
const producer = createInkyMatteucciEventProducer();

logger.info("Starting Telegram bot...");

bot.on(message("photo"), async (ctx) => {
  const id = uuidv4();
  const chatId = ctx.chat.id;
  const user = ctx.from;
  const userId = user.id;
  const username = user.username || "-";
  const firstName = user.first_name || "-";
  const lastName = user.last_name || "-";
  const timestamp = new Date().toISOString();

  logger.info(`Arrived a photo message from ${username} (${userId}) in chat ${chatId}`);

  const largestPhoto = ctx.message.photo.reduce((max, photo) => {
    return photo?.height > (max?.height ?? 0) ? photo : max;
  }, ctx.message.photo[0]);

  if (!largestPhoto) {
    logger.error(`No photo found in the message from ${username} (${userId}) in chat ${chatId}`);
    return;
  }

  logger.info(`Largest photo found: ${largestPhoto.file_id} with height ${largestPhoto.height}`);

  const photoId = largestPhoto.file_id;

  const fileUrl = await bot.telegram.getFileLink(photoId);

  await producer.produceEvent({
    type: "added_photo",
    data: {
      id,
      chatId,
      photoId,
      photoUrl: fileUrl.toString(),
      userId,
      username,
      firstName,
      lastName,
      timestamp,
    },
    timestamp,
  });

  logger.info(`Saved photo with ID: ${id} for user ${username} in chat ${chatId}`);

  bot.telegram.sendMessage(chatId, `Ho salvato la tua fotina! Grazie!`);
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
