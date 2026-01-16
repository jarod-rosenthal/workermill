import winston from "winston";
import { config } from "../config/index.js";

/**
 * Fields that contain sensitive data and should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  "password",
  "apikey",
  "api_key",
  "apitoken",
  "api_token",
  "token",
  "secret",
  "authorization",
  "credential",
  "private_key",
  "privatekey",
  "access_token",
  "refresh_token",
  "bearer",
];

/**
 * Recursively sanitize an object by redacting sensitive fields
 * @param obj - Object to sanitize
 * @param depth - Current recursion depth (prevents infinite recursion)
 * @returns Sanitized copy of the object
 */
export function sanitizeForLogging(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) return "[MAX_DEPTH]";

  // Handle null/undefined
  if (obj === null || obj === undefined) return obj;

  // Handle primitives
  if (typeof obj !== "object") return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLogging(item, depth + 1));
  }

  // Handle objects
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    // Check if key contains any sensitive field name
    const isSensitive = SENSITIVE_FIELDS.some((field) =>
      keyLower.includes(field)
    );
    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeForLogging(value, depth + 1);
    }
  }
  return sanitized;
}

/**
 * Winston format transformer that redacts sensitive fields from log metadata
 */
const redactSensitiveFields = winston.format((info) => {
  // Sanitize all properties except standard Winston fields
  const standardFields = ["level", "message", "timestamp", "service"];
  for (const key of Object.keys(info)) {
    if (!standardFields.includes(key)) {
      info[key] = sanitizeForLogging(info[key]);
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: config.nodeEnv === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    redactSensitiveFields(),
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
