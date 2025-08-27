// inky-frame-consumer.ts
import { consumeInkyMatteucciEvents, LoggerService } from "inky-matteucci-commons";
import { match } from "ts-pattern";
import { spawn } from "child_process";
import os from "os";

const logger = new LoggerService("inky-frame-consumer");
logger.info("Starting frame display consumer...");

type Job = { photoUrl: string };
const queue: Job[] = [];
let running = false;

function runNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;

  const script = `${os.homedir()}/Pimoroni/inky/examples/spectra6/image.py`;
  const child = spawn("python", [script, "--file", job.photoUrl], { stdio: "inherit" });

  child.on("error", (err) => logger.error(`Spawn error: ${err.message}`));
  child.on("close", (code) => {
    if (typeof code === "number" && code !== 0) {
      logger.error(`Python exited with code ${code}`);
    }
    running = false;
    runNext();
  });
}

process.on("uncaughtException", (e) => logger.error(`uncaughtException: ${e.message}`));
process.on("unhandledRejection", (e: any) => logger.error(`unhandledRejection: ${e?.message ?? e}`));

consumeInkyMatteucciEvents(async (event) => {
  try {
    await match(event)
      .with({ type: "display_photo" }, (e) => {
        const url = e?.data?.photoUrl;
        if (!url) {
          logger.warn("display_photo event senza photoUrl: ignoro");
          return;
        }
        logger.info(`Queue display: ${url}`);
        queue.push({ photoUrl: url });
        runNext();
      })
      .otherwise(() => {});
  } catch (err) {
    logger.error(`Consumer error: ${(err as Error).message}`);
  }
});
