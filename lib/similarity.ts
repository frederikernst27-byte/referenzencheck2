import type { ParsedReference } from "./types";

export function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Diakritika entfernen
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/** Sørensen-Dice-Koeffizient über Zeichen-Bigramme zweier (normalisierter) Strings. */
export function diceCoefficient(a: string, b: string): number {
  const na = normalize(a).replace(/\s/g, "");
  const nb = normalize(b).replace(/\s/g, "");
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const bg = nb.slice(i, i + 2);
    const count = bigrams.get(bg) || 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (na.length - 1 + nb.length - 1);
}

/** Anteil der Kandidaten-Tokens, die im Heuhaufen vorkommen (Containment). */
export function tokenContainment(candidate: string, haystack: string): number {
  const cand = tokenize(candidate);
  if (!cand.length) return 0;
  const hay = new Set(tokenize(haystack));
  let hits = 0;
  for (const t of cand) if (hay.has(t)) hits++;
  return hits / cand.length;
}

/**
 * Ähnlichkeit zwischen einem gefundenen Kandidaten-Titel und der Referenz.
 * Wenn die Referenz einen extrahierten Titel hat, wird gegen diesen verglichen,
 * sonst wird geprüft, ob der Kandidaten-Titel im Rohtext der Referenz enthalten ist.
 */
export function referenceSimilarity(
  ref: Pick<ParsedReference, "title" | "raw">,
  candidateTitle: string | undefined
): number {
  if (!candidateTitle || candidateTitle.trim().length < 3) return 0;

  if (ref.title && ref.title.trim().length >= 4) {
    const dice = diceCoefficient(ref.title, candidateTitle);
    const contain = tokenContainment(candidateTitle, ref.title);
    return Math.max(dice, contain * 0.95);
  }
  // Kein extrahierter Titel: Kandidaten-Titel sollte im Rohtext enthalten sein.
  return tokenContainment(candidateTitle, ref.raw);
}

export function normalizeDoi(doi?: string): string {
  if (!doi) return "";
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[.,;]+$/, "");
}

export function sameDoi(a?: string, b?: string): boolean {
  const na = normalizeDoi(a);
  const nb = normalizeDoi(b);
  return !!na && na === nb;
}
