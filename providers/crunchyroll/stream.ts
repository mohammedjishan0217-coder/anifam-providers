import { ProviderContext, SkipInterval, Stream, StreamDrm, TextTracks } from "../types";
import {
  cleanEpisodeId,
  DEFAULT_BASE_URL,
  getAccessToken,
  LICENSE_SERVER,
  PLAY_SERVICE_BASE,
  resolveBaseUrl,
} from "./utils";

function formatSubtitles(subs: any): TextTracks {
  const result: TextTracks = [];
  if (!subs || typeof subs !== "object") return result;

  const entries = Array.isArray(subs) ? subs : Object.entries(subs);
  for (const item of entries) {
    const sub = Array.isArray(item) ? { lang: item[0], ...item[1] } : item;
    if (sub && sub.url) {
      result.push({
        title: sub.locale || sub.lang || sub.title || "Subtitles",
        language: sub.locale || sub.lang || "en",
        type: sub.format === "ass" ? "application/x-subrip" : "text/vtt",
        uri: sub.url,
      });
    }
  }
  return result;
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const streams: Stream[] = [];

  // DRM streams are playback-only per Vega guidelines; omit when isDownload is true
  if (isDownload) {
    return streams;
  }

  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const videoId = cleanEpisodeId(link);

    if (!videoId) {
      return streams;
    }

    // 1. Fetch skip events for automatic intro/outro skipping
    const skip: SkipInterval[] = [];
    try {
      const skipRes = await providerContext.axios.get(
        `https://static.crunchyroll.com/skip-events/production/${videoId}.json`,
        { signal }
      );
      const skipData = skipRes?.data;
      if (
        skipData?.intro &&
        typeof skipData.intro.start === "number" &&
        typeof skipData.intro.end === "number"
      ) {
        skip.push({
          title: "Intro",
          from: Math.floor(skipData.intro.start),
          to: Math.floor(skipData.intro.end),
        });
      }
      if (
        skipData?.credits &&
        typeof skipData.credits.start === "number" &&
        typeof skipData.credits.end === "number"
      ) {
        skip.push({
          title: "Credits",
          from: Math.floor(skipData.credits.start),
          to: Math.floor(skipData.credits.end),
        });
      }
    } catch (e) {}

    // 2. Fetch play response from play-service
    let token = await getAccessToken(providerContext);
    const playUrl = `${PLAY_SERVICE_BASE}/v1/${videoId}/web/firefox/play`;

    let playRes: any = null;
    try {
      playRes = await providerContext.axios.get(playUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal,
      });
    } catch (playErr: any) {
      // If 403 (e.g. requires subscription or login) and WebView is available, prompt login
      if (playErr?.response?.status === 403 && providerContext.openWebView) {
        try {
          const webViewRes = await providerContext.openWebView(
            "https://sso.crunchyroll.com/en/login",
            {
              title: "Log in to Crunchyroll",
              description: "Log in with your Crunchyroll account to unlock premium streaming.",
              waitForCookie: "etp_rt",
              timeoutMs: 120000,
            }
          );
          if (webViewRes?.cookieMap?.etp_rt) {
            await providerContext.kvStore?.set("etp_rt", webViewRes.cookieMap.etp_rt);
            token = await getAccessToken(providerContext, true);
            playRes = await providerContext.axios.get(playUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              signal,
            });
          }
        } catch (wvErr) {}
      }
    }

    // 3. Build streams from playRes
    if (playRes?.data?.url) {
      const playData = playRes.data;
      const subtitles = formatSubtitles(playData.subtitles);

      const drm: StreamDrm = {
        type: "widevine",
        licenseServer: LICENSE_SERVER,
        headers: {
          "X-Cr-Content-Id": videoId,
          "X-Cr-Video-Token": playData.token || "",
          "Authorization": `Bearer ${token}`,
        },
      };

      // Main adaptive DASH stream
      streams.push({
        server: `Crunchyroll (${playData.audioLocale || "Original"})`,
        link: playData.url,
        type: "mpd",
        drm,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        subtitles: subtitles.length > 0 ? subtitles : undefined,
        skip: skip.length > 0 ? skip : undefined,
      });

      // Hardsub streams if available
      if (playData.hardSubs && typeof playData.hardSubs === "object") {
        for (const [code, hardSub] of Object.entries<any>(playData.hardSubs)) {
          if (hardSub && hardSub.url) {
            streams.push({
              server: `Crunchyroll Hardsub (${hardSub.hlang || code})`,
              link: hardSub.url,
              type: "mpd",
              drm,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              skip: skip.length > 0 ? skip : undefined,
            });
          }
        }
      }
    }

    // 4. Fallback stream if direct DASH is unavailable without subscription
    if (streams.length === 0) {
      streams.push({
        server: "Crunchyroll (Subscription Required - Log in in App Settings)",
        link: `${baseUrl}/watch/${videoId}`,
        type: "embed",
        quality: "1080",
        skip: skip.length > 0 ? skip : undefined,
      });
    }
  } catch (err: any) {
    console.error("[crunchyroll] getStream error:", err?.message || err);
  }

  return streams;
};
