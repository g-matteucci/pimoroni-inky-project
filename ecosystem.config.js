module.exports = {
  apps: [
    {
      name: "inky-frame-consumer",
      cwd: "./packages/inky-frame-consumer/src",
      script: "index.ts",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
    {
      name: "photo-display-scheduler",
      cwd: "./packages/photo-display-scheduler/src",
      script: "index.ts",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
    {
      name: "photo-processor",
      cwd: "./packages/photo-processor/src",
      script: "index.ts",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
    {
      name: "telegram-bot",
      cwd: "./packages/telegram-bot/src",
      script: "index.ts",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
	TELEGRAM_USERS_WHITELIST: process.env.TELEGRAM_USERS_WHITELIST,
      },
    },
    {
    name: "registry-reconciler",
    cwd: "./packages/registry-reconciler",
    script: "src/index.ts",
    interpreter: "bun",
    env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
    },
    },
  ],
};
