import winston from "winston";
import { config } from "../config/index.js";

export const logger = winston.createLogger({
  level: config.nodeEnv === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "workermill-api" },
  transports: [
    new winston.transports.Console({
      format:
        config.nodeEnv === "production"
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
    }),
  ],
});
