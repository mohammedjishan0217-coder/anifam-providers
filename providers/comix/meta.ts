import { Info, Link, ProviderContext } from "../types";

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

function parseDetailFromHtml(html: string): any {
  try {
    const match = html.match(/<script[^>]*id=["']initial-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match || !match[1]) return null;
    const parsed = JSON.parse(match[1]);
    const queries = parsed?.queries || {};
    for (const k of Object.keys(queries)) {
      if (k.startsWith('["manga","detail"')) {
        return queries[k];
      }
    }
  } catch (e) {}
  return null;
}

function buildChaptersWebViewJs(hid: string): string {
  return `(function(){
    var tries = 0;
    var poll = function() {
      tries++;
      try {
        var out = [];
        var seen = {};
        var add = function(url, label, num) {
          if (!url) return;
          var clean = url.split('#')[0];
          var full = clean.indexOf('http') === 0 ? clean : (location.origin + clean);
          if (seen[full]) return;
          seen[full] = true;
          out.push({ title: label || 'Chapter', link: full, number: typeof num === 'number' ? num : 0 });
        };
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
            for (var qi = 0; qi < qs.length; qi++) {
              var q = qs[qi];
              if (Array.isArray(q.queryKey) && q.queryKey[0] === 'manga' && q.queryKey[1] === 'chapters' && (!${JSON.stringify(hid)} || q.queryKey[2] === ${JSON.stringify(hid)}) && q.state && q.state.data && Array.isArray(q.state.data.Fw)) {
                var arr = q.state.data.Fw;
                for (var ai = 0; ai < arr.length; ai++) {
                  var c = arr[ai];
                  if (c && c.RT) {
                    var lbl = 'Ch.' + (c.hH != null ? c.hH : '') + (c.Zl ? ' - ' + c.Zl : '');
                    add(c.RT, lbl, Number(c.hH || 0));
                  }
                }
              }
            }
          }
        }
        if (out.length === 0 && tries >= 8) {
          var links = document.querySelectorAll('a[href*="/title/"]');
          for (var li = 0; li < links.length; li++) {
            var href = links[li].getAttribute('href');
            if (!href) continue;
            var segs = href.split('#')[0].split('/').filter(Boolean);
            if (segs.length >= 3) {
              var txt = (links[li].textContent || '').replace(/\\s+/g, ' ').trim();
              var m = (txt + ' ' + href).match(/(\\d+(?:\\.\\d+)?)/);
              add(href, txt || segs[2], m ? parseFloat(m[1]) : 0);
            }
          }
        }
        if (out.length > 0 || tries >= 16) {
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

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  provider?: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const fullLink = formatUrl(baseUrl, link);

    const res = await providerContext.axios.get(fullLink, {
      headers: {
        ...providerContext.commonHeaders,
        Accept: "text/html,application/xhtml+xml",
        Referer: baseUrl,
      },
    });

    const html = typeof res.data === "string" ? res.data : "";
    const detail = parseDetailFromHtml(html) || {};

    const title = detail.title || "Untitled Comic";
    const synopsis = detail.synopsis || "";
    const image =
      formatUrl(baseUrl, detail.poster?.large || detail.poster?.medium) ||
      `${baseUrl}/assets/uploads/35595e3de3c99889c1bd2c56f3e3714fc0c457.png`;

    const tags: string[] = [];
    if (detail.type) tags.push(String(detail.type).toUpperCase());
    if (Array.isArray(detail.genres)) {
      for (const g of detail.genres) {
        if (g && g.title) tags.push(g.title);
      }
    }

    const cast: string[] = [];
    for (const group of [detail.authors, detail.artists]) {
      if (Array.isArray(group)) {
        for (const a of group) {
          if (a && a.title) cast.push(a.title);
        }
      }
    }

    let chapters: { title: string; link: string; number: number }[] = [];
    if (providerContext.openWebView) {
      try {
        const wvRes = await providerContext.openWebView(fullLink, {
          title: `Loading Chapters: ${title}`,
          timeoutMs: 15000,
          injectedJavaScript: buildChaptersWebViewJs(detail.hid || ""),
        });
        if (wvRes && wvRes.data && typeof wvRes.data === "string" && wvRes.data.trim().startsWith("[")) {
          const parsed = JSON.parse(wvRes.data);
          if (Array.isArray(parsed)) {
            chapters = parsed.filter((c: any) => c && c.link);
          }
        }
      } catch (e) {}
    }

    // SSR fallback if openWebView is unavailable (e.g. local CLI tests)
    if (chapters.length === 0) {
      if (detail.firstChapterUrl) {
        chapters.push({
          title: "Chapter 1",
          link: formatUrl(baseUrl, detail.firstChapterUrl),
          number: 1,
        });
      }
      if (detail.latestChapterUrl && detail.latestChapterUrl !== detail.firstChapterUrl) {
        chapters.push({
          title: detail.latestChapter ? `Chapter ${detail.latestChapter}` : "Latest Chapter",
          link: formatUrl(baseUrl, detail.latestChapterUrl),
          number: Number(detail.latestChapter || 9999),
        });
      }
    }

    const orderPref = await providerContext.kvStore?.get<string>("chapterOrder");
    chapters.sort((a, b) => (orderPref === "desc" ? b.number - a.number : a.number - b.number));

    const linkList: Link[] = [];
    if (chapters.length > 0) {
      linkList.push({
        title: "Chapters",
        directLinks: chapters.map((ch) => ({
          title: ch.title,
          link: ch.link,
          type: "series",
        })),
      });
    }

    return {
      title,
      synopsis,
      image,
      poster: image,
      imdbId: detail.hid ? `comix:${detail.hid}` : "",
      type: "series",
      rating: detail.ratedAvg ? String(detail.ratedAvg) : undefined,
      tags: tags.length > 0 ? tags : undefined,
      cast: cast.length > 0 ? cast : undefined,
      webUrl: fullLink,
      linkList,
    };
  } catch (err: any) {
    console.error("[comix] getMeta error:", err.message || err);
    return {
      title: "Error Loading Comic",
      synopsis: "",
      image: "",
      imdbId: "",
      type: "series",
      linkList: [],
    };
  }
};
