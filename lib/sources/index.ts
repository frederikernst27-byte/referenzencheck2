import type { Source } from "../types";
import { serpapi } from "./serpapi";
import { scraperapi } from "./scraperapi";
import { searchapi } from "./searchapi";
import { scrapingdog } from "./scrapingdog";
import { crossref } from "./crossref";
import { openalex } from "./openalex";
import { semanticscholar } from "./semanticscholar";

// Reihenfolge der Verifizierungs-Kette (vom Nutzer vorgegeben):
// SERP API -> ScraperAPI -> SearchApi -> Scrapingdog -> Crossref -> OpenAlex -> Semantic Scholar
const ALL_SOURCES: Source[] = [
  serpapi,
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
