import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import {
  createInkyMatteucciEventProducer,
  consumeInkyMatteucciEvents,
  LoggerService,
} from "inky-matteucci-commons";

dotenv.config({ path: "./.env" });

type AppConfig = {
  min_shuffle_time: number;
  default_shuffle_time: number;
  last_display_at?: string;
};

const CONFIG_PATH =
  process.env.CONFIG_PATH ?? path.resolve(__dirname, "../../../config.json");

function loadConfig(): AppConfig {
  const defaults: AppConfig = { min_shuffle_time: 1, default_shuffle_time: 5 };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const cfg = { ...defaults, ...parsed };
    if (cfg.default_shuffle_time < cfg.min_shuffle_time) {
      cfg.default_shuffle_time = cfg.min_shuffle_time;
    }
    return cfg;
  } catch {
    return defaults; // lo scheduler creerà il file
  }
}
function msToHuman(ms: number) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  if (r === 0) return `${m}m`;
  return `${m}m ${r}s`;
}

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in the environment variables");
}
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const logger = new LoggerService("telegram-bot");
const producer = createInkyMatteucciEventProducer();

logger.info("Starting Telegram bot...");

/* --- PHOTO UPLOAD COME PRIMA --- */
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

  await bot.telegram.sendMessage(chatId, `Ho salvato la tua fotina! Grazie!`);
});

/* --- /start --- */
bot.start(async (ctx) => {
  const cfg = loadConfig();
  const txt = [
    "Ciao! Questo bot gestisce le foto dell'Inky Frame.",
    "",
    "Comandi:",
    "/start - questa guida",
    "/set_shuffle <min> - imposta l'intervallo di cambio foto",
    "/next - cambia subito foto (se è passato il tempo minimo)",
    "",
    `Vincolo minimo: ${cfg.min_shuffle_time} min`,
    `Intervallo corrente: ${cfg.default_shuffle_time} min`,
  ].join("\n");
  return ctx.reply(txt);
});

/* --- /set_shuffle <min> --- */
bot.command("set_shuffle", async (ctx) => {
  const cfg = loadConfig();
  const parts = ctx.message.text.trim().split(/\s+/);
  const value = Number(parts[1]);

  if (!Number.isFinite(value) || value <= 0) {
    return ctx.reply("Uso: /set_shuffle <minuti>. Esempio: /set_shuffle 5");
  }

  const effective = Math.max(value, cfg.min_shuffle_time);
  await producer.produceEvent({
    type: "set_shuffle",
    data: { minutes: effective, requestedBy: ctx.from.id, chatId: ctx.chat.id },
    timestamp: new Date().toISOString(),
  });

  if (value < cfg.min_shuffle_time) {
    return ctx.reply(
      `Non posso scendere sotto ${cfg.min_shuffle_time} min. Imposto a ${effective} min.`
    );
  }
  return ctx.reply(`Ok! Imposto a ${effective} min.`);
});

/* --- /next --- */
bot.command("next", async (ctx) => {
  await producer.produceEvent({
    type: "request_next",
    data: { chatId: ctx.chat.id, requestedBy: ctx.from.id },
    timestamp: new Date().toISOString(),
  });
  // La risposta arriverà via evento next_result (vedi consumer sotto)
});

/* --- CONSUMO RISPOSTE SCHEDULER --- */
consumeInkyMatteucciEvents(async (event) => {
  if (event.type !== "next_result") return;
  const { chatId, ok, msRemaining, noImages } = event.data;

  if (noImages) {
    return bot.telegram.sendMessage(chatId, "Nessuna immagine disponibile.");
  }
  if (ok) {
    return bot.telegram.sendMessage(chatId, "Immagine cambiata.");
  }
  if (typeof msRemaining === "number") {
    return bot.telegram.sendMessage(chatId, `Troppo presto. Riprova tra ${msToHuman(msRemaining)}.`);
  }
});

bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

