/**
 * URL Validation Utility — SSRF Protection
 *
 * Validates that user-controlled URLs point to external services,
 * blocking requests to localhost, private IP ranges, link-local
 * addresses (including the AWS metadata endpoint at 169.254.169.254),
 * and non-HTTP(S) schemes.
 */

import { lookup } from "dns/promises";
import { logger } from "./logger.js";

// Private and reserved IPv4 ranges (CIDR notation for documentation;
// checked programmatically below)
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Returns true if the IPv4 address falls within a blocked range:
 *   - 127.0.0.0/8    (loopback)
 *   - 10.0.0.0/8     (private)
 *   - 172.16.0.0/12  (private)
 *   - 192.168.0.0/16 (private)
 *   - 169.254.0.0/16 (link-local / AWS metadata)
 *   - 0.0.0.0/8      (unspecified)
 */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false; // not a valid IPv4 — let it through (DNS will fail anyway)
  }

  const [a, b] = parts;

  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local (AWS metadata at 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 — unspecified
  if (a === 0) return true;

  return false;
}

/**
 * Returns true if the IPv6 address is a loopback (::1) or
 * a mapped/embedded private IPv4 (e.g. ::ffff:127.0.0.1).
 */
function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // ::1 — loopback
  if (normalized === "::1" || normalized === "0000:0000:0000:0000:0000:0000:0000:0001") {
    return true;
  }

  // IPv4-mapped IPv6 — ::ffff:x.x.x.x
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) {
    return isBlockedIPv4(mappedMatch[1]);
  }

  // fe80::/10 — link-local
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80")) {
    return true;
  }

  // fc00::/7 — unique local address (private)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a URL is safe to fetch from the server side.
 *
 * Blocks:
 *   - Non-HTTP(S) schemes (e.g. file://, ftp://, data:)
 *   - Localhost and loopback addresses
 *   - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 *   - Link-local addresses (169.254.x.x — AWS metadata)
 *   - IPv6 loopback, link-local, and unique local addresses
 *
 * The hostname is resolved via DNS to catch cases where a public
 * domain name points to an internal IP.
 */
export async function validateExternalUrl(url: string): Promise<UrlValidationResult> {
  // Parse the URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  // Scheme check — only allow http and https
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { valid: false, reason: `Scheme "${scheme}" is not allowed; only http and https are permitted` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Empty hostname check
  if (!hostname) {
    return { valid: false, reason: "URL must include a hostname" };
  }

  // Block well-known localhost names
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: "URLs pointing to localhost are not allowed" };
  }

  // Check if hostname is a literal IP address
  // Strip brackets from IPv6 literals like [::1]
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (isBlockedIPv4(bareHost)) {
    return { valid: false, reason: "URLs pointing to private or loopback IP addresses are not allowed" };
  }

  if (isBlockedIPv6(bareHost)) {
    return { valid: false, reason: "URLs pointing to private or loopback IP addresses are not allowed" };
  }

  // DNS resolution — check the resolved IP address
  try {
    const result = await lookup(bareHost);
    const resolvedIp = result.address;

    if (result.family === 4 && isBlockedIPv4(resolvedIp)) {
      return {
        valid: false,
        reason: `Hostname "${hostname}" resolves to a private/loopback IP address (${resolvedIp})`,
      };
    }

    if (result.family === 6 && isBlockedIPv6(resolvedIp)) {
      return {
        valid: false,
        reason: `Hostname "${hostname}" resolves to a private/loopback IP address (${resolvedIp})`,
      };
    }
  } catch (err) {
    // DNS resolution failure — the URL will fail at fetch time anyway,
    // but we should not block it here (the domain might resolve differently
    // at fetch time, and blocking would be a false positive). Log and allow.
    logger.debug("DNS lookup failed during URL validation (allowing)", {
      hostname,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { valid: true };
}
