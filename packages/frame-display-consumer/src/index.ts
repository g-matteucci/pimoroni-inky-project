import Redis from "ioredis";
const redis = new Redis();

async function consume(queue: string) {
  while (true) {
    // blpop attende finché non c'è un messaggio
    const result = await redis.blpop(queue, 0);
    if (!result) {
      console.log("No messages in the queue. Waiting...");
      continue;
    }

    const [queueName, message] = result;
    console.log(`Received from ${queueName}: ${message}`);
    // processa il messaggio...
  }
}

consume("image-queue");
