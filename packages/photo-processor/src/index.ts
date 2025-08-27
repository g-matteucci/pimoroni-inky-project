// packages/photo-processor/src/index.ts
import fs from "fs";
import sharp from "sharp";
import { match } from "ts-pattern";
import {
  consumeInkyMatteucciEvents,
  ImageStorageService,
  LoggerService,
  PhotoRegistryService,
} from "inky-matteucci-commons";

const logger = new LoggerService("photo-processor");
const imageStorageService = new ImageStorageService();
const registry = new PhotoRegistryService();

// ---- Helper: render compromesso 800x480 ----
async function renderForInkyCompromise(
  srcBuffer: Buffer,
  opts?: { bg?: { r: number; g: number; b: number }; quality?: number }
): Promise<Buffer> {
  const TARGET_W = 800;
  const TARGET_H = 480;
  const QUALITY = opts?.quality ?? 80;
  const BG = opts?.bg ?? { r: 255, g: 255, b: 255 };

  const meta = await sharp(srcBuffer).metadata();
  const w = meta.width ?? TARGET_W;
  const h = meta.height ?? TARGET_H;
  if (w <= 0 || h <= 0) {
    // fallback robusto: contain
    return sharp(srcBuffer)
      .resize({ width: TARGET_W, height: TARGET_H, fit: "contain", background: { ...BG, alpha: 1 }, withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer();
  }

  const scaleContain = Math.min(TARGET_W / w, TARGET_H / h);
  const scaledW = Math.floor(w * scaleContain);
  const scaledH = Math.floor(h * scaleContain);
  const padX = Math.max(0, TARGET_W - scaledW);
  const padY = Math.max(0, TARGET_H - scaledH);
  const padRatio = Math.max(padX / TARGET_W, padY / TARGET_H); // quota della dimensione coperta da barre

  // Soglie regolabili
  const SMALL_BAR = 0.10; // ≤10% ⇒ contain
  const BIG_BAR   = 0.30; // ≥30% ⇒ cover

  if (padRatio <= SMALL_BAR) {
    // Barre piccole: mostriamo tutto, padding minimo
    return sharp(srcBuffer)
      .resize({ width: TARGET_W, height: TARGET_H, fit: "contain", background: { ...BG, alpha: 1 }, withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer();
  }

  if (padRatio >= BIG_BAR) {
    // Barre enormi: meglio riempire con taglio (crop), ma poco "intelligente"
    return sharp(srcBuffer)
      .resize({ width: TARGET_W, height: TARGET_H, fit: "cover", position: "attention", withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer();
  }

  // Compromesso: riduci le barre sotto ~10% senza arrivare al crop pieno
  const targetRatio = TARGET_W / TARGET_H; // ~1.666...
  const ratio = w / h;
  const desiredMaxPad = SMALL_BAR; // vogliamo ~≤10% barra max

  // Calcola uno scale "over-zoom" limitato tra contain e cover
  let s = scaleContain;
  if (ratio < targetRatio) {
    // Immagine più "stretta" → barre verticali a sinistra/destra.
    // Servono più px in larghezza: newW = h*s*ratio >= TARGET_W*(1 - desiredMaxPad)
    const minW = TARGET_W * (1 - desiredMaxPad);
    const sForMinW = minW / (h * ratio);
    const coverScale = TARGET_H / h; // upper bound (equivale a cover)
    s = Math.min(coverScale, Math.max(scaleContain, sForMinW));
  } else {
    // Immagine più "larga" → barre orizzontali sopra/sotto.
    // Serve più altezza: newH = h*s >= TARGET_H*(1 - desiredMaxPad)
    const minH = TARGET_H * (1 - desiredMaxPad);
    const sForMinH = minH / h;
    const coverScale = TARGET_W / w; // upper bound
    s = Math.min(coverScale, Math.max(scaleContain, sForMinH));
  }

  // Ridimensiona con 'inside' (niente taglio), poi centriamo su canvas 800x480
  const resized = await sharp(srcBuffer)
    .resize({
      width: Math.round(w * s),
      height: Math.round(h * s),
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  return sharp({
    create: {
      width: TARGET_W,
      height: TARGET_H,
      channels: 3,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .jpeg({ quality: QUALITY })
    .toBuffer();
}

logger.info("Starting image manager consumer...");

consumeInkyMatteucciEvents((event) => {
  match(event)
    .with({ type: "added_photo" }, async (e) => {
      const { photoId, photoUrl, chatId, userId, username, firstName, lastName, timestamp } = e.data;
      logger.info(`Adding photo: ${photoId}`);

      try {
        const resp = await fetch(photoUrl);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} while fetching ${photoUrl}`);
        }

        const srcBuffer = Buffer.from(await resp.arrayBuffer());

        // ✨ Usa il renderer “compromesso”
        const optimizedImage = await renderForInkyCompromise(srcBuffer, {
          bg: { r: 255, g: 255, b: 255 }, // sfondo bianco per barre
          quality: 50,
        });

        // Salva su disco
        imageStorageService.saveImage(photoId, optimizedImage);
        const absPath = imageStorageService.getFileFullPath(photoId);
        const st = fs.statSync(absPath);

        // Append nel registro JSONL (writer unico)
        registry.appendPhoto({
          basename: photoId, // es. "AgAC..."
          absPath,
          bytes: st.size,
          telegram: {
            chatId,
            userId,
            username,
            firstName,
            lastName,
            timestamp, // ISO dal bot
          },
          // addedAtIso: default = now
        });

        logger.info(`Photo saved & registered: ${photoId}`);
      } catch (err) {
        logger.error(`Failed to add ${photoId}: ${(err as Error).message}`);
      }
    })
    .with({ type: "removed_photo" }, (e) => {
      const { photoId } = e.data;
      logger.info(`Removing photo: ${photoId}`);

      try {
        imageStorageService.deleteImage(photoId);

        // Tombstone nel registro
        registry.appendTombstone(photoId);

        logger.info(`Photo deleted & tombstoned: ${photoId}`);
      } catch (err) {
        logger.error(`Failed to remove ${photoId}: ${(err as Error).message}`);
      }
    })
    // Eventi non di interesse per questo servizio
    .with({ type: "display_photo" }, () => {})
    .exhaustive();
});
