import type { Source, SourceCandidate, SourceLink } from "../types";
import { fetchJson, searchQuery, uniqueLinks } from "./util";

function mapWork(item: any): SourceCandidate {
  const title: string | undefined = item.title || item.display_name;
  const authors: string[] | undefined = Array.isArray(item.authorships)
    ? item.authorships.map((a: any) => a?.author?.display_name).filter(Boolean)
    : undefined;

  const links: SourceLink[] = [];
  if (item.doi) links.push({ label: "DOI", url: item.doi }); // OpenAlex liefert die volle doi.org-URL
  if (item.primary_location?.landing_page_url)
    links.push({ label: "Verlagsseite", url: item.primary_location.landing_page_url });
  const oaPdf = item.best_oa_location?.pdf_url || item.open_access?.oa_url;
  if (oaPdf) links.push({ label: "Open-Access-PDF", url: oaPdf });
  if (item.id) links.push({ label: "OpenAlex", url: item.id });

  return {
    source: "OpenAlex",
    matchedTitle: title,
    matchedAuthors: authors,
    matchedYear: typeof item.publication_year === "number" ? item.publication_year : undefined,
    doi: item.doi,
    links: uniqueLinks(links),
  };
}

export const openalex: Source = {
  name: "OpenAlex",
  enabled: () => true, // kostenlos, kein Key nötig
  async search(ref) {
    const mailto = process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO;
    const mailtoParam = mailto ? `&mailto=${encodeURIComponent(mailto)}` : "";
    const q = searchQuery(ref);
    const res = await fetchJson(
      `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=3${mailtoParam}`
    );
    const items: any[] = res?.results || [];
    return items.slice(0, 3).map(mapWork);
  },
};
