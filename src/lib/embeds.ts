export interface EmbedInfo {
  provider: "youtube" | "spotify";
  src: string;
  height: number | null;
  thumb: string | null;
}

const URL_RE = /^https?:\/\/[^\s<>"]+$/i;

export function isUrl(text: string): boolean {
  if (!URL_RE.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function parseYouTubeTime(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/** Recognises YouTube and Spotify links and returns their official embed player URL. */
export function parseEmbed(raw: string): EmbedInfo | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");

  // YouTube
  let ytId: string | null = null;
  if (host === "youtu.be") ytId = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") ytId = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
      if (m) ytId = m[1];
    }
  }
  if (ytId && /^[\w-]{6,}$/.test(ytId)) {
    const start = parseYouTubeTime(u.searchParams.get("t") || u.searchParams.get("start"));
    const params = new URLSearchParams({ rel: "0" });
    if (start) params.set("start", String(start));
    return {
      provider: "youtube",
      src: `https://www.youtube.com/embed/${ytId}?${params}`,
      height: null,
      thumb: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  // Spotify
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) {
      const [, type, id] = m;
      const compact = type === "track" || type === "episode";
      return {
        provider: "spotify",
        src: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`,
        height: compact ? 152 : 352,
        thumb: null,
      };
    }
  }
  return null;
}
