import { Info, Link, ProviderContext } from "../types";
import {
  API_BASE,
  cleanEpisodeId,
  cleanSeriesId,
  DEFAULT_ICON,
  extractBestImage,
  getAccessToken,
  resolveBaseUrl,
} from "./utils";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const baseUrl = await resolveBaseUrl(providerContext);
  const token = await getAccessToken(providerContext);

  try {
    let seriesId = cleanSeriesId(link);

    // If the input link is an episode watch URL, lookup its parent series
    if (link.includes("/watch/")) {
      const epId = cleanEpisodeId(link);
      try {
        const objRes = await providerContext.axios.get(
          `${API_BASE}/content/v2/cms/objects/${epId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              ...providerContext.commonHeaders,
            },
          }
        );
        const obj = objRes?.data?.data?.[0];
        if (obj?.episode_metadata?.series_id) {
          seriesId = obj.episode_metadata.series_id;
        }
      } catch (e) {}
    }

    if (!seriesId) {
      throw new Error(`Invalid Crunchyroll series link: ${link}`);
    }

    // 1. Fetch series metadata
    const seriesRes = await providerContext.axios.get(
      `${API_BASE}/content/v2/cms/series/${seriesId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...providerContext.commonHeaders,
        },
      }
    );

    const series = seriesRes?.data?.data?.[0];
    if (!series) {
      throw new Error(`Crunchyroll series not found for ID: ${seriesId}`);
    }

    const title = series.title || series.slug_title || "Untitled Anime";
    const synopsis = series.description || "";
    const image = extractBestImage(series.images) || DEFAULT_ICON;
    const isMovie = series.season_count === 1 && series.episode_count === 1;
    const mediaType = isMovie ? "movie" : "series";

    const tags: string[] = [];
    if (Array.isArray(series.keywords)) {
      for (const kw of series.keywords) {
        if (typeof kw === "string" && kw.trim()) tags.push(kw.trim());
      }
    }

    // 2. Fetch seasons
    const seasonsRes = await providerContext.axios.get(
      `${API_BASE}/content/v2/cms/series/${seriesId}/seasons`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...providerContext.commonHeaders,
        },
      }
    );

    const seasons = seasonsRes?.data?.data || [];
    const linkList: Link[] = [];

    for (const season of seasons) {
      if (season && season.id) {
        const seasonTitle =
          season.title ||
          (typeof season.season_number === "number"
            ? `Season ${season.season_number}`
            : "Season");

        linkList.push({
          title: seasonTitle,
          episodesLink: `${API_BASE}/content/v2/cms/seasons/${season.id}/episodes`,
        });
      }
    }

    // Fallback if no seasons were returned
    if (linkList.length === 0) {
      linkList.push({
        title: "Season 1",
        episodesLink: `${API_BASE}/content/v2/cms/series/${seriesId}/seasons`,
      });
    }

    return {
      title,
      synopsis,
      image,
      imdbId: `cr:${seriesId}`,
      type: mediaType,
      tags: tags.length > 0 ? tags : undefined,
      linkList,
      webUrl: `${baseUrl}/series/${seriesId}/${series.slug_title || ""}`,
    };
  } catch (err: any) {
    console.error("[crunchyroll] getMeta error:", err?.message || err);
    return {
      title: "Crunchyroll Anime",
      synopsis: "Could not load anime details.",
      image: DEFAULT_ICON,
      imdbId: "",
      type: "series",
      linkList: [],
    };
  }
};
