import { consumeInkyMatteucciEvents, LoggerService } from "inky-matteucci-commons";
import { match } from "ts-pattern";

const logger = new LoggerService("inky-frame-consumer");

logger.info("Starting frame display consumer...");

consumeInkyMatteucciEvents((event) => {
  match(event)
    .with({ type: "display_photo" }, (e) => {
      logger.info("Displaying photo:", e.data.photoUrl);
    })
    // Do nothing
    .with({ type: "added_photo" }, (e) => {})
    .with({ type: "removed_photo" }, (e) => {})
    .exhaustive();
});
