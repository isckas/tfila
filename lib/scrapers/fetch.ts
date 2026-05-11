const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  ok: boolean;
}

export async function fetchHtml(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const ua = process.env.SCRAPER_USER_AGENT || DEFAULT_UA;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const html = res.ok ? await res.text() : "";
    return {
      url,
      finalUrl: res.url,
      status: res.status,
      html,
      ok: res.ok,
    };
  } finally {
    clearTimeout(timer);
  }
}
