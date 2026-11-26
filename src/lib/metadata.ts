import { fetchPage } from "./storage";
import { hostname } from "./embeds";

export interface LinkMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

const cache = new Map<string, Promise<LinkMeta>>();

export function fetchLinkMeta(url: string): Promise<LinkMeta> {
  let p = cache.get(url);
  if (!p) {
    p = load(url);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

function abs(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function clip(s: string | null, n: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t || null;
}

async function load(url: string): Promise<LinkMeta> {
  const { html, final_url } = await fetchPage(url);
  const doc = new DOMParser().parseFromString(html, "text/html");

  const meta = (...selectors: string[]): string | null => {
    for (const s of selectors) {
      const v = doc.querySelector(s)?.getAttribute("content")?.trim();
      if (v) return v;
    }
    return null;
  };

  const title =
    meta('meta[property="og:title"]', 'meta[name="twitter:title"]') ??
    doc.querySelector("title")?.textContent?.trim() ??
    null;
  const description = meta(
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  );
  const image = abs(
    meta(
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ),
    final_url,
  );
  const siteName = meta('meta[property="og:site_name"]', 'meta[name="application-name"]') ?? hostname(final_url);
  const iconHref =
    doc.querySelector('link[rel="icon"][sizes="32x32"]')?.getAttribute("href") ??
    doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ??
    doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    "/favicon.ico";

  return {
    title: clip(title, 160),
    description: clip(description, 280),
    image,
    siteName: clip(siteName, 60),
    favicon: abs(iconHref, final_url),
  };
}
