import { EpisodeLink, ProviderContext } from "../types";
import { getMeta } from "./meta";

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const meta = await getMeta({ link: url, providerContext });
    const out: EpisodeLink[] = [];
    for (const group of meta.linkList || []) {
      for (const d of group.directLinks || []) {
        out.push({ title: d.title, link: d.link });
      }
    }
    return out;
  } catch (err: any) {
    console.error("[comix] getEpisodes error:", err.message || err);
    return [];
  }
};
