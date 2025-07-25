import path from "path";
import { JsonDBManager } from "./jsonDbManager.js";
import { TelegramPhotoMetadata } from "../events.js";
import { storagePath } from "../constants.js";

export class TelegramPhotoMetadataDb extends JsonDBManager<TelegramPhotoMetadata> {
  constructor() {
    super(path.join(storagePath, "photo-db.json"));
  }
}

export * from "../events.js";
