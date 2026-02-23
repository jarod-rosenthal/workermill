/**
 * GPU Detection Module
 *
 * Detects GPU hardware across platforms (NVIDIA, Apple Silicon, AMD).
 * Used for local model inference capability checks (e.g., Ollama GPU acceleration).
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { platform } from "os";

export interface GpuInfo {
  available: boolean;
  vendor: "nvidia" | "apple" | "amd" | "none";
  model: string | null;
  memoryMb: number | null;
  driver: string | null;
}

const NO_GPU: GpuInfo = {
  available: false,
  vendor: "none",
  model: null,
  memoryMb: null,
  driver: null,
};

let cachedGpu: GpuInfo | null = null;

// ── NVIDIA Detection (Win/Linux/WSL2) ─────────────────

function detectNvidia(): GpuInfo | null {
  const args = [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
  ];

  // Try standard PATH first, then WSL2 fallback path
  const candidates = ["nvidia-smi"];
  if (platform() === "linux" && existsSync("/usr/lib/wsl/lib/nvidia-smi")) {
    candidates.push("/usr/lib/wsl/lib/nvidia-smi");
  }

  for (const bin of candidates) {
    try {
      const output = execFileSync(bin, args, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }).trim();

      if (!output) continue;

      // Parse CSV: "NVIDIA T1200 Laptop GPU, 4096, 560.35.03"
      const parts = output.split("\n")[0].split(",").map((s) => s.trim());
      const model = parts[0] || null;
      const memoryMb = parts[1] ? parseInt(parts[1], 10) : null;
      const driver = parts[2] || null;

      return {
        available: true,
        vendor: "nvidia",
        model,
        memoryMb: memoryMb !== null && !isNaN(memoryMb) ? memoryMb : null,
        driver,
      };
    } catch {
      // This candidate didn't work, try next
    }
  }

  return null;
}

// ── Apple Silicon Detection (macOS) ───────────────────

function detectApple(): GpuInfo | null {
  if (platform() !== "darwin") return null;

  try {
    const brand = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();

    // Only Apple Silicon has unified memory GPU — Intel Macs use discrete/integrated GPUs
    if (!brand.includes("Apple")) return null;

    let memoryMb: number | null = null;
    try {
      const memBytes = execFileSync("sysctl", ["-n", "hw.memsize"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }).trim();
      const bytes = parseInt(memBytes, 10);
      if (!isNaN(bytes)) {
        memoryMb = Math.round(bytes / (1024 * 1024));
      }
    } catch {
      // Memory query failed, continue with null
    }

    return {
      available: true,
      vendor: "apple",
      model: brand,
      memoryMb,
      driver: "Metal",
    };
  } catch {
    return null;
  }
}

// ── AMD Detection (Linux) ─────────────────────────────

function detectAmd(): GpuInfo | null {
  if (platform() !== "linux") return null;

  let model: string | null = null;
  let memoryMb: number | null = null;

  // Try rocm-smi for model name
  try {
    const output = execFileSync("rocm-smi", ["--showproductname"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();

    // Parse output — look for card name line
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("=") && !trimmed.startsWith("GPU")) {
        model = trimmed;
        break;
      }
    }
  } catch {
    // rocm-smi not available
  }

  // Try rocm-smi for VRAM
  try {
    const output = execFileSync("rocm-smi", ["--showmeminfo", "vram"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();

    // Look for total memory line
    for (const line of output.split("\n")) {
      const match = line.match(/Total\s.*?:\s*(\d+)/i);
      if (match) {
        const bytes = parseInt(match[1], 10);
        if (!isNaN(bytes)) {
          memoryMb = Math.round(bytes / (1024 * 1024));
        }
        break;
      }
    }
  } catch {
    // rocm-smi memory query failed
  }

  // Fallback: check for AMD KFD device
  if (!model && !memoryMb) {
    if (!existsSync("/dev/kfd")) return null;
    model = "AMD GPU (KFD detected)";
  }

  return {
    available: true,
    vendor: "amd",
    model,
    memoryMb,
    driver: "ROCm",
  };
}

// ── Public API ────────────────────────────────────────

/**
 * Run GPU detection fresh. Updates the cache and returns the result.
 * Tries NVIDIA first, then Apple Silicon, then AMD.
 */
export function detectGpu(): GpuInfo {
  const result = detectNvidia() || detectApple() || detectAmd() || NO_GPU;
  cachedGpu = result;
  return result;
}

/**
 * Return cached GPU info. Runs detection on first call.
 */
export function getGpuInfo(): GpuInfo {
  if (!cachedGpu) {
    return detectGpu();
  }
  return cachedGpu;
}
