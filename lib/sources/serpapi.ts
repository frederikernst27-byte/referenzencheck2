import type { Source } from "../types";
import { fetchJson, mapScholarItem, pickResultsArray, searchQuery } from "./util";

export const serpapi: Source = {
  name: "SERP API (Google Scholar)",
  enabled: () => !!process.env.SERPAPI_KEY,
  async search(ref) {
    const key = process.env.SERPAPI_KEY!;
    const q = searchQuery(ref);
    const url =
      `https://serpapi.com/search.json?engine=google_scholar&hl=en&num=5` +
      `&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetchJson(url);
    if (res?.error) return [];
    return pickResultsArray(res)
      .slice(0, 5)
      .map((it) => mapScholarItem(it, serpapi.name));
  },
};
