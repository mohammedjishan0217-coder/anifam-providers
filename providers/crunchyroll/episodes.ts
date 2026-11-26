import { EpisodeLink, ProviderContext } from "../types";
import {
  API_BASE,
  extractBestImage,
  getAccessToken,
  resolveBaseUrl,
} from "./utils";

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  const episodes: EpisodeLink[] = [];
  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const token = await getAccessToken(providerContext);

    let targetUrl = url;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `${API_BASE}/content/v2/cms/seasons/${url}/episodes`;
    }

    const res = await providerContext.axios.get(targetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...providerContext.commonHeaders,
      },
    });

    const data = res?.data?.data || [];

    // If the endpoint returned a list of seasons (e.g. fallback), fetch episodes for the first season
    if (data.length > 0 && data[0].season_number !== undefined && data[0].episode_number === undefined) {
      const seasonId = data[0].id;
      const epsRes = await providerContext.axios.get(
        `${API_BASE}/content/v2/cms/seasons/${seasonId}/episodes`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...providerContext.commonHeaders,
          },
        }
      );
      const epsData = epsRes?.data?.data || [];
      for (const ep of epsData) {
        if (ep && ep.id) {
          const epTitle =
            typeof ep.episode_number === "number"
              ? `Episode ${ep.episode_number}: ${ep.title || "Episode"}`
              : ep.title || "Episode";

          episodes.push({
            title: epTitle,
            link: `${baseUrl}/watch/${ep.id}/${ep.slug_title || ""}`,
            description: ep.description || "",
            image: extractBestImage(ep.images),
          });
        }
      }
      return episodes;
    }

    // Normal episodes list
    for (const ep of data) {
      if (ep && ep.id) {
        const epTitle =
          typeof ep.episode_number === "number"
            ? `Episode ${ep.episode_number}: ${ep.title || "Episode"}`
            : ep.title || "Episode";

        episodes.push({
          title: epTitle,
          link: `${baseUrl}/watch/${ep.id}/${ep.slug_title || ""}`,
          description: ep.description || "",
          image: extractBestImage(ep.images),
        });
      }
    }
  } catch (err: any) {
    console.error("[crunchyroll] getEpisodes error:", err?.message || err);
  }
  return episodes;
};
