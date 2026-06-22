import type {
  LlmAssessment,
  ParsedReference,
  SourceCandidate,
  SourceMatch,
  VerificationResult,
} from "./types";
import { sourceChain } from "./sources";
import { referenceSimilarity, sameDoi } from "./similarity";
import { uniqueLinks } from "./sources/util";
import { hasOpenRouter, openRouterChat, safeJsonParse } from "./openrouter";

const STRONG = 0.82; // ab hier gilt eine Quelle als sicherer Treffer -> Kette stoppt
const WEAK = 0.55; // ab hier ein "brauchbarer" Kandidat (unsicher)

function scoreCandidate(ref: ParsedReference, cand: SourceCandidate): SourceMatch {
  let sim = referenceSimilarity(ref, cand.matchedTitle);
  // DOI-Übereinstimmung ist ein sehr starkes Signal.
  if (sameDoi(ref.doi, cand.doi)) sim = Math.max(sim, 0.95);
  return { ...cand, similarity: sim };
}

async function llmAssess(
  ref: ParsedReference,
  match: SourceMatch
): Promise<LlmAssessment | undefined> {
  if (!hasOpenRouter()) return undefined;
  try {
    const sys =
      "Du prüfst, ob ein gefundener Datenbank-Treffer wirklich dieselbe Arbeit ist wie eine zitierte Referenz. " +
      "Achte vor allem auf Titel und Autoren. " +
      "WICHTIG: Eine andere Auflage, ein Reprint oder ein abweichendes Jahr DESSELBEN Werks gilt weiterhin als Übereinstimmung (isMatch=true) – " +
      "erwähne die Jahr-/Auflagen-Abweichung dann nur in 'reasoning'. " +
      "Setze isMatch=false NUR, wenn es sich erkennbar um ein ANDERES Werk handelt (anderer Titel oder andere Autoren). " +
      "Antworte ausschließlich mit JSON.";
    const user =
      "Zitierte Referenz:\n" +
      JSON.stringify({ raw: ref.raw, title: ref.title, authors: ref.authors, year: ref.year, doi: ref.doi }) +
      "\n\nGefundener Treffer (" +
      match.source +
      "):\n" +
      JSON.stringify({
        title: match.matchedTitle,
        authors: match.matchedAuthors,
        year: match.matchedYear,
        doi: match.doi,
      }) +
      '\n\nAntworte als JSON: {"isMatch": <true|false>, "confidence": <0..1>, "reasoning": "<kurze Begründung auf Deutsch>"}';
    const content = await openRouterChat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { json: true, temperature: 0, timeoutMs: 30000 }
    );
    const data = safeJsonParse<LlmAssessment>(content);
    return {
      isMatch: !!data.isMatch,
      confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
      reasoning: String(data.reasoning || "").slice(0, 500),
    };
  } catch {
    return undefined;
  }
}

export async function verifyReference(ref: ParsedReference): Promise<VerificationResult> {
  const chain = sourceChain();
  const checkedSources: string[] = [];
  const allMatches: SourceMatch[] = [];
  let strongMatch: SourceMatch | undefined;

  for (const source of chain) {
    checkedSources.push(source.name);
    let candidates: SourceCandidate[] = [];
    try {
      candidates = await source.search(ref);
    } catch {
      continue; // Quelle ausgefallen -> nächste probieren
    }
    if (!candidates.length) continue;

    let best: SourceMatch | undefined;
    for (const c of candidates) {
      const scored = scoreCandidate(ref, c);
      if (!best || scored.similarity > best.similarity) best = scored;
    }
    if (best && best.similarity >= WEAK) allMatches.push(best);
    if (best && best.similarity >= STRONG) {
      strongMatch = best;
      break; // starker Treffer -> Kette beenden
    }
  }

  allMatches.sort((a, b) => b.similarity - a.similarity);
  const bestMatch = strongMatch || allMatches[0];

  // Optionale LLM-Bewertung des besten Kandidaten (nur wenn ein Treffer existiert).
  let llmAssessment: LlmAssessment | undefined;
  if (bestMatch) {
    llmAssessment = await llmAssess(ref, bestMatch);
  }

  // Verdict bestimmen.
  let verdict: VerificationResult["verdict"];
  let confidence: number;
  let notes: string | undefined;

  if (!bestMatch) {
    verdict = "not_found";
    confidence = Math.min(0.95, 0.45 + 0.08 * checkedSources.length);
    notes =
      "In keiner abgefragten Quelle gefunden – mögliche KI-Halluzination oder fehlerhafte Angabe.";
  } else {
    const strongHit = bestMatch.similarity >= STRONG;
    if (llmAssessment) {
      if (llmAssessment.isMatch && bestMatch.similarity >= WEAK) {
        verdict = "verified";
        confidence = Math.max(bestMatch.similarity, llmAssessment.confidence);
      } else if (!llmAssessment.isMatch) {
        verdict = "uncertain";
        confidence = bestMatch.similarity;
        notes =
          "Es wurde eine ähnliche Arbeit gefunden, aber die KI-Bewertung hält sie für eine andere Quelle.";
      } else {
        verdict = "uncertain";
        confidence = bestMatch.similarity;
      }
    } else {
      verdict = strongHit ? "verified" : "uncertain";
      confidence = bestMatch.similarity;
      if (!strongHit)
        notes = "Nur teilweise Übereinstimmung – Treffer unsicher, bitte manuell prüfen.";
    }
  }

  // Bei einem Treffer mit abweichendem Jahr/Auflage transparent darauf hinweisen.
  if (
    verdict === "verified" &&
    ref.year &&
    bestMatch?.matchedYear &&
    ref.year !== bestMatch.matchedYear
  ) {
    const hint = `Hinweis: andere Auflage/Jahr gefunden (zitiert ${ref.year}, gefunden ${bestMatch.matchedYear}).`;
    notes = notes ? `${notes} ${hint}` : hint;
  }

  const links = uniqueLinks(allMatches.flatMap((m) => m.links));

  return {
    reference: ref,
    verdict,
    confidence,
    bestMatch,
    allMatches,
    links,
    checkedSources,
    llmAssessment,
    notes,
  };
}
