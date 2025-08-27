// packages/commons/src/services/photoRegistryService.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { REGISTRY_FILE, LOCAL_PHOTOS_PATH } from "../constants.js";

type TelegramLike = {
  id: string;        // nostro id logico; per ora usiamo lo stesso dello storage (basename)
  chatId: number;
  photoId: string;   // id Telegram se noto (altrimenti = basename)
  photoUrl: string;  // url o path
  userId: number;
  username: string;
  firstName: string;
  lastName: string;
  timestamp: string; // ISO
};

export type PhotoRecord = {
  kind: "photo";
  photoId: string;    // chiave logica = basename del file (senza .jpg)
  addedAt: string;    // ISO
  telegram: TelegramLike;
  storage: { path: string; bytes?: number };
};

export type TombstoneRecord = {
  kind: "tombstone";
  photoId: string;    // stessa chiave logica del file rimosso
  deletedAt: string;  // ISO
};

type AnyRecord = PhotoRecord | TombstoneRecord;

function ensureDirOf(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonl(file: string): AnyRecord[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const out: AnyRecord[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && (obj.kind === "photo" || obj.kind === "tombstone")) {
        out.push(obj);
      }
    } catch { /* ignore bad line */ }
  }
  return out;
}

function writeJsonlAppend(file: string, record: AnyRecord) {
  ensureDirOf(file);
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

function stripExtJpg(file: string) {
  return file.endsWith(".jpg") ? file.slice(0, -4) : file;
}

export class PhotoRegistryService {
  constructor(
    private registryFile = REGISTRY_FILE,
    private photosDir = LOCAL_PHOTOS_PATH
  ) {}

  /** Aggiunge un record "photo" (append-only). */
  appendPhoto(params: {
    basename: string;      // "AgAC..."; senza .jpg o con, è indifferente
    absPath: string;       // path assoluto salvato
    bytes?: number;
    telegram: Omit<TelegramLike, "id" | "photoId" | "photoUrl"> & {
      id?: string;
      photoId?: string;
      photoUrl?: string;
    };
    addedAtIso?: string;   // opzionale, altrimenti now
  }): void {
    const base = stripExtJpg(params.basename);
    const rec: PhotoRecord = {
      kind: "photo",
      photoId: base,
      addedAt: params.addedAtIso ?? nowIso(),
      telegram: {
        id: params.telegram.id ?? base,
        chatId: params.telegram.chatId,
        photoId: params.telegram.photoId ?? base,
        photoUrl: params.telegram.photoUrl ?? params.absPath,
        userId: params.telegram.userId,
        username: params.telegram.username,
        firstName: params.telegram.firstName,
        lastName: params.telegram.lastName,
        timestamp: params.telegram.timestamp,
      },
      storage: { path: params.absPath, bytes: params.bytes },
    };
    writeJsonlAppend(this.registryFile, rec);
  }

  /** Aggiunge una tombstone per un file mancante (append-only). */
  appendTombstone(photoId: string, deletedAtIso?: string): void {
    const rec: TombstoneRecord = {
      kind: "tombstone",
      photoId: stripExtJpg(photoId),
      deletedAt: deletedAtIso ?? nowIso(),
    };
    writeJsonlAppend(this.registryFile, rec);
  }

  /** Legge lo stato "vivo": ultimo record per photoId vince. */
  readAliveIndex(): {
    aliveById: Map<string, PhotoRecord>;
    allById: Map<string, AnyRecord[]>;
  } {
    const records = parseJsonl(this.registryFile);
    const allById = new Map<string, AnyRecord[]>();
    for (const r of records) {
      const k = r.kind === "photo" ? r.photoId : r.photoId;
      if (!allById.has(k)) allById.set(k, []);
      allById.get(k)!.push(r);
    }
    const aliveById = new Map<string, PhotoRecord>();
    for (const [k, arr] of allById.entries()) {
      // ultimo evento vince
      for (let i = arr.length - 1; i >= 0; i--) {
        const r = arr[i];
        if (r.kind === "photo") { aliveById.set(k, r); break; }
        if (r.kind === "tombstone") { aliveById.delete(k); break; }
      }
    }
    return { aliveById, allById };
  }

  /** Riconcilia fisico vs registro. Regola: VINCONO I FILE. */
  reconcile(): { added: number; tombstoned: number } {
    const { aliveById } = this.readAliveIndex();

    // set file fisici (solo .jpg)
    const files = fs.readdirSync(this.photosDir).filter(f => f.endsWith(".jpg"));
    const physicalIds = new Set(files.map(stripExtJpg));

    // 1) file mancanti sul disco → tombstone
    let tombstoned = 0;
    for (const k of aliveById.keys()) {
      if (!physicalIds.has(k)) {
        this.appendTombstone(k);
        tombstoned++;
      }
    }

    // 2) file presenti sul disco ma non nel registro → aggiungi con "Unknown"
    let added = 0;
    for (const f of files) {
      const k = stripExtJpg(f);
      if (aliveById.has(k)) continue;
      const abs = path.join(this.photosDir, f);
      const st = fs.statSync(abs);
      const mtimeIso = new Date(st.mtimeMs).toISOString();
      this.appendPhoto({
        basename: k,
        absPath: abs,
        bytes: st.size,
        telegram: {
          chatId: 0,
          userId: 0,
          username: "Unknown",
          firstName: "-",
          lastName: "-",
          timestamp: mtimeIso,
        },
        addedAtIso: mtimeIso,
      });
      added++;
    }

    return { added, tombstoned };
  }
}
