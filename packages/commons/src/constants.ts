import path from "path";

export const INKY_MATTEUCCI_EVENTS_QUEUE_NAME = "inky-matteucci-queue";

// Radice dei dati locali
export const LOCAL_STORAGE_PATH = path.resolve(__dirname, "../../../.inky-matteucci-data");

// Cartella immagini
export const LOCAL_PHOTOS_PATH = path.join(LOCAL_STORAGE_PATH, "photos");

// Registro metadati
export const REGISTRY_FILE = path.join(LOCAL_STORAGE_PATH, "photos.jsonl");
