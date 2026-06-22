import type { Source } from "../types";
import { fetchJson, mapScholarItem, pickResultsArray, searchQuery } from "./util";

// ScraperAPI bietet einen strukturierten Google-Scholar-Endpunkt.
// Docs: https://docs.scraperapi.com/  -> Structured Data / Google Scholar
export const scraperapi: Source = {
  name: "ScraperAPI (Google Scholar)",
  enabled: () => !!process.env.SCRAPERAPI_KEY,
  async search(ref) {
    const key = process.env.SCRAPERAPI_KEY!;
    const q = searchQuery(ref);
    const url =
      `https://api.scraperapi.com/structured/google/scholar` +
      `?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}`;
    const res = await fetchJson(url, {}, 30000); // Scraper-APIs sind langsamer
    return pickResultsArray(res)
      .slice(0, 5)
      .map((it) => mapScholarItem(it, scraperapi.name));
  },
};
