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

// (opzionale ma utile se qualche env arriva da PM2/systemd)
dotenv.config({ path: "./.env", override: true }); // NEW

/** -------------------- Config & helpers -------------------- **/

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
    return defaults;
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

/** -------------------- Whitelist -------------------- **/

function parseWhitelist(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? "")
      .split(/[,\s]+/)                  // separa per virgole/spazi/newline
      .filter(Boolean)                  // rimuove stringhe vuote
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isSafeInteger(n) && n > 0)
  );
}

const whitelist = parseWhitelist(process.env.TELEGRAM_USERS_WHITELIST);
const isWhitelisted = (id?: number) => typeof id === "number" && whitelist.has(id);

/** -------------------- Boot -------------------- **/

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in the environment variables");
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const logger = new LoggerService("telegram-bot");
const producer = createInkyMatteucciEventProducer();

// Log iniziale della whitelist letta da env
logger.info(`WL_RAW=${JSON.stringify(process.env.TELEGRAM_USERS_WHITELIST)}`); // NEW
logger.info(`WL_PARSED=[${[...whitelist].join(", ")}]`); // NEW

logger.info("Starting Telegram bot…");

// Middleware globale: logga qualsiasi messaggio che sembra un comando "/..."
bot.use(async (ctx, next) => { // NEW
  const chatId = ctx.chat?.id;
  const from = ctx.from;
  const text = (ctx.message as any)?.text;
  const isCommand = typeof text === "string" && text.startsWith("/");
  if (isCommand) {
    const cmd = text.split(/\s+/)[0];
    logger.info(
      `CMD incoming: cmd=${cmd} from=@${from?.username ?? "-"}(${from?.id ?? "-"}) chat=${chatId}`
    );
  }
  return next();
});

// Helper per estrarre il comando (per i log whitelist)
function getCommand(ctx: any): string { // NEW
  const text = ctx.message?.text ?? "";
  const m = /^\/([A-Za-z0-9_]+)/.exec(text);
  return m ? m[1] : "unknown";
}

/** Middleware per comandi riservati: logga check whitelist + esito */
async function requireWhitelist(ctx: any, next: () => Promise<any>) { // NEW (sostituisce il tuo)
  const id = ctx.from?.id as number | undefined;
  const allowed = isWhitelisted(id);
  const cmd = getCommand(ctx);
  logger.info(
    `WL_CHECK: cmd=/${cmd} from=@${ctx.from?.username ?? "-"}(${id ?? "-"}) ` +
    `chat=${ctx.chat?.id} allowed=${allowed} wl=[${[...whitelist].join(", ")}]`
  );
  if (!allowed) {
    return ctx.reply(
      `Questa funzione è riservata agli utenti autorizzati.\n` +
      `Il tuo ID è: ${id ?? "sconosciuto"}. Se vuoi l’accesso, contatta Peppe.`
    );
  }
  return next();
}

/** -------------------- Photo uploads (open to everyone) -------------------- **/

bot.on(message("photo"), async (ctx) => {
  const id = uuidv4();
  const chatId = ctx.chat.id;
  const user = ctx.from;
  const userId = user.id;
  const username = user.username || "-";
  const firstName = user.first_name || "-";
  const lastName = user.last_name || "-";
  const timestamp = new Date().toISOString();

  logger.info(`Photo from ${username} (${userId}) in chat ${chatId}`);

  const largestPhoto = ctx.message.photo.reduce((max, photo) => {
    return photo?.height > (max?.height ?? 0) ? photo : max;
  }, ctx.message.photo[0]);

  if (!largestPhoto) {
    logger.error(`No photo found in message from ${username} (${userId}) in chat ${chatId}`);
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

  await ctx.reply(
    "Ricevuto! La tua foto è stata salvata e sarà pronta per essere mostrata sull'Inky."
  );
});

/** -------------------- /start (public, personalized) -------------------- **/

bot.start(async (ctx) => {
  // Log anche qui per completezza
  logger.info(`CMD /start handler: from=@${ctx.from?.username ?? "-"}(${ctx.from?.id}) chat=${ctx.chat?.id}`); // NEW

  const cfg = loadConfig();
  const allowed = isWhitelisted(ctx.from?.id);

  const introForAll = [
    "Ciao! Qui puoi inviare foto che verranno mostrate sulla cornice Inky di Peppe",
    "Cerca di rispettare il formato a 5:3 per la migliore visualizzazione.",
    "Tutti possono inviare foto in questa chat.",
  ];

  const accessLine = allowed
    ? "Sei nella whitelist: puoi usare le funzioni private."
    : "";

  const commandsPublic = [
    "/start - mostra queste informazioni",
    "(invio foto) - salva una nuova immagine da usare sull’Inky",
    "/current - mostra l'immagine attualmente mostrata sull'Inky"
  ];

  const commandsPrivate = [
    "/next - vai alla prossima foto (rispetta sempre il tempo minimo)",
    "/set_shuffle <minuti> - imposta l’intervallo di rotazione",
  ];

  const timingInfo = [
    `Tempo minimo tra due cambi: ${cfg.min_shuffle_time} min`,
    `Intervallo di rotazione attuale: ${cfg.default_shuffle_time} min`,
  ];

  const lines = [
    ...introForAll,
    "",
    accessLine,
    "Comandi disponibili:",
    ...commandsPublic,
    ...(allowed ? commandsPrivate : []),
    "",
    ...timingInfo,
  ];

  return ctx.reply(lines.join("\n"));
});

/** -------------------- /set_shuffle (whitelisted) -------------------- **/

bot.command("set_shuffle", requireWhitelist, async (ctx) => {
  logger.info(`CMD /set_shuffle handler: text="${ctx.message.text}" from=${ctx.from?.id} chat=${ctx.chat?.id}`); // NEW

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

/** -------------------- /next (whitelisted) -------------------- **/

bot.command("next", requireWhitelist, async (ctx) => {
  logger.info(`CMD /next handler: from=${ctx.from?.id} chat=${ctx.chat?.id}`); // NEW

  await producer.produceEvent({
    type: "request_next",
    data: { chatId: ctx.chat.id, requestedBy: ctx.from.id },
    timestamp: new Date().toISOString(),
  });
});

/** -------------------- /current   -------------------- **/
bot.command("current", async (ctx) => {
  logger.info(`CMD /current handler: from=${ctx.from?.id} chat=${ctx.chat?.id}`);
  await producer.produceEvent({
    type: "request_current",
    data: { chatId: ctx.chat.id, requestedBy: ctx.from?.id },
    timestamp: new Date().toISOString(),
  });
});


/** -------------------- Listen for scheduler replies -------------------- **/

consumeInkyMatteucciEvents(async (event) => {
  switch (event.type) {
    case "next_result": {
      const { chatId, ok, msRemaining, noImages } = event.data;
      logger.info(
        `EVENT next_result: chat=${chatId} ok=${ok} noImages=${noImages} msRemaining=${msRemaining ?? "-"}`
      );

      if (noImages) {
        await bot.telegram.sendMessage(chatId, "Nessuna immagine disponibile al momento.");
      } else if (ok) {
        await bot.telegram.sendMessage(chatId, "Ok, a breve l'immagine dovrebbe cambiare (pochi secondi...)");
      } else if (typeof msRemaining === "number") {
        await bot.telegram.sendMessage(
          chatId,
          `Troppo presto per cambiare. Riprova tra ${msToHuman(msRemaining)}.`
        );
      }
      return;
    }

    case "current_result": {
      const { chatId, ok, noImages, photoUrl } = event.data as {
        chatId: number; ok?: boolean; noImages?: boolean; photoUrl?: string;
      };
      logger.info(
        `EVENT current_result: chat=${chatId} ok=${ok} noImages=${noImages} photoUrl=${photoUrl ?? "-"}`
      );

      if (noImages) {
        await bot.telegram.sendMessage(chatId, "Nessuna immagine disponibile al momento.");
        return;
      }

      if (ok && photoUrl) {
        await bot.telegram.sendMessage(chatId, "Questa è l'immagine attualmente sull'Inky");
        try {
          if (/^https?:\/\//i.test(photoUrl)) {
            await bot.telegram.sendPhoto(chatId, { url: photoUrl });
          } else {
            await bot.telegram.sendPhoto(chatId, { source: fs.createReadStream(photoUrl) });
          }
        } catch (err) {
          logger.error(`Failed to send current photo "${photoUrl}": ${(err as Error).message}`);
          await bot.telegram.sendMessage(chatId, "Non riesco a leggere l'immagine corrente dal server.");
        }
        return;
      }

      // Fallback
      await bot.telegram.sendMessage(chatId, "Nessuna immagine disponibile al momento.");
      return;
    }

    default:
      // altri eventi non gestiti qui
      return;
  }
});


/** -------------------- Launch & graceful stop -------------------- **/

bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
