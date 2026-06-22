import type { Source, SourceCandidate, SourceLink } from "../types";
import { fetchJson, searchQuery, uniqueLinks } from "./util";

function mapPaper(item: any): SourceCandidate {
  const authors: string[] | undefined = Array.isArray(item.authors)
    ? item.authors.map((a: any) => a?.name).filter(Boolean)
    : undefined;

  const links: SourceLink[] = [];
  if (item.url) links.push({ label: "Semantic Scholar", url: item.url });
  if (item.externalIds?.DOI)
    links.push({ label: "DOI", url: `https://doi.org/${item.externalIds.DOI}` });
  if (item.externalIds?.ArXiv)
    links.push({ label: "arXiv", url: `https://arxiv.org/abs/${item.externalIds.ArXiv}` });
  if (item.openAccessPdf?.url)
    links.push({ label: "Open-Access-PDF", url: item.openAccessPdf.url });

  return {
    source: "Semantic Scholar",
    matchedTitle: item.title,
    matchedAuthors: authors,
    matchedYear: typeof item.year === "number" ? item.year : undefined,
    doi: item.externalIds?.DOI,
    links: uniqueLinks(links),
  };
}

export const semanticscholar: Source = {
  name: "Semantic Scholar",
  enabled: () => true, // funktioniert auch ohne Key (mit niedrigeren Limits)
  async search(ref) {
    const key = process.env.SEMANTIC_SCHOLAR_KEY;
    const q = searchQuery(ref);
    const fields = "title,year,authors,externalIds,url,openAccessPdf";
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search` +
      `?query=${encodeURIComponent(q)}&limit=3&fields=${fields}`;
    try {
      const res = await fetchJson(url, key ? { headers: { "x-api-key": key } } : {});
      const items: any[] = res?.data || [];
      return items.slice(0, 3).map(mapPaper);
    } catch {
      // Häufig 429 (Rate Limit) ohne Key – leise überspringen.
      return [];
    }
  },
};
