import fs from "fs";
import path from "path";
import {
  createInkyMatteucciEventProducer,
  consumeInkyMatteucciEvents,
  ImageStorageService,
  LoggerService,
  RequestNextEvent,
  SetShuffleEvent,
} from "inky-matteucci-commons";

type AppConfig = {
  min_shuffle_time: number;        // minuti, hard floor
  default_shuffle_time: number;    // minuti, scheduler interval
  last_display_at?: string;        // ISO last successful rotation
  current_photo_url?: string;      // last picture
};

const logger = new LoggerService("photo-display-scheduler");
const producer = createInkyMatteucciEventProducer();
const storage = new ImageStorageService();

const CONFIG_PATH =
  process.env.CONFIG_PATH ?? path.resolve(__dirname, "../../../config.json");

function ensureDirExists(file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function minutesToMs(m: number) { return Math.max(0, Math.round(m * 60_000)); }

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
    ensureDirExists(CONFIG_PATH);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}
function saveConfig(cfg: AppConfig) {
  if (cfg.default_shuffle_time < cfg.min_shuffle_time) {
    cfg.default_shuffle_time = cfg.min_shuffle_time;
  }
  ensureDirExists(CONFIG_PATH);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();
logger.info(`Config: ${JSON.stringify(config)} @ ${CONFIG_PATH}`);

class HistoryRandomPickerService<T> {
  private history: T[] = [];
  constructor(private items: () => T[], private cooldown = 5) {}
  pick(): T | null {
    const list = this.items();
    if (!list?.length) return null;
    const candidates = list.filter((x) => !this.history.includes(x));
    if (candidates.length === 0) { this.history = []; return this.pick(); }
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (!choice) return null;
    this.history.push(choice);
    if (this.history.length > this.cooldown) this.history.shift();
    return choice;
  }
}
const picker = new HistoryRandomPickerService<string>(() => storage.listImages(), 5);

function canShuffleNow(): { allowed: true } | { allowed: false; msRemaining: number } {
  const minMs = minutesToMs(config.min_shuffle_time);
  const last = config.last_display_at ? new Date(config.last_display_at).getTime() : 0;
  const delta = Date.now() - last;
  return delta >= minMs ? { allowed: true } : { allowed: false, msRemaining: minMs - delta };
}

async function displayRandomImage(): Promise<"ok" | "noImages" | { waitMs: number }> {
  const gate = canShuffleNow();
  if (!gate.allowed) return { waitMs: gate.msRemaining };
  const choice = picker.pick();
  if (!choice) return "noImages";

  const fullPath = storage.getFileFullPath(choice);
  await producer.produceEvent({
    type: "display_photo",
    data: { photoUrl: fullPath },
    timestamp: new Date().toISOString(),
  });

  config.last_display_at = new Date().toISOString();
  config.current_photo_url = fullPath;   
  saveConfig(config);

  logger.info(`Displayed: ${fullPath}`);
  return "ok";
}

let timer: NodeJS.Timeout | null = null;
function reschedule() {
  if (timer) clearInterval(timer);
  const every = minutesToMs(config.default_shuffle_time);
  timer = setInterval(() => { void displayRandomImage(); }, every);
  logger.info(`Interval set to ${config.default_shuffle_time} min.`);
}
// start the loop
reschedule();

logger.info("Starting image display scheduler & event consumer...");
consumeInkyMatteucciEvents(async (event) => {
  if (event.type === "set_shuffle") {
    const e = event as SetShuffleEvent;
    const requested = Math.max(e.data.minutes, config.min_shuffle_time);
    const prev = config.default_shuffle_time;
    config.default_shuffle_time = requested;
    saveConfig(config);
    if (requested !== prev) reschedule();
    logger.info(`set_shuffle: ${prev} → ${requested} min (min=${config.min_shuffle_time})`);
    return;
  }

  if (event.type === "request_next") {
    const e = event as RequestNextEvent;
    const result = await displayRandomImage();
    if (result === "ok") {
      await producer.produceEvent({
        type: "next_result",
        data: { chatId: e.data.chatId, ok: true },
        timestamp: new Date().toISOString(),
      });
    } else if (result === "noImages") {
      await producer.produceEvent({
        type: "next_result",
        data: { chatId: e.data.chatId, ok: false, noImages: true },
        timestamp: new Date().toISOString(),
      });
    } else {
      await producer.produceEvent({
        type: "next_result",
        data: { chatId: e.data.chatId, ok: false, msRemaining: result.waitMs },
        timestamp: new Date().toISOString(),
      });
    }
    return;
  }

  if (event.type === "request_current") {
    const { chatId } = event.data as { chatId: number };
    const p = config.current_photo_url;
    logger.info(`request_current: chat=${chatId} current=${p ?? "-"}`);

    if (p && fs.existsSync(p)) {
        await producer.produceEvent({
        type: "current_result",
        data: { chatId, ok: true, photoUrl: p },
        timestamp: new Date().toISOString(),
        });
    } else {
        await producer.produceEvent({
        type: "current_result",
        data: { chatId, noImages: true },
        timestamp: new Date().toISOString(),
        });
    }
    return;
  }

});

