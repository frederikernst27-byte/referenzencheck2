import type { Source } from "../types";
import { fetchJson, mapScholarItem, pickResultsArray, searchQuery } from "./util";

// ScrapingBee – Google Scholar via HTML-Scraping mit strukturierter Extraktion.
// Dient als Backup für die SERP API: Wenn diese ausfällt (z. B. Kontingent/
// Token aufgebraucht), greift die Verifizierungs-Kette automatisch hier.
//
// Statt einen HTML-Parser einzubinden, nutzen wir ScrapingBees `extract_rules`,
// die das Ergebnis serverseitig in JSON umwandeln. Die Feldnamen werden so
// gewählt, dass das Resultat in `pickResultsArray` (res.results) und
// `mapScholarItem` (title, link, publication_info) passt.
// Docs: https://www.scrapingbee.com/blog/how-to-scrape-google-scholar/
const EXTRACT_RULES = {
  results: {
    selector: "div.gs_ri",
    type: "list",
    output: {
      title: "h3.gs_rt",
      link: { selector: "h3.gs_rt a", output: "@href" },
      publication_info: "div.gs_a",
    },
  },
};

export const scrapingbee: Source = {
  name: "ScrapingBee (Google Scholar)",
  enabled: () => !!process.env.SCRAPINGBEE_KEY,
  async search(ref) {
    const key = process.env.SCRAPINGBEE_KEY!;
    const q = searchQuery(ref);
    const scholarUrl = `https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(q)}`;

    const url =
      `https://app.scrapingbee.com/api/v1/` +
      `?api_key=${encodeURIComponent(key)}` +
      `&url=${encodeURIComponent(scholarUrl)}` +
      // Google Scholar ist serverseitig gerendert -> render_js aus spart Credits.
      `&render_js=false` +
      // Hochwertige Residential-Proxies, sonst blockiert Google Scholar.
      `&premium_proxy=true` +
      `&country_code=de` +
      `&extract_rules=${encodeURIComponent(JSON.stringify(EXTRACT_RULES))}`;

    const res = await fetchJson(url, {}, 30000); // Scraper-APIs sind langsamer
    return pickResultsArray(res)
      .slice(0, 5)
      .map((it) => mapScholarItem(it, scrapingbee.name));
  },
};
