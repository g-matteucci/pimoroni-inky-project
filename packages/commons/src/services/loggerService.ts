import winston from "winston";

export class LoggerService {
  private logger: winston.Logger;

  constructor(serviceName: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
          return `[${timestamp}] [${serviceName}] [${level}]: ${message} ${metaStr}`;
        })
      ),
      transports: [new winston.transports.Console()],
    });
  }

  info(msg: string, ...args: any[]) {
    this.logger.info(msg, ...args);
  }

  error(msg: string, ...args: any[]) {
    this.logger.error(msg, ...args);
  }

  warn(msg: string, ...args: any[]) {
    this.logger.warn(msg, ...args);
  }

  debug(msg: string, ...args: any[]) {
    this.logger.debug(msg, ...args);
  }
}
