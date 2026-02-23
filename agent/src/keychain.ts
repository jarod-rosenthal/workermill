/**
 * Cross-platform keychain access via CLI tools.
 *
 * The agent binary is compiled with `bun build --compile` so native C++ addons
 * (like keytar) won't work. Instead we shell out to platform-specific CLI tools:
 *
 *   macOS:   `security` (Keychain Services)
 *   Linux:   `secret-tool` (libsecret / GNOME Keyring)
 *   Windows: `cmdkey` (Credential Manager)
 *
 * All operations use short timeouts and never crash — failures return null/false
 * so callers can fall back to config.json.
 */

import { execFileSync, execSync } from "child_process";

const SERVICE = "workermill";
const ACCOUNT = "workermill";
const LABEL = "WorkerMill API Key";
const TIMEOUT = 5_000;

let _warned = false;

function warnOnce(msg: string): void {
  if (!_warned) {
    console.warn(`[keychain] ${msg}`);
    _warned = true;
  }
}

/**
 * Read the API key from the OS keychain.
 * Returns the key string, or null if not found / not available.
 */
export function readApiKeyFromKeychain(): string | null {
  try {
    switch (process.platform) {
      case "darwin":
        return readMacOS();
      case "linux":
        return readLinux();
      case "win32":
        return readWindows();
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Write the API key to the OS keychain.
 * Returns true on success, false on failure.
 */
export function writeApiKeyToKeychain(apiKey: string): boolean {
  try {
    switch (process.platform) {
      case "darwin":
        return writeMacOS(apiKey);
      case "linux":
        return writeLinux(apiKey);
      case "win32":
        return writeWindows(apiKey);
      default:
        warnOnce(`Unsupported platform: ${process.platform}`);
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Delete the API key from the OS keychain.
 * Returns true on success, false on failure.
 */
export function deleteApiKeyFromKeychain(): boolean {
  try {
    switch (process.platform) {
      case "darwin":
        return deleteMacOS();
      case "linux":
        return deleteLinux();
      case "win32":
        return deleteWindows();
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ── macOS: Keychain Services via `security` ──────────────

function readMacOS(): string | null {
  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"],
      { encoding: "utf-8", timeout: TIMEOUT, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

function writeMacOS(apiKey: string): boolean {
  try {
    // -U = update if exists, -a = account, -s = service, -w = password
    execFileSync(
      "security",
      ["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", apiKey, "-U"],
      { timeout: TIMEOUT, stdio: "pipe" },
    );
    return true;
  } catch {
    warnOnce("Failed to write API key to macOS Keychain");
    return false;
  }
}

function deleteMacOS(): boolean {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE],
      { timeout: TIMEOUT, stdio: "pipe" },
    );
    return true;
  } catch {
    return false; // Not found is fine
  }
}

// ── Linux: libsecret via `secret-tool` ───────────────────

function readLinux(): string | null {
  try {
    const result = execFileSync(
      "secret-tool",
      ["lookup", "service", SERVICE, "account", ACCOUNT],
      { encoding: "utf-8", timeout: TIMEOUT, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return result || null;
  } catch {
    warnOnce("secret-tool not available — falling back to config.json");
    return null;
  }
}

function writeLinux(apiKey: string): boolean {
  try {
    // secret-tool reads the secret from stdin
    execSync(
      `echo -n ${escapeShellArg(apiKey)} | secret-tool store --label=${escapeShellArg(LABEL)} service ${SERVICE} account ${ACCOUNT}`,
      { timeout: TIMEOUT, stdio: "pipe" },
    );
    return true;
  } catch {
    warnOnce("Failed to write API key via secret-tool");
    return false;
  }
}

function deleteLinux(): boolean {
  try {
    execFileSync(
      "secret-tool",
      ["clear", "service", SERVICE, "account", ACCOUNT],
      { timeout: TIMEOUT, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

// ── Windows: Credential Manager via `cmdkey` ─────────────

function readWindows(): string | null {
  try {
    // cmdkey /list only shows metadata, not the actual password.
    // Use PowerShell to retrieve the credential password.
    const psScript = `
      $cred = Get-StoredCredential -Target '${SERVICE}' -ErrorAction SilentlyContinue
      if ($cred) { $cred.GetNetworkCredential().Password } else {
        # Fallback: use CredRead via .NET
        Add-Type -AssemblyName System.Runtime.InteropServices
        $c = [System.Net.CredentialCache]::DefaultCredentials
        # Try cmdkey-based approach with advapi32
        $null
      }
    `.trim();

    // Simpler approach: use PowerShell's built-in credential APIs
    const result = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "` +
        `try { ` +
        `  Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class CredManager{[DllImport(\\\"advapi32.dll\\\",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool CredRead(string target,int type,int flags,out IntPtr cred);[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct CREDENTIAL{public int Flags;public int Type;public string TargetName;public string Comment;public long LastWritten;public int CredentialBlobSize;public IntPtr CredentialBlob;public int Persist;public int AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName;}public static string Get(string target){IntPtr p;if(!CredRead(target,1,0,out p))return null;var c=Marshal.PtrToStructure<CREDENTIAL>(p);if(c.CredentialBlobSize>0){return Marshal.PtrToStringUni(c.CredentialBlob,c.CredentialBlobSize/2);}return null;}}'; ` +
        `  [CredManager]::Get('${SERVICE}') ` +
        `} catch { $null }"`,
      { encoding: "utf-8", timeout: TIMEOUT, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    return result || null;
  } catch {
    warnOnce("Failed to read API key from Windows Credential Manager");
    return null;
  }
}

function writeWindows(apiKey: string): boolean {
  try {
    execSync(
      `cmdkey /generic:${SERVICE} /user:${ACCOUNT} /pass:${escapeWindowsArg(apiKey)}`,
      { timeout: TIMEOUT, windowsHide: true, stdio: "pipe" },
    );
    return true;
  } catch {
    warnOnce("Failed to write API key to Windows Credential Manager");
    return false;
  }
}

function deleteWindows(): boolean {
  try {
    execSync(`cmdkey /delete:${SERVICE}`, {
      timeout: TIMEOUT,
      windowsHide: true,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────

function escapeShellArg(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function escapeWindowsArg(s: string): string {
  // cmdkey doesn't handle special chars well — wrap in quotes
  return '"' + s.replace(/"/g, '\\"') + '"';
}
