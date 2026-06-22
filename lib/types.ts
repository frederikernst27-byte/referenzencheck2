export interface ParsedReference {
  id: string;
  /** Original, unveränderter Referenztext */
  raw: string;
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  venue?: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

/** Ein Kandidat, den eine Quelle zurückliefert (vor dem Ähnlichkeits-Scoring). */
export interface SourceCandidate {
  source: string;
  matchedTitle?: string;
  matchedAuthors?: string[];
  matchedYear?: number;
  doi?: string;
  links: SourceLink[];
}

/** Bewerteter Treffer einer Quelle. */
export interface SourceMatch extends SourceCandidate {
  similarity: number; // 0..1
}

export type Verdict = "verified" | "uncertain" | "not_found" | "error";

export interface LlmAssessment {
  isMatch: boolean;
  confidence: number; // 0..1
  reasoning: string;
}

export interface VerificationResult {
  reference: ParsedReference;
  verdict: Verdict;
  /** Vertrauen in das Verdict, 0..1 */
  confidence: number;
  bestMatch?: SourceMatch;
  allMatches: SourceMatch[];
  /** Aggregierte, deduplizierte Links zu gefundenen Papern */
  links: SourceLink[];
  checkedSources: string[];
  llmAssessment?: LlmAssessment;
  notes?: string;
  error?: string;
}

export interface Source {
  name: string;
  /** Quelle wird nur abgefragt, wenn enabled() true ist (z. B. API-Key vorhanden). */
  enabled: () => boolean;
  search: (ref: ParsedReference) => Promise<SourceCandidate[]>;
}
