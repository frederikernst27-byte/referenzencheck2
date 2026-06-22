import type { Source } from "../types";
import { fetchJson, mapScholarItem, pickResultsArray, searchQuery } from "./util";

// Scrapingdog – Google Scholar API.
// Docs: https://docs.scrapingdog.com/google-scholar-scraper-api
export const scrapingdog: Source = {
  name: "Scrapingdog (Google Scholar)",
  enabled: () => !!process.env.SCRAPINGDOG_KEY,
  async search(ref) {
    const key = process.env.SCRAPINGDOG_KEY!;
    const q = searchQuery(ref);
    const url =
      `https://api.scrapingdog.com/google_scholar` +
      `?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&language=en&page=0`;
    const res = await fetchJson(url, {}, 30000);
    return pickResultsArray(res)
      .slice(0, 5)
      .map((it) => mapScholarItem(it, scrapingdog.name));
  },
};
