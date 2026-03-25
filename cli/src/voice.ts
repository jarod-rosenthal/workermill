/**
 * Voice input — uses platform-native speech recognition.
 *
 * Mac: `hear` CLI (wraps Apple Speech.framework) — brew install hear
 * Windows: PowerShell System.Speech.Recognition
 * Linux: arecord + whisper.cpp (if available)
 *
 * Falls back to a helpful error message if the required tool isn't installed.
 */

import { execSync, exec, type ChildProcess } from "child_process";
import * as logger from "./logger.js";

const MAX_LISTEN_SECONDS = 60; // safety cap — most speech is under 30s

interface VoiceResult {
  text: string;
  error?: string;
}

/**
 * Detect which voice tool is available on this platform.
 */
function detectVoiceTool(): { tool: "hear" | "powershell" | "whisper" | null; installHint: string } {
  const platform = process.platform;

  // Mac: check for `hear`
  if (platform === "darwin") {
    try {
      execSync("which hear", { stdio: "pipe" });
      return { tool: "hear", installHint: "" };
    } catch {
      return { tool: null, installHint: "Install `hear` for voice input:\n\n```\nbrew install hear\n```\n\nhttps://github.com/sveinbjornt/hear" };
    }
  }

  // Windows (or WSL targeting Windows)
  if (platform === "win32") {
    return { tool: "powershell", installHint: "" };
  }

  // Linux — check WSL first (can use PowerShell on Windows side)
  if (platform === "linux") {
    try {
      const uname = execSync("uname -r 2>/dev/null", { encoding: "utf-8" });
      if (uname.toLowerCase().includes("microsoft")) {
        // WSL — use PowerShell on the Windows side
        try {
          execSync("which powershell.exe", { stdio: "pipe" });
          return { tool: "powershell", installHint: "" };
        } catch { /* powershell.exe not in PATH */ }
      }
    } catch { /* not WSL */ }

    // Native Linux — check for whisper
    try {
      execSync("which whisper", { stdio: "pipe" });
      return { tool: "whisper", installHint: "" };
    } catch {
      return { tool: null, installHint: "Install Whisper for voice input:\n\n```\npip install openai-whisper\n```\n\nOr use `hear` on Mac: `brew install hear`" };
    }
  }

  return { tool: null, installHint: "Voice input is not supported on this platform." };
}

/**
 * Record and transcribe speech using the platform's native tool.
 */
async function transcribeWithHear(): Promise<VoiceResult> {
  try {
    // hear -i -l en — interactive mode, stops on silence, outputs transcribed text
    const text = execSync(`hear -i -l en 2>/dev/null`, {
      encoding: "utf-8",
      timeout: (MAX_LISTEN_SECONDS + 5) * 1000,
    }).trim();
    return { text };
  } catch (err) {
    return { text: "", error: `hear failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function transcribeWithPowerShell(): Promise<VoiceResult> {
  const psCommand = process.platform === "win32" ? "powershell" : "powershell.exe";
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine",
    "$r.SetInputToDefaultAudioDevice()",
    "$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
    `$r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${MAX_LISTEN_SECONDS})`,
    "$r.EndSilenceTimeout = [TimeSpan]::FromSeconds(3)",
    "$result = $r.Recognize()",
    "if ($result) { Write-Output $result.Text } else { Write-Output '' }",
    "$r.Dispose()",
  ].join("; ");

  // Use -EncodedCommand to avoid quote escaping issues
  const encoded = Buffer.from(script, "utf16le").toString("base64");

  try {
    const text = execSync(`${psCommand} -NoProfile -EncodedCommand ${encoded}`, {
      encoding: "utf-8",
      timeout: (MAX_LISTEN_SECONDS + 10) * 1000,
    }).trim();
    return { text };
  } catch (err) {
    return { text: "", error: `PowerShell speech recognition failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function transcribeWithWhisper(): Promise<VoiceResult> {
  // Record audio with arecord, pipe to whisper
  try {
    // Check for arecord
    execSync("which arecord", { stdio: "pipe" });
  } catch {
    return { text: "", error: "arecord not found. Install alsa-utils: `sudo apt install alsa-utils`" };
  }

  try {
    const text = execSync(
      `arecord -q -f cd -t wav -d ${MAX_LISTEN_SECONDS} /tmp/wm-voice.wav 2>/dev/null && whisper /tmp/wm-voice.wav --language en --output_format txt --output_dir /tmp 2>/dev/null && cat /tmp/wm-voice.txt && rm -f /tmp/wm-voice.wav /tmp/wm-voice.txt`,
      { encoding: "utf-8", timeout: (MAX_LISTEN_SECONDS + 30) * 1000 },
    ).trim();
    return { text };
  } catch (err) {
    return { text: "", error: `Whisper transcription failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Listen for voice input and return transcribed text.
 * Returns { text, error } — text is empty string on failure.
 */
export async function listenForVoice(): Promise<VoiceResult> {
  const { tool, installHint } = detectVoiceTool();

  if (!tool) {
    return { text: "", error: installHint };
  }

  logger.info("Voice input started", { tool });

  switch (tool) {
    case "hear":
      return transcribeWithHear();
    case "powershell":
      return transcribeWithPowerShell();
    case "whisper":
      return transcribeWithWhisper();
    default:
      return { text: "", error: "No voice tool available." };
  }
}

/**
 * Check if voice input is available on this platform.
 */
export function isVoiceAvailable(): { available: boolean; tool: string | null; installHint: string } {
  const { tool, installHint } = detectVoiceTool();
  return { available: tool !== null, tool, installHint };
}
