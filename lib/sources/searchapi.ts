import type { Source } from "../types";
import { fetchJson, mapScholarItem, pickResultsArray, searchQuery } from "./util";

// SearchApi.io – Google Scholar Engine.
// Docs: https://www.searchapi.io/docs/google-scholar
export const searchapi: Source = {
  name: "SearchApi (Google Scholar)",
  enabled: () => !!process.env.SEARCHAPI_KEY,
  async search(ref) {
    const key = process.env.SEARCHAPI_KEY!;
    const q = searchQuery(ref);
    const url =
      `https://www.searchapi.io/api/v1/search?engine=google_scholar` +
      `&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetchJson(url);
    return pickResultsArray(res)
      .slice(0, 5)
      .map((it) => mapScholarItem(it, searchapi.name));
  },
};
