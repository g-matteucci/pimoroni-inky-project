import { consumeInkyMatteucciEvents, LoggerService } from "inky-matteucci-commons";
import { match } from "ts-pattern";
import { spawnSync } from "child_process";
import os from "os";

const logger = new LoggerService("inky-frame-consumer");

logger.info("Starting frame display consumer...");

consumeInkyMatteucciEvents((event) => {
  match(event)
    .with({ type: "display_photo" }, (e) => {
      logger.info("Displaying photo:", e.data.photoUrl);
      spawnSync("python", [`${os.homedir()}/Pimoroni/inky/examples/spectra6/image.py`, "--file", e.data.photoUrl], {
        stdio: "inherit",
      });
    })
    // Do nothing
    .with({ type: "added_photo" }, (e) => {})
    .with({ type: "removed_photo" }, (e) => {})
    .exhaustive();
});
