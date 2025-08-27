// packages/bot/src/ranking.ts
import { PhotoRegistryReader, REGISTRY_FILE } from "inky-matteucci-commons";
import type { Telegraf } from "telegraf";

const reader = new PhotoRegistryReader(REGISTRY_FILE);

const nameCache = new Map<number, string>();

async function resolveDisplayName(
  telegram: Telegraf['telegram'],
  userId: number,
  fallback: { username?: string; firstName?: string; lastName?: string }
): Promise<string> {
  if (nameCache.has(userId)) return nameCache.get(userId)!;

  try {
    const chat: any = await telegram.getChat(userId);
    if (chat?.username) {
      const uname = chat.username.startsWith("@") ? chat.username : `@${chat.username}`;
      nameCache.set(userId, uname);
      return uname;
    }
    const fullname = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ").trim();
    if (fullname) {
      nameCache.set(userId, fullname);
      return fullname;
    }
  } catch {
    // ignore errors, fallback
  }

  if (fallback.username) {
    const uname = fallback.username.startsWith("@") ? fallback.username : `@${fallback.username}`;
    nameCache.set(userId, uname);
    return uname;
  }
  const fullname = [fallback.firstName, fallback.lastName].filter(Boolean).join(" ").trim();
  if (fullname) {
    nameCache.set(userId, fullname);
    return fullname;
  }

  const generic = `utente ${userId}`;
  nameCache.set(userId, generic);
  return generic;
}

export async function getRanking(telegram: Telegraf['telegram']): Promise<string> {
  const photos = reader.getAllPhotos();
  const total = photos.length;

  const cutoff = new Date("2025-08-22T00:00:00Z");
  const originals = photos.filter((p) => p.addedAt && new Date(p.addedAt) < cutoff).length;

  // conta per userId leggendo da p.telegram
  const counts = new Map<number, { n: number; username?: string; firstName?: string; lastName?: string }>();
  for (const p of photos) {
    const t = (p as any).telegram;
    if (!t) continue;
    if (t.username === "Origin" || t.username === "Unknown") continue;

    const id = t.userId;
    if (!id) continue;

    if (!counts.has(id)) {
      counts.set(id, {
        n: 0,
        username: t.username,
        firstName: t.firstName,
        lastName: t.lastName,
      });
    }
    counts.get(id)!.n++;
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const top5 = sorted.slice(0, 5);

  const linesTop: string[] = [];
  for (const [uid, data] of top5) {
    const displayName = await resolveDisplayName(telegram, uid, {
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
    });
    linesTop.push(`- ${displayName} (${data.n} foto)`);
  }

  const lines = [
    `In totale nell'Inky sono registrate ${total} foto!`,
    `Di queste, ${originals} sono le foto originali inviate prima del Pechia 2025.`,
    "",
    "La top five (a partire dal 22 agosto 25):",
    ...linesTop,
    "",
    "Grazie mille per tutte le fotine mandate :)",
  ];

  return lines.join("\n");
}
