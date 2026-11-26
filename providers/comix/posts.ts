import { Post, ProviderContext } from "../types";

const DEFAULT_BASE_URL = "https://comix.to";

async function resolveBaseUrl(providerContext: ProviderContext): Promise<string> {
  try {
    const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
    if (override && typeof override === "string" && override.trim().length > 0) {
      return override.trim().replace(/\/+$/, "");
    }
  } catch (e) {}
  return DEFAULT_BASE_URL;
}

function formatUrl(baseUrl: string, path?: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("//")) return `https:${path}`;
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseInitialData(html: string): Record<string, any> {
  try {
    const match = html.match(/<script[^>]*id=["']initial-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match || !match[1]) return {};
    const parsed = JSON.parse(match[1]);
    return parsed && parsed.queries ? parsed.queries : {};
  } catch (e) {
    return {};
  }
}

function extractItemsArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") {
    if (Array.isArray(val.items)) return val.items;
    if (Array.isArray(val.Fw)) return val.Fw;
    if (Array.isArray(val.data)) return val.data;
  }
  return [];
}

function mapMangaToPost(baseUrl: string, item: any): Post {
  const title = item.title || "Untitled";
  const link = formatUrl(baseUrl, item.url || (item.hid ? `/title/${item.hid}` : ""));
  const rawImg = item.poster?.large || item.poster?.medium || item.image || "";
  const image = formatUrl(baseUrl, rawImg) || `${baseUrl}/assets/uploads/35595e3de3c99889c1bd2c56f3e3714fc0c457.png`;

  const tags: string[] = [];
  if (item.type) tags.push(String(item.type).toUpperCase());
  if (item.latestChapter) tags.push(`Ch.${item.latestChapter}`);

  return {
    title,
    link,
    image,
    tag: tags.length > 0 ? tags.join(" • ") : undefined,
    cornerTag: item.ratedAvg ? `★ ${item.ratedAvg}` : undefined,
  };
}

function buildBrowseWebViewJs(): string {
  return `(function(){
    var tries = 0;
    var poll = function() {
      tries++;
      try {
        var out = [];
        var root = document.getElementById('app-root');
        var el = root ? root.firstElementChild : null;
        if (el) {
          var fk = Object.keys(el).find(function(k){ return k.indexOf('__reactFiber') === 0; });
          var f = fk ? el[fk] : null, qc = null;
          while (f) {
            var st = f.memoizedState;
            while (st) {
              var v = st.memoizedState;
              if (v && typeof v === 'object' && typeof v.getQueryCache === 'function') { qc = v; break; }
              if (v && v.current && typeof v.current.getQueryCache === 'function') { qc = v.current; break; }
              st = st.next;
            }
            if (!qc && f.memoizedProps && f.memoizedProps.value && typeof f.memoizedProps.value.getQueryCache === 'function') qc = f.memoizedProps.value;
            if (qc) break;
            f = f.return;
          }
          if (qc) {
            var qs = qc.getQueryCache().getAll();
            for (var i = 0; i < qs.length; i++) {
              var q = qs[i];
              if (Array.isArray(q.queryKey) && q.queryKey[0] === 'manga' && q.queryKey[1] === 'list' && q.state && q.state.data) {
                var arr = q.state.data.Fw || q.state.data.items || q.state.data.data;
                if (Array.isArray(arr) && arr.length > 0) {
                  for (var j = 0; j < arr.length; j++) {
                    var it = arr[j];
                    out.push({
                      title: it.bS || it.title || '',
                      url: it.RT || it.url || (it.rX ? '/title/' + it.rX : ''),
                      image: (it.Pr && (it.Pr.FU || it.Pr.fG)) || (it.poster && (it.poster.large || it.poster.medium)) || '',
                      type: it.UF || it.type || '',
                      latestChapter: it.IU || it.latestChapter || 0,
                      ratedAvg: it.ratedAvg || ''
                    });
                  }
                  break;
                }
              }
            }
          }
        }
        if (out.length === 0 && tries >= 10) {
          var links = document.querySelectorAll('a[href^="/title/"]');
          var seen = {};
          for (var li = 0; li < links.length; li++) {
            var a = links[li];
            var href = a.getAttribute('href');
            if (!href || href.split('/').filter(Boolean).length !== 2 || seen[href]) continue;
            var img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img'));
            var txt = (a.textContent || '').trim();
            if (!txt && img) txt = img.getAttribute('alt') || '';
            if (!txt) continue;
            seen[href] = true;
            out.push({
              title: txt,
              url: href,
              image: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : ''
            });
          }
        }
        if (out.length > 0 || tries >= 18) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ __waf: true, data: JSON.stringify(out) }));
          }
          return;
        }
      } catch(e) {}
      setTimeout(poll, 450);
    };
    setTimeout(poll, 600);
  })();`;
}

async function fetchViaBrowseWebView(
  browseUrl: string,
  baseUrl: string,
  providerContext: ProviderContext
): Promise<Post[]> {
  if (!providerContext.openWebView) return [];
  try {
    const res = await providerContext.openWebView(browseUrl, {
      title: "Loading Comix",
      timeoutMs: 15000,
      injectedJavaScript: buildBrowseWebViewJs(),
    });
    if (res && res.data && typeof res.data === "string" && res.data.trim().startsWith("[")) {
      const arr = JSON.parse(res.data);
      if (Array.isArray(arr)) {
        return arr
          .filter((it: any) => it && it.title && it.url)
          .map((it: any) => mapMangaToPost(baseUrl, it));
      }
    }
  } catch (e) {}
  return [];
}

function collectAllHomeItems(queries: Record<string, any>): any[] {
  const seen = new Set<string>();
  const all: any[] = [];
  for (const key of Object.keys(queries)) {
    if (!key.startsWith('["manga"')) continue;
    const arr = extractItemsArray(queries[key]);
    for (const item of arr) {
      if (item && (item.hid || item.url)) {
        const id = String(item.hid || item.url);
        if (!seen.has(id)) {
          seen.add(id);
          all.push(item);
        }
      }
    }
  }
  return all;
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
    const currentPage = Math.max(1, page || 1);

    if (filter && filter.startsWith("type:")) {
      const t = filter.replace("type:", "").trim().toLowerCase();
      const browseUrl = `${baseUrl}/browse?types[]=${encodeURIComponent(t)}&page=${currentPage}`;
      const wvPosts = await fetchViaBrowseWebView(browseUrl, baseUrl, providerContext);
      if (wvPosts.length > 0) return wvPosts;
    }

    if (filter && filter.startsWith("genre:")) {
      const g = filter.replace("genre:", "").trim().toLowerCase();
      const browseUrl = `${baseUrl}/browse?keyword=${encodeURIComponent(g)}&page=${currentPage}`;
      const wvPosts = await fetchViaBrowseWebView(browseUrl, baseUrl, providerContext);
      if (wvPosts.length > 0) return wvPosts;
    }

    if (currentPage > 1) {
      const sortParam = filter === "popular" ? "order[follows_total]=desc" : "order[chapter_updated_at]=desc";
      const browseUrl = `${baseUrl}/browse?${sortParam}&page=${currentPage}`;
      const wvPosts = await fetchViaBrowseWebView(browseUrl, baseUrl, providerContext);
      if (wvPosts.length > 0) return wvPosts;
    }

    const res = await providerContext.axios.get(`${baseUrl}/`, {
      headers: {
        ...providerContext.commonHeaders,
        Accept: "text/html,application/xhtml+xml",
        Referer: baseUrl,
      },
      signal,
    });
    const html = typeof res.data === "string" ? res.data : "";
    const queries = parseInitialData(html);

    let items: any[] = [];
    for (const key of Object.keys(queries)) {
      if (filter === "trending" && key.includes('"type":"trending"')) {
        items = extractItemsArray(queries[key]);
        break;
      }
      if (filter === "popular" && key.includes('"type":"follows"')) {
        items = extractItemsArray(queries[key]);
        break;
      }
      if (filter === "hot" && key.includes('"scope":"hot"')) {
        items = extractItemsArray(queries[key]);
        break;
      }
      if (filter === "new" && key.includes('"created_at":"desc"')) {
        items = extractItemsArray(queries[key]);
        break;
      }
    }

    if (items.length === 0) {
      const all = collectAllHomeItems(queries);
      if (filter && filter.startsWith("type:")) {
        const t = filter.replace("type:", "").trim().toLowerCase();
        items = all.filter((it) => String(it.type || "").toLowerCase() === t);
      } else {
        items = all;
      }
      if (items.length === 0) items = all;
    }

    if (currentPage > 1) return [];

    for (const item of items) {
      if (item && (item.url || item.hid)) {
        posts.push(mapMangaToPost(baseUrl, item));
      }
    }
  } catch (err: any) {
    if (err.name === "CanceledError" || err.name === "AbortError") throw err;
    console.error(`[${providerValue}] getPosts error:`, err.message || err);
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
    const currentPage = Math.max(1, page || 1);
    const q = (searchQuery || "").trim();
    if (!q) return posts;

    const browseUrl = `${baseUrl}/browse?keyword=${encodeURIComponent(q)}&page=${currentPage}`;
    const wvPosts = await fetchViaBrowseWebView(browseUrl, baseUrl, providerContext);
    if (wvPosts.length > 0) return wvPosts;

    if (currentPage > 1) return posts;

    // Fallback when openWebView is unavailable (e.g. local CLI tests)
    const res = await providerContext.axios.get(`${baseUrl}/`, {
      headers: {
        ...providerContext.commonHeaders,
        Accept: "text/html,application/xhtml+xml",
        Referer: baseUrl,
      },
      signal,
    });
    const html = typeof res.data === "string" ? res.data : "";
    const queries = parseInitialData(html);
    const all = collectAllHomeItems(queries);
    const lowerQ = q.toLowerCase();

    const matched = all.filter((item) => {
      const t = String(item.title || "").toLowerCase();
      if (t.includes(lowerQ)) return true;
      if (Array.isArray(item.altTitles)) {
        return item.altTitles.some((alt: any) => String(alt || "").toLowerCase().includes(lowerQ));
      }
      return false;
    });

    for (const item of matched) {
      posts.push(mapMangaToPost(baseUrl, item));
    }
  } catch (err: any) {
    if (err.name === "CanceledError" || err.name === "AbortError") throw err;
    console.error(`[${providerValue}] getSearchPosts error:`, err.message || err);
  }
  return posts;
};
