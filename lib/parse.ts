import type { ParsedReference } from "./types";
import { hasOpenRouter, openRouterChat, safeJsonParse } from "./openrouter";

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/;

function extractDoi(s: string): string | undefined {
  const m = s.match(DOI_RE);
  return m ? m[0].replace(/[).,;]+$/, "") : undefined;
}

function makeId(i: number): string {
  return `ref-${i + 1}`;
}

/** Heuristische Zerlegung eines Literaturverzeichnisses in einzelne Einträge. */
export function heuristicSplit(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  // 1) Nummerierte Einträge: [1] ... / 1. ... / (1) ...
  const enumerated = cleaned.split(/\n(?=\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+)/);
  if (enumerated.length > 1) {
    return enumerated
      .map((e) => e.replace(/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/, "").replace(/\s+/g, " ").trim())
      .filter((e) => e.length >= 8);
  }

  // 2) Durch Leerzeilen getrennte Blöcke
  const blocks = cleaned.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (blocks.length > 1) return blocks.filter((b) => b.length >= 8);

  // 3) Eine Referenz pro Zeile
  return cleaned
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 8);
}

export function heuristicParse(text: string): ParsedReference[] {
  return heuristicSplit(text).map((raw, i) => ({
    id: makeId(i),
    raw,
    doi: extractDoi(raw),
  }));
}

const SYSTEM_PROMPT =
  "Du bist ein präziser Parser für wissenschaftliche Literaturverzeichnisse. " +
  "Du zerlegst Text in einzelne bibliografische Einträge und extrahierst deren Felder. " +
  "Antworte ausschließlich mit gültigem JSON, ohne Erklärungen.";

function buildUserPrompt(text: string): string {
  return (
    "Zerlege das folgende Literaturverzeichnis in einzelne Referenzen. " +
    "Gib NUR JSON in genau dieser Form zurück:\n" +
    '{"references":[{"raw":"<vollständiger Originaltext der Referenz>","title":"<Titel der Arbeit oder \\"\\">","authors":["<Autor>"],"year":<Jahr als Zahl oder null>,"doi":"<DOI oder \\"\\">","venue":"<Journal/Konferenz/Verlag oder \\"\\">"}]}\n' +
    "Regeln:\n" +
    "- Nur echte bibliografische Quellen aufnehmen (keine Überschriften, Seitenzahlen, Fließtext).\n" +
    "- 'raw' möglichst originalgetreu übernehmen.\n" +
    "- 'title' nur der Werktitel, ohne Autoren/Journal/Jahr.\n" +
    "- Wenn ein Feld fehlt: leerer String bzw. null.\n\n" +
    "Text:\n\"\"\"\n" +
    text +
    "\n\"\"\""
  );
}

interface LlmRef {
  raw?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  doi?: string;
  venue?: string;
}

async function llmParse(text: string): Promise<ParsedReference[]> {
  const content = await openRouterChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(text) },
    ],
    { json: true, temperature: 0 }
  );
  const data = safeJsonParse<{ references?: LlmRef[] }>(content);
  const refs = Array.isArray(data?.references) ? data.references : [];

  const mapped: ParsedReference[] = refs
    .map((r, i): ParsedReference | null => {
      const raw = (r.raw || "").trim();
      if (!raw || raw.length < 6) return null;
      const title = (r.title || "").trim() || undefined;
      const authors = Array.isArray(r.authors)
        ? r.authors.map((a) => String(a).trim()).filter(Boolean)
        : undefined;
      const year =
        typeof r.year === "number" && r.year > 1500 && r.year < 2100 ? r.year : undefined;
      const doi = (r.doi || "").trim() || extractDoi(raw);
      const venue = (r.venue || "").trim() || undefined;
      return {
        id: makeId(i),
        raw,
        title,
        authors: authors && authors.length ? authors : undefined,
        year,
        doi: doi || undefined,
        venue,
      };
    })
    .filter((x): x is ParsedReference => x !== null);

  if (!mapped.length) throw new Error("LLM lieferte keine verwertbaren Referenzen");
  return mapped;
}

export async function parseReferences(text: string): Promise<ParsedReference[]> {
  if (hasOpenRouter()) {
    try {
      return await llmParse(text);
    } catch {
      // Fällt auf die Heuristik zurück, wenn das LLM nicht erreichbar ist.
    }
  }
  return heuristicParse(text);
}
