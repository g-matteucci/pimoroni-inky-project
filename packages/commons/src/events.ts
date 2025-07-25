import { Redis } from "ioredis";
import z from "zod";
import { INKY_MATTEUCCI_EVENTS_QUEUE_NAME } from "./constants.js";

export const TelegramPhotoMetadata = z.object({
  id: z.string(),
  chatId: z.number(),
  photoId: z.string(),
  photoUrl: z.string(),
  userId: z.number(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  timestamp: z.string(),
});

export type TelegramPhotoMetadata = z.infer<typeof TelegramPhotoMetadata>;

export const AddedPhotoEvent = z.object({
  type: z.literal("added_photo"),
  data: TelegramPhotoMetadata,
  timestamp: z.string(),
});
export type AddedPhotoEvent = z.infer<typeof AddedPhotoEvent>;

export const RemovedPhotoEvent = z.object({
  type: z.literal("removed_photo"),
  data: z.object({
    photoId: z.string(),
  }),
  timestamp: z.string(),
});
export type RemovedPhotoEvent = z.infer<typeof RemovedPhotoEvent>;

export const DisplayPhotoEvent = z.object({
  type: z.literal("display_photo"),
  data: z.object({
    photoUrl: z.string(),
  }),
  timestamp: z.string(),
});
export type DisplayPhotoEvent = z.infer<typeof DisplayPhotoEvent>;

export const InkyMatteucciEvent = z.discriminatedUnion("type", [AddedPhotoEvent, RemovedPhotoEvent, DisplayPhotoEvent]);
export type InkyMatteucciEvent = z.infer<typeof InkyMatteucciEvent>;

function serializeEvent(event: InkyMatteucciEvent): string {
  return JSON.stringify(event);
}

function deserializeEvent(data: string): InkyMatteucciEvent {
  return InkyMatteucciEvent.parse(JSON.parse(data));
}

export async function consumeInkyMatteucciEvents(
  handler: (event: InkyMatteucciEvent) => Promise<void> | void
): Promise<void> {
  const redis = new Redis();
  redis.subscribe(INKY_MATTEUCCI_EVENTS_QUEUE_NAME);

  redis.on("message", async (_, message) => {
    const event = deserializeEvent(message);
    await handler(event);
  });
}

export function createInkyMatteucciEventProducer(): {
  produceEvent: (event: InkyMatteucciEvent) => Promise<void>;
} {
  const redis = new Redis();
  return {
    produceEvent: async (event: InkyMatteucciEvent): Promise<void> => {
      const serializedEvent = serializeEvent(event);
      await redis.publish(INKY_MATTEUCCI_EVENTS_QUEUE_NAME, serializedEvent);
    },
  };
}
