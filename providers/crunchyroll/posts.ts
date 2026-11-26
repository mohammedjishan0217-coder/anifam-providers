import { Post, ProviderContext } from "../types";
import { API_BASE, extractBestImage, getAccessToken, resolveBaseUrl } from "./utils";

function mapItemToPost(baseUrl: string, item: any): Post {
  const title = item.title || item.slug_title || "Untitled Anime";
  const link = `${baseUrl}/series/${item.id}/${item.slug_title || ""}`;
  const image = extractBestImage(item.images);

  const tags: string[] = [];
  if (item.series_metadata?.episode_count) {
    tags.push(`${item.series_metadata.episode_count} Eps`);
  }
  if (item.series_metadata?.is_subbed) {
    tags.push("Sub");
  }
  if (item.series_metadata?.is_dubbed) {
    tags.push("Dub");
  }

  const cornerTag = item.series_metadata?.season_count
    ? `${item.series_metadata.season_count} Season${item.series_metadata.season_count > 1 ? "s" : ""}`
    : undefined;

  return {
    title,
    link,
    image,
    cornerTag,
    tag: tags.length > 0 ? tags.join(" • ") : undefined,
  };
}

export const getPosts = async function ({
  filter,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const token = await getAccessToken(providerContext);
    const currentPage = Math.max(1, page || 1);
    const pageSize = 20;
    const start = (currentPage - 1) * pageSize;

    let queryParam = "sort_by=popularity";
    if (filter === "newly_added") {
      queryParam = "sort_by=newly_added";
    } else if (filter === "alphabetical") {
      queryParam = "sort_by=alphabetical";
    } else if (filter === "top_airing") {
      queryParam = "type=series&sort_by=popularity";
    } else if (filter && filter.startsWith("genre:")) {
      const genre = filter.replace("genre:", "").trim();
      queryParam = `categories=${encodeURIComponent(genre)}&sort_by=popularity`;
    }

    const res = await providerContext.axios.get(
      `${API_BASE}/content/v2/discover/browse?${queryParam}&start=${start}&n=${pageSize}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...providerContext.commonHeaders,
        },
        signal,
      }
    );

    const items = res?.data?.data;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && item.id) {
          posts.push(mapItemToPost(baseUrl, item));
        }
      }
    }
  } catch (err: any) {
    console.error("[crunchyroll] getPosts error:", err?.message || err);
  }
  return posts;
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const token = await getAccessToken(providerContext);
    const currentPage = Math.max(1, page || 1);
    const pageSize = 20;
    const start = (currentPage - 1) * pageSize;

    const res = await providerContext.axios.get(
      `${API_BASE}/content/v2/discover/search?q=${encodeURIComponent(searchQuery)}&n=${pageSize}&start=${start}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...providerContext.commonHeaders,
        },
        signal,
      }
    );

    const sections = res?.data?.data;
    const seen = new Set<string>();

    if (Array.isArray(sections)) {
      for (const section of sections) {
        if (
          (section.type === "series" ||
            section.type === "top_results" ||
            section.type === "movie_listing" ||
            section.type === "episode") &&
          Array.isArray(section.items)
        ) {
          for (const item of section.items) {
            if (item && item.id && !seen.has(item.id)) {
              seen.add(item.id);
              posts.push(mapItemToPost(baseUrl, item));
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[crunchyroll] getSearchPosts error:", err?.message || err);
  }
  return posts;
};
