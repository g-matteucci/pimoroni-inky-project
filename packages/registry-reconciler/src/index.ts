// packages/registry-reconciler/src/index.ts
import { LoggerService, PhotoRegistryService } from "inky-matteucci-commons";

const logger = new LoggerService("registry-reconciler");
const registry = new PhotoRegistryService();

async function runOnce() {
  const { added, tombstoned } = registry.reconcile();
  logger.info(`Reconcile done. Added=${added}, Tombstoned=${tombstoned}`);
}

function msUntil(hour: number, minute: number) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function main() {
  // 1) esegui subito al boot
  await runOnce();

  // 2) poi ogni giorno alle 03:30
  const firstDelay = msUntil(3, 30);
  setTimeout(() => {
    void runOnce();
    setInterval(() => void runOnce(), 24 * 60 * 60 * 1000);
  }, firstDelay);

  logger.info("Registry reconciler started. Next run in ~" + Math.ceil(firstDelay / 60000) + " min.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
