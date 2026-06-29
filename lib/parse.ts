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

function parseModel(): string | undefined {
  return process.env.OPENROUTER_PARSE_MODEL || process.env.OPENROUTER_MODEL || undefined;
}

// Überschriften und reine Strukturzeilen, die keine Referenz sind.
const HEADING_RE =
  /^(references?|bibliography|literatur(verzeichnis)?|works\s+cited|quellen(verzeichnis)?|reference\s+list)\s*:?\s*$/i;
const PAGE_ONLY_RE = /^\s*(seite|page|p\.?)?\s*\d{1,4}\s*$/i;
const YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/;
// Beginn eines neuen Eintrags: Enumerator oder "[Präfix] Nachname," am Zeilenanfang.
// Das optionale Kleinbuchstaben-Präfix deckt Namen wie "vom Brocke", "van der
// Aalst", "von", "de", "zur Muehlen" ab, die sonst (Großbuchstaben-Erwartung)
// fälschlich als Folgezeile gewertet würden.
// Ein neuer Eintrag beginnt, wenn die Zeile mit einem dieser Muster startet:
//  - Enumerator: [1] / (1) / 1.
//  - "[Präfix] Nachname,"  (z. B. "vom Brocke,", "van der Aalst,")
//  - Initialen-Autor:      "S. Alam"  (Großbuchstabe + Punkt + Name)
//  - Ausgeschriebener Autorenblock: "Jesper Andersson.", "Karl E. Weick.",
//    "Sabine Brunswicker, …", "Tomasz Lelek and …" – 1–3 Vornamen/Initialen
//    gefolgt von einem Nachnamen, der mit ‘,’ ‘.’ oder ‘ and ‘ endet.
const REF_START_RE =
  /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)]\s|(?:[a-zäöü]{1,5}\s+){0,2}\p{Lu}[\p{L}’’.-]+,|\p{Lu}\.\s+\p{Lu}|(?:\p{Lu}[\p{L}’’.-]*\s+){1,3}\p{Lu}[\p{L}’’-]+(?:[,.]|\s+and\b))/u;

function isHeading(s: string): boolean {
  return HEADING_RE.test(s.trim());
}

/** CRLF normalisieren und am Zeilenende getrennte Wörter wieder zusammenführen. */
function dewrap(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/(\p{L})-\n(\p{L})/gu, "$1$2");
}

// Eigene Zeile, die nur aus einer Literaturverzeichnis-Überschrift besteht.
const REFERENCES_SECTION_RE =
  /^[\s>#*•\-]*(references?|bibliography|literatur(verzeichnis)?|works\s+cited|quellen(verzeichnis)?|reference\s+list|bibliografie|literature\s+cited)\s*:?\s*$/i;

/**
 * Schneidet aus einem (ggf. vollständigen PDF-/Dokument-)Text den
 * Literaturverzeichnis-Abschnitt heraus. Sucht die erste eigenständige
 * Überschrift ("References", "Literaturverzeichnis" …) und gibt alles ab da
 * zurück. Wird keine gefunden, bleibt der Text unverändert.
 */
// Inline-Überschrift mitten im Fließtext (PDF), direkt gefolgt vom Beginn der
// nummerierten Referenzliste ("References 1. …" / "Bibliography [1] …").
const REFERENCES_INLINE_RE =
  /\b(?:references|bibliography|literatur(?:verzeichnis)?|works\s+cited|quellen(?:verzeichnis)?|reference\s+list|bibliografie)\b\s*[:.]?\s+(?=(?:\[?1\]?[.)]\s)|(?:\(1\)\s))/i;

export function extractReferencesSection(text: string): string {
  const norm = dewrap(text).replace(/\r/g, "");

  // 1) Saubere Eingabe: Überschrift steht auf einer eigenen Zeile.
  const lines = norm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (REFERENCES_SECTION_RE.test(lines[i].trim())) {
      const rest = lines.slice(i + 1).join("\n").trim();
      // Nur übernehmen, wenn danach noch substanzieller Text folgt (sonst war
      // es z. B. nur eine Kopfzeile/ein Inhaltsverzeichnis-Eintrag).
      if (rest.length >= 40) return rest;
    }
  }

  // 2) PDF-Fließtext: Überschrift steht inline, direkt gefolgt von "1."/"[1]".
  const inline = norm.match(REFERENCES_INLINE_RE);
  if (inline && inline.index !== undefined) {
    const after = norm.slice(inline.index + inline[0].length).trim();
    if (after.length >= 40) return after;
  }

  return norm.trim();
}

function stripEnumerator(e: string): string {
  return e
    .replace(/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristische Zerlegung eines Literaturverzeichnisses in einzelne Einträge. */
export function heuristicSplit(text: string): string[] {
  const cleaned = dewrap(text).trim();
  if (!cleaned) return [];

  // 1) Nummerierte Einträge: [1] ... / 1. ... / (1) ...  (starkes Signal)
  const enumerated = cleaned.split(/\n(?=\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+)/);
  if (enumerated.length > 1) {
    return enumerated.map(stripEnumerator).filter((e) => e.length >= 8 && !isHeading(e));
  }

  // 2) Durch Leerzeilen getrennte Blöcke
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks.filter((b) => b.length >= 8 && !isHeading(b));

  // 3) Zeilenbasiert mit Grenzerkennung: umgebrochene Folgezeilen wieder anhängen.
  const lines = cleaned
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: string[] = [];
  let buf = "";
  for (const line of lines) {
    if (isHeading(line) || PAGE_ONLY_RE.test(line)) continue;
    const looksNew = REF_START_RE.test(line);
    if (buf && looksNew && YEAR_RE.test(buf)) {
      entries.push(buf);
      buf = line;
    } else if (!buf) {
      buf = line;
    } else {
      buf += " " + line;
    }
  }
  if (buf) entries.push(buf);

  const result = entries
    .map((e) => e.replace(/\s+/g, " ").trim())
    .filter((e) => e.length >= 8 && !isHeading(e));

  // Notfall: Grenzerkennung hat alles zusammengezogen → pro Zeile zerlegen.
  if (result.length <= 1 && lines.length > 3) {
    return lines.filter((l) => l.length >= 8 && !isHeading(l) && !PAGE_ONLY_RE.test(l));
  }
  return result;
}

export function heuristicParse(text: string): ParsedReference[] {
  return heuristicSplit(text).map((raw, i) => ({
    id: makeId(i),
    raw,
    doi: extractDoi(raw),
  }));
}

interface LlmRef {
  raw?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  doi?: string;
  venue?: string;
}

function mapLlmRef(r: LlmRef, i: number, forceRaw?: string): ParsedReference | null {
  const raw = (forceRaw ?? r.raw ?? "").trim();
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
}

const SYSTEM_PROMPT =
  "Du bist ein präziser Parser für wissenschaftliche Literaturverzeichnisse. " +
  "Der Eingabetext stammt häufig aus einem PDF und kann den GESAMTEN Aufsatz enthalten. " +
  "Du findest zuerst den Literaturverzeichnis-Abschnitt, zerlegst ihn in einzelne " +
  "bibliografische Einträge und extrahierst deren Felder. " +
  "Antworte ausschließlich mit gültigem JSON, ohne Erklärungen.";

function buildUserPrompt(text: string): string {
  return (
    "Der folgende Text stammt aus einem Dokument oder PDF und kann den GESAMTEN " +
    "Aufsatz enthalten (Titelseite, Abstract, Fließtext, Fußnoten, Tabellen). " +
    "Extrahiere daraus das vollständige Literaturverzeichnis.\n" +
    "Gib NUR JSON in genau dieser Form zurück:\n" +
    '{"references":[{"raw":"<vollständiger Originaltext der Referenz>","title":"<Titel der Arbeit oder \\"\\">","authors":["<Autor>"],"year":<Jahr als Zahl oder null>,"doi":"<DOI oder \\"\\">","venue":"<Journal/Konferenz/Verlag oder \\"\\">"}]}\n' +
    "WICHTIGE Regeln:\n" +
    "- Finde ZUERST den Beginn des Literaturverzeichnisses (Überschrift wie 'References', " +
    "'Literaturverzeichnis', 'Bibliography', 'Works Cited', 'Quellenverzeichnis'). " +
    "Ignoriere ALLES davor (Titel, Abstract, Fließtext) sowie In-Text-Zitate im Fließtext " +
    "(z. B. '(Müller 2020)', '[12]'), Kopf-/Fußzeilen und reine Seitenzahlen.\n" +
    "- Extrahiere JEDEN Eintrag des Literaturverzeichnisses vollständig – auch bei 50 oder " +
    "mehr Referenzen darf KEINE fehlen oder abgeschnitten werden.\n" +
    "- Eine Referenz ist häufig über MEHRERE Zeilen umgebrochen. " +
    "Führe alle zu einem Eintrag gehörenden Zeilen wieder zusammen, sodass jede Referenz EINEN vollständigen Eintrag ergibt.\n" +
    "- Entferne am Zeilenende durch Silbentrennung getrennte Wörter (z. B. 'maxi-\\nmum' → 'maximum', 'manage-\\nment' → 'management').\n" +
    "- 'raw' enthält den vollständigen, wieder zusammengeführten Eintrag als EINE Zeile (keine Zeilenumbrüche), " +
    "optimiert für die Suche bei Google Scholar und Crossref (vollständiger Titel, Autoren, Jahr).\n" +
    "- 'title' ist nur der Werktitel, ohne Autoren/Journal/Jahr.\n" +
    "- Erfinde nichts. Wenn ein Feld fehlt: leerer String bzw. null.\n\n" +
    "Text:\n\"\"\"\n" +
    text +
    "\n\"\"\""
  );
}

async function llmParse(text: string, apiKey?: string): Promise<ParsedReference[]> {
  const content = await openRouterChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(text) },
    ],
    { json: true, temperature: 0, maxTokens: 16000, model: parseModel(), apiKey }
  );
  const data = safeJsonParse<{ references?: LlmRef[] }>(content);
  const refs = Array.isArray(data?.references) ? data.references : [];

  const mapped = refs
    .map((r, i) => mapLlmRef(r, i))
    .filter((x): x is ParsedReference => x !== null);

  if (!mapped.length) throw new Error("LLM lieferte keine verwertbaren Referenzen");
  return mapped;
}

export async function parseReferences(text: string, apiKey?: string): Promise<ParsedReference[]> {
  // Bei ganzen PDFs/Dokumenten zuerst den Literaturverzeichnis-Abschnitt isolieren.
  const section = extractReferencesSection(text);
  // Sicherheitskappung für sehr lange Eingaben (z. B. PDF ohne klare Überschrift),
  // hält Token-Verbrauch und Kosten im Rahmen.
  const input = section.length > 50000 ? section.slice(0, 50000) : section;

  if (hasOpenRouter(apiKey)) {
    try {
      return await llmParse(input, apiKey);
    } catch {
      // Fällt auf die Heuristik zurück, wenn das LLM nicht erreichbar/fehlerhaft ist.
    }
  }
  return heuristicParse(input);
}

// ---- Normalisierungs-Modus: Referenzen in einheitliches Suchformat bringen ----

const NORMALIZE_SYSTEM =
  "Du bist ein Experte für wissenschaftliche Literaturangaben. " +
  "Du normalisierst bibliografische Einträge in ein einheitliches, " +
  "maschinenlesbares Format, das für Datenbanksuchen (Google Scholar, Crossref, " +
  "OpenAlex, Semantic Scholar) optimiert ist. " +
  "Antworte ausschließlich mit gültigem JSON, ohne Erklärungen.";

function buildNormalizePrompt(refs: ParsedReference[]): string {
  const entries = refs.map((r, i) => ({
    index: i,
    raw: r.raw,
    title: r.title || "",
    authors: r.authors || [],
    year: r.year || null,
    doi: r.doi || "",
    venue: r.venue || "",
  }));
  return (
    "Normalisiere jeden der folgenden bibliografischen Einträge in das Format:\n" +
    "Nachname, V., Nachname2, V2. (Jahr). Vollständiger Titel der Arbeit. " +
    "Zeitschrift/Konferenz, Band(Heft), Seiten. DOI falls vorhanden.\n\n" +
    "Regeln:\n" +
    "- Behalte den vollständigen, korrekten Werktitel – dies ist das wichtigste Suchfeld.\n" +
    "- Autoren im Format 'Nachname, Vorname-Initial.' – maximal alle Autoren, kein 'et al.'.\n" +
    "- Jahr in runden Klammern direkt nach den Autoren.\n" +
    "- Erfinde keine Informationen, die nicht im Original stehen.\n" +
    "- 'normalized' enthält den vollständig formatierten Eintrag als eine Zeile.\n" +
    "- Behalte Reihenfolge und Anzahl exakt bei.\n\n" +
    'Gib NUR JSON zurück: {"references":[{"index":0,"normalized":"..."}]}\n\n' +
    "Einträge:\n" +
    JSON.stringify(entries)
  );
}

export async function normalizeReferences(
  refs: ParsedReference[],
  apiKey?: string
): Promise<ParsedReference[]> {
  if (!refs.length) return refs;
  if (!hasOpenRouter(apiKey)) return refs;

  try {
    const content = await openRouterChat(
      [
        { role: "system", content: NORMALIZE_SYSTEM },
        { role: "user", content: buildNormalizePrompt(refs) },
      ],
      { json: true, temperature: 0, maxTokens: 6000, model: parseModel(), apiKey }
    );
    const data = safeJsonParse<{ references?: { index: number; normalized: string }[] }>(content);
    const normalized = Array.isArray(data?.references) ? data.references : [];

    return refs.map((ref, i) => {
      const hit = normalized.find((n) => n.index === i);
      const newRaw = hit?.normalized?.trim();
      return newRaw && newRaw.length >= 10 ? { ...ref, raw: newRaw } : ref;
    });
  } catch {
    return refs;
  }
}

// ---- Structure-Modus: bereits getrennte Einträge nur strukturieren ----

const STRUCTURE_SYSTEM =
  "Du extrahierst bibliografische Felder aus BEREITS getrennten Referenzeinträgen. " +
  "Du splittest und mergst NICHTS. Antworte ausschließlich mit gültigem JSON.";

function buildStructurePrompt(entries: string[]): string {
  return (
    "Hier ist eine Liste bereits getrennter Referenzen (eine pro Listeneintrag). " +
    "Extrahiere für JEDEN Eintrag genau einen Datensatz – ohne zu splitten oder zusammenzuführen. " +
    "Behalte Reihenfolge und Anzahl exakt bei.\n" +
    'Gib NUR JSON zurück: {"references":[{"raw":"<Originaleintrag>","title":"...","authors":["..."],"year":<Zahl|null>,"doi":"...","venue":"..."}]}\n' +
    "'title' nur der Werktitel. Erfinde nichts.\n\nEinträge:\n" +
    JSON.stringify(entries)
  );
}

/**
 * Strukturiert eine vom Nutzer bestätigte/korrigierte Liste von Referenz-Strings.
 * Splittet/merged NICHT – jeder Eingabeeintrag ergibt genau eine Referenz.
 */
export async function structureReferences(entries: string[], apiKey?: string): Promise<ParsedReference[]> {
  const cleaned = entries
    .map((e) => (e || "").replace(/\s+/g, " ").trim())
    .filter((e) => e.length >= 3);
  if (!cleaned.length) return [];

  if (hasOpenRouter(apiKey)) {
    try {
      const content = await openRouterChat(
        [
          { role: "system", content: STRUCTURE_SYSTEM },
          { role: "user", content: buildStructurePrompt(cleaned) },
        ],
        { json: true, temperature: 0, maxTokens: 8000, model: parseModel(), apiKey }
      );
      const data = safeJsonParse<{ references?: LlmRef[] }>(content);
      const refs = Array.isArray(data?.references) ? data.references : [];
      // Per Index zuordnen, damit Reihenfolge/Anzahl garantiert erhalten bleiben.
      return cleaned.map(
        (raw, i) => mapLlmRef(refs[i] || {}, i, raw) || { id: makeId(i), raw, doi: extractDoi(raw) }
      );
    } catch {
      // Fällt auf reine DOI-Extraktion zurück.
    }
  }
  return cleaned.map((raw, i) => ({ id: makeId(i), raw, doi: extractDoi(raw) }));
}
