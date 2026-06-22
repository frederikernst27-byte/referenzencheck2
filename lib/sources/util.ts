import type { ParsedReference, SourceCandidate, SourceLink } from "../types";

export async function fetchJson(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 12000
): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": "Referenzencheck/1.0 (+https://referenzencheck.vercel.app)", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} von ${host}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Ungültige JSON-Antwort von ${host}`);
    }
  } finally {
    clearTimeout(t);
  }
}

export function extractYear(input: unknown): number | undefined {
  if (typeof input === "number" && input > 1500 && input < 2100) return input;
  if (typeof input !== "string") return undefined;
  const m = input.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : undefined;
}

/** Suchstring bevorzugt den extrahierten Titel, sonst den (gekürzten) Rohtext. */
export function searchQuery(ref: ParsedReference): string {
  if (ref.title && ref.title.trim().length >= 6) return ref.title.trim();
  return ref.raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Für bibliografische APIs (Crossref) ist der volle Rohtext oft am besten. */
export function bibliographicQuery(ref: ParsedReference): string {
  const raw = ref.raw?.replace(/\s+/g, " ").trim();
  if (raw && raw.length >= 12) return raw.slice(0, 400);
  return ref.title || raw || "";
}

export function uniqueLinks(links: SourceLink[]): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const l of links) {
    if (!l?.url) continue;
    const url = l.url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ label: l.label || url, url });
  }
  return out;
}

/** Autoren aus einer Google-Scholar "publication_info.summary" extrahieren. */
function authorsFromSummary(summary?: string): string[] | undefined {
  if (!summary) return undefined;
  const head = summary.split(" - ")[0];
  if (!head) return undefined;
  const authors = head.split(",").map((s) => s.trim()).filter(Boolean);
  return authors.length ? authors : undefined;
}

/**
 * Gemeinsamer Mapper für Google-Scholar-artige Ergebnisse aus SERP API,
 * SearchApi, ScraperAPI und Scrapingdog. Die Feldnamen unterscheiden sich
 * leicht, daher wird defensiv auf mehrere Varianten geprüft.
 */
export function mapScholarItem(it: any, source: string): SourceCandidate {
  const title: string | undefined = it.title || it.name;
  const summary: string | undefined =
    typeof it.publication_info === "string"
      ? it.publication_info
      : it.publication_info?.summary;

  const links: SourceLink[] = [];
  const mainLink = it.link || it.title_link || it.url || it.snippet_link;
  if (mainLink) links.push({ label: "Treffer (Google Scholar)", url: mainLink });

  const resources = it.resources || it.inline_links?.resources || it.file || [];
  if (Array.isArray(resources)) {
    for (const r of resources) {
      const u = r?.link || r?.url || r?.file_link || r?.file;
      if (u) links.push({ label: r?.title || r?.file_format || "PDF / Volltext", url: u });
    }
  }
  if (typeof it.pdf === "string") links.push({ label: "PDF", url: it.pdf });
  if (it.inline_links?.cached_page_link)
    links.push({ label: "Cache", url: it.inline_links.cached_page_link });

  return {
    source,
    matchedTitle: title,
    matchedAuthors: authorsFromSummary(summary) || it.authors,
    matchedYear: extractYear(summary) || extractYear(it.year),
    links: uniqueLinks(links),
  };
}

/** Findet ein Ergebnis-Array unter mehreren möglichen Feldnamen. */
export function pickResultsArray(res: any): any[] {
  const candidates = [
    res?.organic_results,
    res?.scholar_results,
    res?.results,
    res?.data,
    res?.papers,
  ];
  for (const c of candidates) if (Array.isArray(c) && c.length) return c;
  return [];
}
