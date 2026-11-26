import { fetchPage, isTauri } from "./storage";
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

/**
 * Web/iPhone: a browser page may not read other websites, so the preview comes from Microlink
 * (a public link-preview service; it sees the link you paste, nothing else). Free, no account needed.
 */
async function loadViaService(url: string): Promise<LinkMeta> {
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
  const json = await res.json();
  if (json.status !== "success" || !json.data) throw new Error(json.message ?? "No preview");
  const d = json.data as {
    title?: string;
    description?: string;
    publisher?: string;
    url?: string;
    image?: { url?: string } | null;
    logo?: { url?: string } | null;
  };
  const final = d.url ?? url;
  return {
    title: clip(d.title ?? null, 160),
    description: clip(d.description ?? null, 280),
    image: abs(d.image?.url, final),
    siteName: clip(d.publisher ?? hostname(final), 60),
    favicon: abs(d.logo?.url, final),
  };
}

/**
 * A simple card built from the link itself, for when no preview is available (preview service's daily
 * limit reached, site blocks previews, offline): readable title from the address, the site's name
 * and its icon.
 */
export function basicMeta(url: string): LinkMeta {
  let title: string | null = null;
  let favicon: string | null = null;
  try {
    const u = new URL(url);
    favicon = `${u.origin}/favicon.ico`;
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    const words = last.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").trim();
    if (words && /[a-z]/i.test(words) && !/^\d+$/.test(words)) title = words.charAt(0).toUpperCase() + words.slice(1);
  } catch {}
  return { title: clip(title, 160), description: null, image: null, siteName: hostname(url), favicon };
}

async function load(url: string): Promise<LinkMeta> {
  if (!isTauri) return loadViaService(url);
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
