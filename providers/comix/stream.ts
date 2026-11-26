import { ProviderContext, Stream } from "../types";

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

function buildChapterImagesWebViewJs(): string {
  return `(function(){
    var tries = 0;
    var poll = function() {
      tries++;
      try {
        var out = [];
        var root = document.getElementById('app-root');
        var el = document.querySelector('.rpage-page') || (root ? root.firstElementChild : null);
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
            var queries = qc.getQueryCache().getAll();
            for (var qi = 0; qi < queries.length; qi++) {
              var q = queries[qi];
              if (Array.isArray(q.queryKey) && q.queryKey[0] === 'chapters' && q.queryKey[1] === 'detail' && q.state && q.state.data) {
                var data = q.state.data;
                var keys = Object.keys(data);
                for (var ki = 0; ki < keys.length; ki++) {
                  var arr = data[keys[ki]];
                  if (Array.isArray(arr) && arr.length > 0 && arr[0] && typeof arr[0] === 'object') {
                    var hasHttp = Object.values(arr[0]).some(function(val){ return typeof val === 'string' && val.indexOf('http') === 0; });
                    if (hasHttp) {
                      for (var ai = 0; ai < arr.length; ai++) {
                        var item = arr[ai];
                        if (typeof item.RT === 'string' && item.RT.indexOf('http') === 0) {
                          out.push(item.RT);
                        } else {
                          var vals = Object.values(item);
                          for (var vi = 0; vi < vals.length; vi++) {
                            if (typeof vals[vi] === 'string' && vals[vi].indexOf('http') === 0) { out.push(vals[vi]); break; }
                          }
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (out.length > 0) break;
            }
          }
        }
        if (out.length === 0 && tries >= 12) {
          var imgs = document.querySelectorAll('img.rpage-page__img');
          for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].currentSrc || imgs[i].getAttribute('src') || '';
            if (src && src.indexOf('http') === 0 && out.indexOf(src) === -1) out.push(src);
          }
        }
        if (out.length > 0 || tries >= 22) {
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

export const getStream = async function ({
  link,
  providerContext,
}: {
  link: string;
  type?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const streams: Stream[] = [];
  try {
    const baseUrl = await resolveBaseUrl(providerContext);
    const chapterUrl = link.startsWith("http")
      ? link
      : `${baseUrl}${link.startsWith("/") ? "" : "/"}${link}`;

    if (providerContext.openWebView) {
      try {
        const wvRes = await providerContext.openWebView(chapterUrl, {
          title: "Extracting Chapter Pages",
          timeoutMs: 20000,
          injectedJavaScript: buildChapterImagesWebViewJs(),
        });

        if (wvRes && wvRes.data && typeof wvRes.data === "string" && wvRes.data.trim().startsWith("[")) {
          const urls = JSON.parse(wvRes.data);
          if (Array.isArray(urls)) {
            const ua =
              wvRes.userAgent ||
              providerContext.commonHeaders?.["User-Agent"] ||
              "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";

            for (let i = 0; i < urls.length; i++) {
              const imgUrl = urls[i];
              if (typeof imgUrl === "string" && imgUrl.startsWith("http")) {
                streams.push({
                  server: `Page ${i + 1}`,
                  link: imgUrl,
                  type: "image",
                  // Omit Referer: comix.to image CDN rejects Referer with 403
                  headers: {
                    "User-Agent": ua,
                    Accept: "image/webp,image/png,image/jpeg,*/*;q=0.8",
                  },
                });
              }
            }
          }
        }
      } catch (e) {}
    }

    // Fallback when openWebView is unavailable (e.g. local CLI tests)
    if (streams.length === 0) {
      streams.push({
        server: "Comix Web Reader",
        link: chapterUrl,
        type: "webview",
        headers: {
          "User-Agent": providerContext.commonHeaders?.["User-Agent"] || "Mozilla/5.0",
        },
      });
    }
  } catch (err: any) {
    console.error("[comix] getStream error:", err.message || err);
  }
  return streams;
};
