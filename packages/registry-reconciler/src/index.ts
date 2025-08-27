import { LoggerService, PhotoRegistryService } from "inky-matteucci-commons";

const logger = new LoggerService("registry-reconciler");
const registry = new PhotoRegistryService();

/** Config oraria via env (ora/minuto locali del sistema) */
const DAILY_HOUR = Number(process.env.RECONCILER_DAILY_HOUR ?? 3);     // default 03
const DAILY_MIN  = Number(process.env.RECONCILER_DAILY_MINUTE ?? 30);  // default :30

let running = false;

async function runOnce(label = "manual") {
  if (running) {
    logger.info(`Skip reconcile (already running) [${label}]`);
    return;
  }
  running = true;
  const start = Date.now();
  try {
    logger.info(`Reconcile start [${label}]…`);
    const { added, tombstoned } = registry.reconcile();
    const ms = Date.now() - start;
    logger.info(`Reconcile done in ${ms}ms. Added=${added}, Tombstoned=${tombstoned}`);
  } catch (e) {
    logger.error(`Reconcile failed: ${(e as Error).message}`);
  } finally {
    running = false;
  }
}

/** millisecondi fino alla prossima occorrenza di HH:MM oggi/domani */
function msUntil(hour: number, minute: number) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function main() {
  // 1) Esegui subito al boot
  await runOnce("boot");

  // 2) Pianifica la successiva run all'ora desiderata, poi ogni 24h
  const firstDelay = msUntil(DAILY_HOUR, DAILY_MIN);
  logger.info(
    `Registry reconciler armed: next run at ~${DAILY_HOUR.toString().padStart(2, "0")}:${DAILY_MIN
      .toString()
      .padStart(2, "0")} (in ${Math.ceil(firstDelay / 60000)} min).`
  );

  setTimeout(() => {
    void runOnce("daily");
    setInterval(() => void runOnce("daily"), 24 * 60 * 60 * 1000);
  }, firstDelay);

  // opzionale: trigger manuale via SIGUSR2
  process.on("SIGUSR2", () => void runOnce("signal:SIGUSR2"));
}

// graceful shutdown
function setupSignals() {
  const stop = (sig: string) => {
    logger.info(`Stopping on ${sig}…`);
    // nessun cleanup speciale: esce dopo eventuale run in corso
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

setupSignals();
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
