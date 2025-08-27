// packages/telegram-bot/src/ranking.ts
import { PhotoRegistryReader } from "inky-matteucci-commons";
import { REGISTRY_FILE } from "inky-matteucci-commons/constants.js";

const reader = new PhotoRegistryReader(REGISTRY_FILE);

export function getRanking(): string {
  const photos = reader.getAllPhotos();

  const total = photos.length;

  // Foto "originali" prima del 22 agosto 2025
  const cutoff = new Date("2025-08-22T00:00:00Z");
  const originals = photos.filter((p) => {
    if (!p.addedAt) return false;
    return new Date(p.addedAt) < cutoff;
  }).length;

  // Conta per utente, ignorando Origin e Unknown
  const counts = new Map<string, number>();
  for (const p of photos) {
    const u = (p.username ?? "").trim();
    if (u === "Origin" || u === "Unknown") continue;

    const key = u || `id:${p.userId ?? "?"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Ordina e prendi top 5
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top5 = sorted.slice(0, 5);

  const lines = [
    `In totale nell'Inky sono registrate ${total} foto!`,
    `Di queste, ${originals} sono le foto originali inviate prima del Pechia 2025.`,
    "",
    "La top five (a partire dal 22 agosto 25):",
    ...top5.map(([user, n]) => `- ${user.startsWith("@") ? user : "@" + user} (${n} foto)`),
    "",
    "Grazie mille per tutte le fotine mandate :)",
  ];

  return lines.join("\n");
}
