import type { Source } from "../types";
import { serpapi } from "./serpapi";
import { scrapingbee } from "./scrapingbee";
import { scraperapi } from "./scraperapi";
import { searchapi } from "./searchapi";
import { scrapingdog } from "./scrapingdog";
import { crossref } from "./crossref";
import { openalex } from "./openalex";
import { semanticscholar } from "./semanticscholar";

// Reihenfolge der Verifizierungs-Kette (Kette stoppt beim ersten sicheren Treffer):
// SERP API -> ScrapingBee -> ScraperAPI -> SearchApi -> Scrapingdog
//   -> Crossref -> OpenAlex -> Semantic Scholar
// ScrapingBee steht direkt hinter der SERP API und springt als Backup ein,
// wenn diese ausfällt (z. B. Kontingent/Token aufgebraucht).
const ALL_SOURCES: Source[] = [
  serpapi,
  scrapingbee,
  scraperapi,
  searchapi,
  scrapingdog,
  crossref,
  openalex,
  semanticscholar,
];

/** Nur aktivierte Quellen, in der definierten Reihenfolge. */
export function sourceChain(): Source[] {
  return ALL_SOURCES.filter((s) => s.enabled());
}

export function allSourceNames(): string[] {
  return ALL_SOURCES.map((s) => s.name);
}
