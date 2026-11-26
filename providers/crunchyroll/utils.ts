import { ProviderContext } from "../types";

export const DEFAULT_BASE_URL = "https://www.crunchyroll.com";
export const API_BASE = "https://beta-api.crunchyroll.com";
export const PLAY_SERVICE_BASE = "https://cr-play-service.prd.crunchyrollsvc.com";
export const LICENSE_SERVER = "https://cr-license-proxy.prd.crunchyrollsvc.com/v1/license/widevine?specConform=true";
export const DEFAULT_ICON = "https://www.crunchyroll.com/build/assets/img/favicons/favicon-v2-192x192.png";

let cachedToken: string | null = null;
let tokenExpiryTime: number = 0;

export async function resolveBaseUrl(providerContext: ProviderContext): Promise<string> {
  try {
    const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
    if (override && typeof override === "string" && override.trim().length > 0) {
      return override.trim().replace(/\/+$/, "");
    }
  } catch (e) {}
  if (providerContext.getBaseUrl) {
    try {
      const url = await providerContext.getBaseUrl();
      if (url) return url.replace(/\/+$/, "");
    } catch (e) {}
  }
  return DEFAULT_BASE_URL;
}

export async function getAccessToken(providerContext: ProviderContext, forceRefresh: boolean = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < tokenExpiryTime - 60000) {
    return cachedToken;
  }

  const { axios } = providerContext;

  // 1. Check if user configured or saved an etp_rt session token
  try {
    const etpRt = await providerContext.kvStore?.get<string>("etp_rt");
    if (etpRt && typeof etpRt === "string" && etpRt.trim().length > 0) {
      const res = await axios.post(
        `${API_BASE}/auth/v1/token`,
        "grant_type=etp_rt_cookie",
        {
          headers: {
            "Authorization": "Basic Y3Jfd2ViOg==",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": `etp_rt=${etpRt.trim()}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        }
      );
      if (res?.data?.access_token) {
        cachedToken = res.data.access_token;
        const expiresIn = typeof res.data.expires_in === "number" ? res.data.expires_in : 3600;
        tokenExpiryTime = now + expiresIn * 1000;
        return cachedToken;
      }
    }
  } catch (err: any) {
    // If etp_rt expired or failed, fall through to anonymous grant
  }

  // 2. Fallback to client_id anonymous token
  try {
    const res = await axios.post(
      `${API_BASE}/auth/v1/token`,
      "grant_type=client_id",
      {
        headers: {
          "Authorization": "Basic Y3Jfd2ViOg==",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    if (res?.data?.access_token) {
      cachedToken = res.data.access_token;
      const expiresIn = typeof res.data.expires_in === "number" ? res.data.expires_in : 3600;
      tokenExpiryTime = now + expiresIn * 1000;
      return cachedToken;
    }
  } catch (err: any) {
    console.error("[crunchyroll] getAccessToken error:", err?.message || err);
  }

  return cachedToken || "";
}

export function extractBestImage(images: any): string {
  if (!images || typeof images !== "object") return DEFAULT_ICON;

  // 1. Check poster_tall
  if (Array.isArray(images.poster_tall) && images.poster_tall.length > 0) {
    const list = Array.isArray(images.poster_tall[0]) ? images.poster_tall[0] : images.poster_tall;
    if (Array.isArray(list) && list.length > 0) {
      const preferred = list.find((img: any) => img && typeof img.width === "number" && img.width >= 240 && img.width <= 800) || list[list.length - 1];
      if (preferred?.source && typeof preferred.source === "string" && preferred.source.startsWith("http")) {
        return preferred.source;
      }
    }
  }

  // 2. Check poster_wide
  if (Array.isArray(images.poster_wide) && images.poster_wide.length > 0) {
    const list = Array.isArray(images.poster_wide[0]) ? images.poster_wide[0] : images.poster_wide;
    if (Array.isArray(list) && list.length > 0) {
      const preferred = list.find((img: any) => img && typeof img.width === "number" && img.width >= 400 && img.width <= 1200) || list[list.length - 1];
      if (preferred?.source && typeof preferred.source === "string" && preferred.source.startsWith("http")) {
        return preferred.source;
      }
    }
  }

  // 3. Check thumbnail
  if (Array.isArray(images.thumbnail) && images.thumbnail.length > 0) {
    const list = Array.isArray(images.thumbnail[0]) ? images.thumbnail[0] : images.thumbnail;
    if (Array.isArray(list) && list.length > 0) {
      const preferred = list.find((img: any) => img && typeof img.width === "number" && img.width >= 300) || list[list.length - 1];
      if (preferred?.source && typeof preferred.source === "string" && preferred.source.startsWith("http")) {
        return preferred.source;
      }
    }
  }

  return DEFAULT_ICON;
}

export function cleanSeriesId(link: string): string {
  if (!link) return "";
  const match = link.match(/\/series\/([A-Z0-9]+)/i) || link.match(/([A-Z0-9]{9})/i);
  return match ? match[1] : link.trim();
}

export function cleanEpisodeId(link: string): string {
  if (!link) return "";
  const match = link.match(/\/watch\/([A-Z0-9]+)/i) || link.match(/([A-Z0-9]{9})/i);
  return match ? match[1] : link.trim();
}
