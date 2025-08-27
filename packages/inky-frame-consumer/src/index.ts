import { consumeInkyMatteucciEvents, LoggerService } from "inky-matteucci-commons";
import { match } from "ts-pattern";
import { spawnSync } from "child_process";
import os from "os";

const logger = new LoggerService("inky-frame-consumer");

logger.info("Starting frame display consumer...");

consumeInkyMatteucciEvents(async (event) => {
  try {
    await match(event)
      .with({ type: "display_photo" }, (e) => {
        logger.info(`Displaying photo: ${e.data.photoUrl}`);
        const script = `${os.homedir()}/Pimoroni/inky/examples/spectra6/image.py`;
        const res = spawnSync("python", [script, "--file", e.data.photoUrl], {
          stdio: "inherit",
        });
        if (res.error) {
          logger.error(`Spawn error: ${res.error.message}`);
        }
        if (typeof res.status === "number" && res.status !== 0) {
          logger.error(`Python exited with code ${res.status}`);
        }
      })
      // eventi non pertinenti per questo consumer: li ignoriamo
      .otherwise(() => {});
  } catch (err) {
    logger.error(`Consumer error: ${(err as Error).message}`);
  }
});
