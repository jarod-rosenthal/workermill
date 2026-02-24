/**
 * AES-256-GCM encryption utility for encrypting sensitive fields at rest.
 *
 * Uses a 32-byte hex key from the ENCRYPTION_KEY environment variable.
 * Encrypted values are stored as "iv:authTag:ciphertext" (all base64-encoded).
 *
 * If ENCRYPTION_KEY is not set, operates in no-op mode (plaintext pass-through)
 * with a startup warning. This allows existing deployments to keep working
 * until the key is configured.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Regex to detect the encrypted format: three base64 segments separated by colons.
 * Base64 charset: A-Za-z0-9+/=
 */
const ENCRYPTED_FORMAT_REGEX = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

let encryptionKey: Buffer | null = null;
let noOpMode = false;

/**
 * Initialize the encryption module. Called once at startup.
 * Reads ENCRYPTION_KEY from environment and validates it.
 */
export function initializeEncryption(): void {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Encryption] FATAL: ENCRYPTION_KEY is required in production. " +
          "Set ENCRYPTION_KEY to a 64-character hex string (32 bytes) to enable encryption at rest.",
      );
    }
    noOpMode = true;
    logger.warn(
      "[Encryption] ENCRYPTION_KEY not set — token encryption disabled (plaintext pass-through). " +
        "Set ENCRYPTION_KEY to a 64-character hex string (32 bytes) to enable encryption at rest.",
    );
    return;
  }

  // Validate: must be a 64-character hex string (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      "[Encryption] ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        `Got ${keyHex.length} characters.`,
    );
  }

  encryptionKey = Buffer.from(keyHex, "hex");
  noOpMode = false;
  logger.info("[Encryption] Token encryption initialized successfully");
}

/**
 * Check if a value looks like it's already encrypted (matches iv:authTag:ciphertext format).
 */
export function isEncrypted(value: string): boolean {
  return ENCRYPTED_FORMAT_REGEX.test(value);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns the encrypted value as "iv:authTag:ciphertext" (all base64).
 * If ENCRYPTION_KEY is not set (no-op mode), returns plaintext unchanged.
 * If the value is already encrypted, returns it unchanged to prevent double-encryption.
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in "iv:authTag:ciphertext" format, or plaintext in no-op mode
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  // No-op mode: return plaintext unchanged
  if (noOpMode || !encryptionKey) {
    return plaintext;
  }

  // Prevent double-encryption
  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an encrypted string using AES-256-GCM.
 *
 * Expects the value in "iv:authTag:ciphertext" format (all base64).
 * If the value doesn't match the encrypted format, returns it as-is (plaintext).
 * If ENCRYPTION_KEY is not set (no-op mode), returns the value unchanged.
 *
 * @param encrypted - The encrypted string to decrypt
 * @returns Decrypted plaintext string
 */
export function decrypt(encrypted: string): string {
  if (!encrypted) return encrypted;

  // No-op mode: return value unchanged
  if (noOpMode || !encryptionKey) {
    return encrypted;
  }

  // If it doesn't look encrypted, return as-is (handles plaintext gracefully)
  if (!isEncrypted(encrypted)) {
    return encrypted;
  }

  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    return encrypted;
  }

  try {
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");

    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    // Decryption failure means wrong key, corrupted data, or tampered ciphertext.
    // Returning ciphertext would leak encrypted material — throw instead.
    logger.error(
      "[Encryption] Decryption failed — possible key mismatch or data corruption",
      { error: err instanceof Error ? err.message : String(err) },
    );
    throw new Error(
      "[Encryption] Failed to decrypt value — possible key mismatch or data corruption",
    );
  }
}

/**
 * Check if encryption is active (ENCRYPTION_KEY is configured).
 */
export function isEncryptionActive(): boolean {
  return !noOpMode && encryptionKey !== null;
}
