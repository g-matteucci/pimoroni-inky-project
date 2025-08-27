import fs from "fs";
import path from "path";
import {
  createInkyMatteucciEventProducer,
  consumeInkyMatteucciEvents,
  ImageStorageService,
  LoggerService,
  RequestNextEvent,
  SetShuffleEvent,
  PhotoRegistryReader,
} from "inky-matteucci-commons";

/** -------------------- types -------------------- **/

type AppConfig = {
  min_shuffle_time: number;       // minuti, hard floor (persistente)
  default_shuffle_time: number;   // minuti, scheduler interval (persistente)
  disable_during_night?: boolean;
  night_time_start?: string;      // "HH:mm" (24h)
  night_time_end?: string;        // "HH:mm" (24h)
};

type CurrentMeta = {
  photoId?: string;
  photoPath?: string;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  timestamp?: string;
};

type AppState = {
  last_display_at?: string;
  current_photo_url?: string;
  current_meta?: CurrentMeta;
};

/** -------------------- Setup -------------------- **/

const logger = new LoggerService("photo-display-scheduler");
const registryReader = new PhotoRegistryReader();
const producer = createInkyMatteucciEventProducer();
const storage = new ImageStorageService();

// Config file
const CONFIG_PATH =
  process.env.CONFIG_PATH ?? path.resolve(__dirname, "../../../config.json");

// Status file temp
const STATE_PATH =
  process.env.SCHEDULER_STATE_PATH ?? path.resolve(__dirname, "../../../.runtime/scheduler-state.json");

function ensureDirExistsFor(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeFileAtomic(file: string, data: string) {
  ensureDirExistsFor(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

function isValidHM(t?: string): boolean {
  if (!t) return false;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (!m) return false;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh >= 0 && hh <= 23;
}

function clampConfig(cfg: AppConfig): AppConfig {
  let {
    min_shuffle_time,
    default_shuffle_time,
    disable_during_night,
    night_time_start,
    night_time_end,
  } = cfg;

  if (!Number.isFinite(min_shuffle_time) || min_shuffle_time <= 0) min_shuffle_time = 1;
  if (!Number.isFinite(default_shuffle_time) || default_shuffle_time <= 0) default_shuffle_time = 5;
  if (default_shuffle_time < min_shuffle_time) default_shuffle_time = min_shuffle_time;

  if (typeof disable_during_night !== "boolean") disable_during_night = false;

  if (!isValidHM(night_time_start)) night_time_start = "03:00";
  if (!isValidHM(night_time_end))   night_time_end   = "09:00";

  return {
    min_shuffle_time,
    default_shuffle_time,
    disable_during_night,
    night_time_start,
    night_time_end,
  };
}

function defaultConfig(): AppConfig {
  return {
    min_shuffle_time: 1,
    default_shuffle_time: 5,
    disable_during_night: false,
    night_time_start: "03:00",
    night_time_end: "09:00",
  };
}

function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return clampConfig({ ...defaultConfig(), ...parsed });
  } catch {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
}

function saveConfig(cfg: AppConfig) {
  const s = clampConfig(cfg);
  ensureDirExistsFor(CONFIG_PATH);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(s, null, 2));
}

function defaultState(): AppState {
  return {};
}

function loadState(): AppState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw) as AppState;
  } catch {
    // migrazione: se vecchie chiavi erano in config.json, le sposto
    try {
      const rawCfg = fs.readFileSync(CONFIG_PATH, "utf8");
      const parsed = JSON.parse(rawCfg) as any;
      const migratable: AppState = {};
      if (typeof parsed?.last_display_at === "string") migratable.last_display_at = parsed.last_display_at;
      if (typeof parsed?.current_photo_url === "string") migratable.current_photo_url = parsed.current_photo_url;
      const st = { ...defaultState(), ...migratable };
      saveState(st);
      if ("last_display_at" in parsed || "current_photo_url" in parsed) {
        delete parsed.last_display_at;
        delete parsed.current_photo_url;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(clampConfig(parsed), null, 2));
      }
      return st;
    } catch {
      const st = defaultState();
      saveState(st);
      return st;
    }
  }
}

function saveState(st: AppState) {
  writeFileAtomic(STATE_PATH, JSON.stringify(st, null, 2));
}

function parseHMToMinutes(t: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t)!;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh * 60 + mm;
}

function minutesSinceMidnight(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Is `nowMin` inside [start, end) with wrap-around support
function inWindow(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // crosses midnight
}

// Minutes left until window end (0 if we're not inside)
function minutesUntilWindowEnd(nowMin: number, startMin: number, endMin: number): number {
  if (!inWindow(nowMin, startMin, endMin)) return 0;
  if (startMin < endMin) return endMin - nowMin;
  return nowMin < endMin ? (endMin - nowMin) : (24 * 60 - nowMin) + endMin;
}

/** -------------------- Runtime status -------------------- **/

let config = loadConfig();
let state = loadState();

logger.info(`Config file: ${CONFIG_PATH} => ${JSON.stringify(config)}`);
logger.info(`State  file: ${STATE_PATH} => ${JSON.stringify(state)}`);

/** -------------------- Logic -------------------- **/

function minutesToMs(m: number) { return Math.max(0, Math.round(m * 60_000)); }

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

function canShuffleNow(
  source: "schedule" | "manual"
): { allowed: true } | { allowed: false; msRemaining: number } {
  const minMs = minutesToMs(config.min_shuffle_time);
  const last = state.last_display_at ? new Date(state.last_display_at).getTime() : 0;
  const delta = Date.now() - last;
  const msToMinGate = Math.max(0, minMs - delta);

  let msToNightEnd = 0;
  if (source === "schedule" && config.disable_during_night) {
    const nowMin = minutesSinceMidnight();
    const startMin = parseHMToMinutes(config.night_time_start!);
    const endMin   = parseHMToMinutes(config.night_time_end!);
    const minsLeft = minutesUntilWindowEnd(nowMin, startMin, endMin);
    msToNightEnd = minutesToMs(minsLeft);
  }

  const waitMs = Math.max(msToMinGate, msToNightEnd);
  return waitMs <= 0 ? { allowed: true } : { allowed: false, msRemaining: waitMs };
}

async function displayRandomImage(
  source: "schedule" | "manual"
): Promise<"ok" | "noImages" | { waitMs: number }> {
  const gate = canShuffleNow(source);
  if (!gate.allowed) return { waitMs: gate.msRemaining };

  const choice = picker.pick();
  if (!choice) return "noImages";

  const fullPath = storage.getFileFullPath(choice);
  const photoId = choice.endsWith(".jpg") ? choice.slice(0, -4) : choice;

  // Meta corrente dal registry (fallback Unknown)
  let current_meta: CurrentMeta | undefined;
  try {
    const rec = registryReader.getByPhotoId(photoId) ?? registryReader.getByPath(fullPath);
    if (rec) {
      current_meta = {
        photoId: rec.photoId,
        photoPath: rec.storage?.path ?? fullPath,
        userId: rec.telegram?.userId,
        username: rec.telegram?.username,
        firstName: rec.telegram?.firstName,
        lastName: rec.telegram?.lastName,
        timestamp: rec.telegram?.timestamp,
      };
    } else {
      current_meta = {
        photoId,
        photoPath: fullPath,
        username: "Unknown",
        firstName: "-",
        lastName: "-",
      };
    }
  } catch {
    // se fallisce, lasciamo undefined
  }

  // Notifica al consumer (render)
  await producer.produceEvent({
    type: "display_photo",
    data: { photoUrl: fullPath },
    timestamp: new Date().toISOString(),
  });

  // Aggiorna lo state
  state.last_display_at = new Date().toISOString();
  state.current_photo_url = fullPath;
  state.current_meta = current_meta;
  saveState(state);

  logger.info(`Displayed: ${fullPath}`);
  return "ok";
}

/** -------------------- Scheduling -------------------- **/

let timer: NodeJS.Timeout | null = null;
let wakeTimeout: NodeJS.Timeout | null = null;

function reschedule() {
  if (timer) clearInterval(timer);
  if (wakeTimeout) clearTimeout(wakeTimeout);

  const every = minutesToMs(config.default_shuffle_time);
  let firstDelay = every;

  if (config.disable_during_night) {
    const nowMin = minutesSinceMidnight();
    const startMin = parseHMToMinutes(config.night_time_start!);
    const endMin   = parseHMToMinutes(config.night_time_end!);
    const minsLeft = minutesUntilWindowEnd(nowMin, startMin, endMin);
    if (minsLeft > 0) {
      firstDelay = minutesToMs(minsLeft);
      logger.info(`Night pause active. Next automatic switch in ${Math.ceil(firstDelay/60000)} min.`);
    }
  }

  wakeTimeout = setTimeout(() => {
    void displayRandomImage("schedule");
    timer = setInterval(() => { void displayRandomImage("schedule"); }, every);
  }, firstDelay);

  logger.info(`Interval set to ${config.default_shuffle_time} min. First tick in ${Math.ceil(firstDelay/60000)} min.`);
}

// start the loop
reschedule();

/** -------------------- Event consumer -------------------- **/

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
    const result = await displayRandomImage("manual"); // manual: ignora la notte
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
    const p = state.current_photo_url;
    logger.info(`request_current: chat=${chatId} current=${p ?? "-"}`);

    if (p && fs.existsSync(p)) {
      // Prepara meta da inviare (preferisci lo state, altrimenti ricava ora)
      let meta:
        | { photoId?: string; username?: string; firstName?: string; lastName?: string; timestamp?: string }
        | undefined = state.current_meta;

      if (!meta) {
        try {
          const base = p.toLowerCase().endsWith(".jpg") ? p.slice(0, -4) : p;
          const basename = base.split(/[\\/]/).pop()!;
          const rec = registryReader.getByPath(p) || registryReader.getByPhotoId(basename);
          if (rec) {
            meta = {
              photoId: rec.photoId,
              username: rec.telegram?.username,
              firstName: rec.telegram?.firstName,
              lastName: rec.telegram?.lastName,
              timestamp: rec.telegram?.timestamp,
            };
          } else {
            meta = { photoId: basename, username: "Unknown" };
          }
        } catch { /* ignore */ }
      }

      await producer.produceEvent({
        type: "current_result",
        data: { chatId, ok: true, photoUrl: p, meta },
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
