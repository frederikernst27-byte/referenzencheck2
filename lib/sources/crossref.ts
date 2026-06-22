import type { Source, SourceCandidate, SourceLink } from "../types";
import { bibliographicQuery, extractYear, fetchJson, uniqueLinks } from "./util";
import { normalizeDoi } from "../similarity";

function mapWork(item: any): SourceCandidate {
  const title: string | undefined = Array.isArray(item.title) ? item.title[0] : item.title;
  const authors: string[] | undefined = Array.isArray(item.author)
    ? item.author
        .map((a: any) => [a.given, a.family].filter(Boolean).join(" ").trim())
        .filter(Boolean)
    : undefined;
  const year =
    item?.issued?.["date-parts"]?.[0]?.[0] ??
    item?.published?.["date-parts"]?.[0]?.[0] ??
    extractYear(item?.created?.["date-time"]);

  const links: SourceLink[] = [];
  if (item.DOI) links.push({ label: "DOI", url: `https://doi.org/${item.DOI}` });
  if (item.URL && normalizeDoi(item.URL) !== normalizeDoi(item.DOI))
    links.push({ label: "Verlagsseite", url: item.URL });
  if (Array.isArray(item.link)) {
    for (const l of item.link) if (l?.URL) links.push({ label: "Volltext", url: l.URL });
  }

  return {
    source: "Crossref",
    matchedTitle: title,
    matchedAuthors: authors,
    matchedYear: typeof year === "number" ? year : undefined,
    doi: item.DOI,
    links: uniqueLinks(links),
  };
}

export const crossref: Source = {
  name: "Crossref",
  enabled: () => true, // kostenlos, kein Key nötig
  async search(ref) {
    const mailto = process.env.CROSSREF_MAILTO ? `&mailto=${encodeURIComponent(process.env.CROSSREF_MAILTO)}` : "";

    // 1) Direkter, sehr zuverlässiger DOI-Lookup, falls eine DOI vorhanden ist.
    if (ref.doi) {
      try {
        const res = await fetchJson(
          `https://api.crossref.org/works/${encodeURIComponent(normalizeDoi(ref.doi))}?` + mailto.replace(/^&/, "")
        );
        if (res?.message) return [mapWork(res.message)];
      } catch {
        /* fällt auf die bibliografische Suche zurück */
      }
    }

    // 2) Bibliografische Suche über den gesamten Referenztext.
    const q = bibliographicQuery(ref);
    const res = await fetchJson(
      `https://api.crossref.org/works?rows=3&query.bibliographic=${encodeURIComponent(q)}${mailto}`
    );
    const items: any[] = res?.message?.items || [];
    return items.slice(0, 3).map(mapWork);
  },
};
