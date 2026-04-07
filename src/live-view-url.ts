import { networkInterfaces } from "os";

function isWslRuntime(): boolean {
  return process.platform === "linux" && (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));
}

function getWslIpv4Address(): string | null {
  const nets = networkInterfaces();
  for (const netList of Object.values(nets)) {
    if (!netList) continue;
    for (const net of netList) {
      if (net.family !== "IPv4") continue;
      if (net.internal) continue;
      if (!net.address) continue;
      if (net.address.startsWith("127.")) continue;
      return net.address;
    }
  }
  return null;
}

export interface LiveViewUrlSet {
  /** URL that the current host can always use. */
  localUrl: string;
  /** URL intended for browsers running on Windows when CLI runs inside WSL. */
  wslDirectUrl: string | null;
  /** Best default URL to present first to the user. */
  preferredUrl: string;
}

export function getLiveViewUrls(port: number): LiveViewUrlSet {
  const localUrl = `http://localhost:${port}`;
  if (!isWslRuntime()) {
    return {
      localUrl,
      wslDirectUrl: null,
      preferredUrl: localUrl,
    };
  }

  const wslIp = getWslIpv4Address();
  const wslDirectUrl = wslIp ? `http://${wslIp}:${port}` : null;
  return {
    localUrl,
    wslDirectUrl,
    preferredUrl: wslDirectUrl || localUrl,
  };
}

export function formatLiveViewUrlMessage(port: number): string {
  const urls = getLiveViewUrls(port);
  return `Live code view → ${urls.preferredUrl}`;
}
