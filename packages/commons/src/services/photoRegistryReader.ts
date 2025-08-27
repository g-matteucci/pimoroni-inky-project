// packages/commons/src/services/photoRegistryReader.ts
import fs from "fs";
import path from "path";
import { REGISTRY_FILE } from "../constants.js";
import type { PhotoRecord } from "./photoRegistryService.js";

type AnyRecord = PhotoRecord | { kind: "tombstone"; photoId: string; deletedAt: string };

function parseJsonl(file: string): AnyRecord[] {
  if (!fs.existsSync(file)) return [];
  const out: AnyRecord[] = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && (obj.kind === "photo" || obj.kind === "tombstone")) out.push(obj);
    } catch { /* ignore */ }
  }
  return out;
}

export class PhotoRegistryReader {
  private idxById = new Map<string, PhotoRecord>();
  private idxByPath = new Map<string, PhotoRecord>();
  private lastMtimeMs = -1;

  constructor(private registryFile = REGISTRY_FILE) {}

  private reloadIfNeeded() {
    const st = fs.existsSync(this.registryFile) ? fs.statSync(this.registryFile) : null;
    const mtime = st ? st.mtimeMs : -1;
    if (mtime === this.lastMtimeMs) return;

    this.idxById.clear();
    this.idxByPath.clear();
    const records = parseJsonl(this.registryFile);

    // calcola "alive": l’ultimo evento per photoId vince
    const bucket = new Map<string, AnyRecord[]>();
    for (const r of records) {
      const k = (r as any).photoId;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k)!.push(r);
    }
    for (const [k, arr] of bucket) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const r = arr[i];
        if (r.kind === "photo") {
          this.idxById.set(k, r);
          if (r.storage?.path) this.idxByPath.set(path.resolve(r.storage.path), r);
          break;
        }
        if (r.kind === "tombstone") break; // morto
      }
    }

    this.lastMtimeMs = mtime;
  }

  getByPhotoId(id: string): PhotoRecord | undefined {
    this.reloadIfNeeded();
    return this.idxById.get(id);
  }

  getByPath(absPath: string): PhotoRecord | undefined {
    this.reloadIfNeeded();
    return this.idxByPath.get(path.resolve(absPath));
  }
}
