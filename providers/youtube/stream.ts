import { Stream, ProviderContext, TextTrack } from "../types";

function extractVideoId(url: string): string {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return url;
}

function formatSize(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function getFormatBytes(f: any, durationSec: number): number {
  if (f.contentLength) {
    const parsed = parseInt(f.contentLength, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const bitrate = f.averageBitrate || f.bitrate;
  if (bitrate && durationSec > 0) {
    return Math.round((bitrate * durationSec) / 8);
  }
  if (f.approxDurationMs && bitrate) {
    const sec = parseInt(f.approxDurationMs, 10) / 1000;
    if (sec > 0) {
      return Math.round((bitrate * sec) / 8);
    }
  }
  return 0;
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload
}: {
  link: string;
  type?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const { axios, commonHeaders } = providerContext;
  const videoId = extractVideoId(link);

  let visitorData: string | null = null;
  let sts = 20779;

  // Step 1: Fetch watch page for visitorData and sts (required to avoid LOGIN_REQUIRED)
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`;
    const watchRes = await axios.get(watchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...commonHeaders
      },
      signal
    });

    const html: string = typeof watchRes.data === "string" ? watchRes.data : "";
    const vMatch = html.match(/\"VISITOR_DATA\":\"([^\"]+)\"/);
    if (vMatch) visitorData = vMatch[1];
    const sMatch = html.match(/\"sts\":(\d+)/i) || html.match(/\"signatureTimestamp\":(\d+)/i);
    if (sMatch) sts = parseInt(sMatch[1], 10);
  } catch (e) {
    // Proceed with default sts
  }

  // Step 2: Query VISIONOS (primary for HLS + Subtitles) and ANDROID_VR (for direct 360p pre-muxed mp4) in parallel
  const visionPayload = {
    context: {
      client: {
        clientName: "VISIONOS",
        clientVersion: "1.02",
        deviceMake: "Apple",
        deviceModel: "RealityDevice17,1",
        osName: "visionOS",
        osVersion: "26.5.23O471",
        hl: "en",
        timeZone: "UTC",
        utcOffsetMinutes: 0
      }
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        signatureTimestamp: sts
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  const vrPayload = {
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.60.19",
        hl: "en",
        gl: "US"
      }
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true
  };

  const visionHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    "X-YouTube-Client-Name": "101",
    "X-YouTube-Client-Version": "1.02",
    "Origin": "https://www.youtube.com"
  };
  if (visitorData) visionHeaders["X-Goog-Visitor-Id"] = visitorData;

  const vrHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.youtube.com"
  };
  if (visitorData) vrHeaders["X-Goog-Visitor-Id"] = visitorData;

  const [visionResResult, vrResResult] = await Promise.allSettled([
    axios.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", visionPayload, {
      headers: visionHeaders,
      signal
    }),
    axios.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", vrPayload, {
      headers: vrHeaders,
      signal
    })
  ]);

  const visionData = visionResResult.status === "fulfilled" ? visionResResult.value?.data : null;
  const vrData = vrResResult.status === "fulfilled" ? vrResResult.value?.data : null;

  const mainData = visionData?.streamingData ? visionData : vrData;
  if (!mainData?.streamingData) return [];

  const durationSec = parseInt(mainData.videoDetails?.lengthSeconds || vrData?.videoDetails?.lengthSeconds || "0", 10);
  const hlsManifestUrl: string | undefined = mainData.streamingData.hlsManifestUrl || vrData?.streamingData?.hlsManifestUrl;
  const adaptiveFormats = mainData.streamingData.adaptiveFormats || vrData?.streamingData?.adaptiveFormats || [];

  // Extract subtitles / closed captions
  const subtitles: TextTrack[] = [];
  const captionTracks =
    mainData.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
    vrData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
    [];

  for (const track of captionTracks) {
    if (track.baseUrl) {
      const langName = track.name?.runs?.[0]?.text || track.name?.simpleText || track.languageCode;
      subtitles.push({
        title: langName,
        language: track.languageCode || "en",
        type: "text/vtt",
        uri: `${track.baseUrl}&fmt=vtt`
      });
    }
  }

  const streams: Stream[] = [];

  // 1. PRIMARY STREAM: HLS Master Playlist (Full synced audio + video up to 4K/1080p)
  // ExoPlayer natively handles demuxed HLS with video + audio in perfect synchronization.
  // Vega App's HLS downloader downloads both the video playlist and default audio playlist and merges them into an MP4!
  if (hlsManifestUrl) {
    let bestVideoBw = 0;
    for (const f of adaptiveFormats) {
      if (f.mimeType?.startsWith("video/")) {
        const bw = f.averageBitrate || f.bitrate || 0;
        if (bw > bestVideoBw && (f.height || 0) <= 1080) {
          bestVideoBw = bw;
        }
      }
    }
    let audioBw = 128000;
    for (const f of adaptiveFormats) {
      if (f.mimeType?.startsWith("audio/mp4")) {
        audioBw = f.averageBitrate || f.bitrate || 128000;
        break;
      }
    }
    const hlsTotalBw = (bestVideoBw || 2500000) + audioBw;
    const hlsBytes = durationSec > 0 ? Math.round((hlsTotalBw * durationSec) / 8) : 0;
    const hlsSizeStr = formatSize(hlsBytes);

    const hlsServer = hlsSizeStr
      ? `YouTube Best Quality (Auto / 1080p HLS • Audio Included) • ~${hlsSizeStr}`
      : `YouTube Best Quality (Auto / 1080p HLS • Audio Included)`;
    const hlsQuality = hlsSizeStr ? `Auto / 1080p (~${hlsSizeStr})` : `Auto / 1080p`;

    streams.push({
      server: hlsServer,
      link: hlsManifestUrl,
      type: "m3u8",
      quality: hlsQuality,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      tag: hlsSizeStr ? `~${hlsSizeStr} • Full Audio` : "Full Audio",
      tags: ["Full Audio", hlsSizeStr].filter(Boolean) as string[]
    });
  }

  // 2. Combined audio+video formats (pre-muxed single file formats, e.g. itag 18 360p)
  const combinedFormats = [
    ...(mainData.streamingData.formats || []),
    ...(vrData?.streamingData?.formats || [])
  ];
  const seenItags = new Set<number>();
  for (const f of combinedFormats) {
    if (f.url && !(f.cipher || f.signatureCipher) && !seenItags.has(f.itag)) {
      seenItags.add(f.itag);
      const q = f.qualityLabel || f.quality || "360p";
      const qNum = parseInt(q.replace(/\D/g, ""), 10) || 360;
      const bytes = getFormatBytes(f, durationSec);
      const sizeStr = formatSize(bytes);
      const serverLabel = sizeStr
        ? `YouTube Direct MP4 (${q} Audio+Video) • ${sizeStr}`
        : `YouTube Direct MP4 (${q} Audio+Video)`;
      const qualityLabel = sizeStr ? `${qNum}p (${sizeStr})` : qNum.toString();

      streams.push({
        server: serverLabel,
        link: f.url,
        type: "mp4",
        quality: qualityLabel,
        subtitles: subtitles.length > 0 ? subtitles : undefined,
        tag: sizeStr ? `${sizeStr} • Audio+Video` : "Audio+Video",
        tags: ["Audio+Video", sizeStr].filter(Boolean) as string[]
      });
    }
  }

  // 3. Audio Formats (AAC 128k / Opus) - for music/podcast listening and downloading
  for (const f of adaptiveFormats) {
    if (f.url && !(f.cipher || f.signatureCipher) && f.mimeType?.startsWith("audio/")) {
      const isAac = f.mimeType?.includes("mp4");
      const codecName = isAac ? "AAC (m4a)" : "Opus (webm)";
      const bytes = getFormatBytes(f, durationSec);
      const sizeStr = formatSize(bytes);
      const serverLabel = sizeStr
        ? `YouTube Audio Only (${codecName}) • ${sizeStr}`
        : `YouTube Audio Only (${codecName})`;
      const qualityLabel = sizeStr ? `Audio (${sizeStr})` : "Audio";

      streams.push({
        server: serverLabel,
        link: f.url,
        type: isAac ? "mp4" : "mkv",
        quality: qualityLabel,
        subtitles: subtitles.length > 0 ? subtitles : undefined,
        tag: sizeStr ? `${sizeStr} • Audio Only` : "Audio Only",
        tags: ["Audio Only", sizeStr].filter(Boolean) as string[]
      });
    }
  }

  // 4. Adaptive Video-Only Streams (only in download mode, and explicitly marked as Mute / No Audio)
  if (isDownload) {
    const seenAdaptive = new Set<string>();
    for (const f of adaptiveFormats) {
      if (f.url && !(f.cipher || f.signatureCipher) && f.mimeType?.startsWith("video/")) {
        const qLabel = f.qualityLabel || `${f.height}p` || "video";
        const qNum = f.height || parseInt(qLabel.replace(/\D/g, ""), 10) || 720;
        const isMp4 = f.mimeType?.includes("mp4");
        const ext = isMp4 ? "mp4" : "mkv";
        const formatKey = `${qLabel}-${ext}`;

        if (!seenAdaptive.has(formatKey)) {
          seenAdaptive.add(formatKey);
          const bytes = getFormatBytes(f, durationSec);
          const sizeStr = formatSize(bytes);
          const serverLabel = sizeStr
            ? `YouTube ${qLabel} (${ext.toUpperCase()} • Video Only - No Audio) • ${sizeStr}`
            : `YouTube ${qLabel} (${ext.toUpperCase()} • Video Only - No Audio)`;
          const qualityLabel = sizeStr ? `${qNum}p Mute (${sizeStr})` : `${qNum}p (No Audio)`;

          streams.push({
            server: serverLabel,
            link: f.url,
            type: ext,
            quality: qualityLabel,
            subtitles: subtitles.length > 0 ? subtitles : undefined,
            tag: sizeStr ? `${sizeStr} • Mute` : "Mute (No Audio)",
            tags: ["Video Only", "Mute", sizeStr].filter(Boolean) as string[]
          });
        }
      }
    }
  }

  // Sorting:
  // - Top priority is always streams with Full Audio (HLS master playlist with synced audio, pre-muxed mp4)
  // - Audio-only streams next
  // - Video-only (mute) streams always at the bottom
  streams.sort((a, b) => {
    const aIsMute = a.server.includes("No Audio") || a.server.includes("Mute");
    const bIsMute = b.server.includes("No Audio") || b.server.includes("Mute");
    if (!aIsMute && bIsMute) return -1;
    if (aIsMute && !bIsMute) return 1;

    const aIsAudioOnly = a.server.includes("Audio Only");
    const bIsAudioOnly = b.server.includes("Audio Only");
    if (!aIsAudioOnly && bIsAudioOnly) return -1;
    if (aIsAudioOnly && !bIsAudioOnly) return 1;

    // Between HLS and Direct MP4: HLS provides up to 1080p/4K resolution
    const aIsM3u8 = a.type === "m3u8";
    const bIsM3u8 = b.type === "m3u8";
    if (aIsM3u8 && !bIsM3u8) return -1;
    if (!aIsM3u8 && bIsM3u8) return 1;

    return 0;
  });

  return streams;
};
