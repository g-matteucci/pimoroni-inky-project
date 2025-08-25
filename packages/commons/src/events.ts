import { Redis } from "ioredis";
import z from "zod";
import { INKY_MATTEUCCI_EVENTS_QUEUE_NAME } from "./constants.js";

// Metadata attached to each photo uploaded from Telegram
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

// Event produced when a new photo is added
export const AddedPhotoEvent = z.object({
  type: z.literal("added_photo"),
  data: TelegramPhotoMetadata,
  timestamp: z.string(),
});
export type AddedPhotoEvent = z.infer<typeof AddedPhotoEvent>;

// Event produced when a photo is removed
export const RemovedPhotoEvent = z.object({
  type: z.literal("removed_photo"),
  data: z.object({ photoId: z.string() }),
  timestamp: z.string(),
});
export type RemovedPhotoEvent = z.infer<typeof RemovedPhotoEvent>;

// Event produced when a photo should be displayed on the device
export const DisplayPhotoEvent = z.object({
  type: z.literal("display_photo"),
  data: z.object({ photoUrl: z.string() }),
  timestamp: z.string(),
});
export type DisplayPhotoEvent = z.infer<typeof DisplayPhotoEvent>;

// Bot → Scheduler: request to set shuffle interval (in minutes).
// Scheduler clamps the value to ≥ min_shuffle_time and saves it in config.json.
export const SetShuffleEvent = z.object({
  type: z.literal("set_shuffle"),
  data: z.object({
    minutes: z.number().positive(),
    requestedBy: z.number().optional(),
    chatId: z.number().optional(),
  }),
  timestamp: z.string(),
});
export type SetShuffleEvent = z.infer<typeof SetShuffleEvent>;

// Bot → Scheduler: request to immediately switch to next photo.
// Must still respect min_shuffle_time. Includes chatId so scheduler can respond.
export const RequestNextEvent = z.object({
  type: z.literal("request_next"),
  data: z.object({
    chatId: z.number(),
    requestedBy: z.number(),
  }),
  timestamp: z.string(),
});
export type RequestNextEvent = z.infer<typeof RequestNextEvent>;

// Scheduler → Bot: result of a /next request.
// Informs whether the switch was successful, too early (msRemaining), or no images available.
export const NextResultEvent = z.object({
  type: z.literal("next_result"),
  data: z.object({
    chatId: z.number(),
    ok: z.boolean(),
    msRemaining: z.number().optional(),
    noImages: z.boolean().optional(),
  }),
  timestamp: z.string(),
});
export type NextResultEvent = z.infer<typeof NextResultEvent>;

/* --- Updated event union --- */
export const InkyMatteucciEvent = z.discriminatedUnion("type", [
  AddedPhotoEvent,
  RemovedPhotoEvent,
  DisplayPhotoEvent,
  SetShuffleEvent,
  RequestNextEvent,
  NextResultEvent,
]);
export type InkyMatteucciEvent = z.infer<typeof InkyMatteucciEvent>;

/* --- Serialization helpers --- */
function serializeEvent(event: InkyMatteucciEvent): string {
  return JSON.stringify(event);
}
function deserializeEvent(data: string): InkyMatteucciEvent {
  return InkyMatteucciEvent.parse(JSON.parse(data));
}

/* --- Consumer: subscribe to Redis and pass events to a handler --- */
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

/* --- Producer: publish events to the Redis channel --- */
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

