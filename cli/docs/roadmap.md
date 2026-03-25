# WorkerMill CLI — Roadmap

## Pinned Features

### /chrome — Built-in Browser Automation

Use Chrome's headless mode via CDP (Chrome DevTools Protocol) — no Playwright or Puppeteer dependency.

**How it works:**
1. Launch Chrome with `--headless=new --remote-debugging-port=9222`
2. Connect via websocket to CDP
3. Navigate, screenshot, read DOM, click, fill forms — all via simple HTTP/websocket calls
4. Screenshots returned as base64 PNG (already supported by image pipeline)

**Agent capabilities:**
- Verify how a page renders (CSS, layout, images)
- Check if UI components work (click buttons, fill forms)
- Read console errors
- Validate after code changes ("does the dashboard show data?")

**Scope:**
- ~100 lines of CDP client code, no heavy deps
- Works in chat mode (not during /build — workers don't have a browser)
- Requires Chrome/Chromium installed on the machine
- Tool definitions: `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_evaluate`, `browser_console`

**Platform notes:**
- Chrome path detection: `google-chrome` (Linux), `/Applications/Google Chrome.app/...` (Mac), `chrome.exe` (Windows)
- Fallback to `chromium-browser` if Chrome not found

---

### /voice — Voice Input

Speak instead of type. Audio captured → transcribed → fed to agent as text.

**Option A — Local (no API key):**
- Mac: `sox` or `rec` for audio capture, system speech recognition
- Linux: `arecord` + local Whisper model via `whisper.cpp`
- Pros: fully offline, no cost
- Cons: accuracy varies, platform-specific audio capture

**Option B — Cloud API:**
- Stream audio to OpenAI Whisper API, Google Speech-to-Text, or Deepgram
- Better accuracy, works cross-platform
- Needs API key + network
- Could reuse existing OpenAI/Google keys from config

**UX:**
- `/voice` toggles voice mode on/off
- While active, captures from microphone until silence detected
- Transcription shown in input area before sending
- Press Enter to confirm or Escape to cancel

**Scope:**
- Significant platform-specific work (audio capture)
- Dependency on external transcription (local or cloud)
- Lower priority than /chrome

---

## Streaming Output (Deferred)

Stream worker output token-by-token during /build instead of batching per step. The planner already streams (v0.8.9). Workers still batch via onStepFinish.

**Trade-off:** Real-time visibility vs clean batched output. Most users prefer real-time for slow local models.

**Status:** Planner streaming done. Worker streaming deferred — cosmetic improvement, not a functionality gap.
