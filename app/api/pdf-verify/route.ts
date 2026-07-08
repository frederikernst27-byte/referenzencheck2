import { NextRequest, NextResponse } from "next/server";
import type { ParsedReference, SourceMatch, VerificationResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300; // hallucinator prüft mehrere DBs pro Referenz, kann dauern

const SERVICE_URL = process.env.HALLUCINATOR_SERVICE_URL;

/**
 * Nimmt ein PDF entgegen und leitet es an den separaten hallucite-service
 * (siehe /hallucinator-service) weiter, der es mit dem `hallucinator`-Paket
 * (DBLP/CrossRef/arXiv/Semantic Scholar u. a.) extrahiert und verifiziert.
 * Läuft NICHT im selben Vercel-Deployment, weil das Python/Rust-Paket dort
 * nicht ausführbar ist und die Verifizierung länger dauern kann, als
 * Vercel-Functions erlauben.
 */
export async function POST(req: NextRequest) {
  if (!SERVICE_URL) {
    return NextResponse.json(
      {
        error:
          "PDF-Upload ist noch nicht konfiguriert (HALLUCINATOR_SERVICE_URL fehlt). Siehe hallucinator-service/README.md.",
      },
      { status: 501 }
    );
  }

  try {
    const incoming = await req.formData();
    const file = incoming.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Keine PDF-Datei übergeben." }, { status: 400 });
    }
    const looksLikePdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      return NextResponse.json({ error: "Nur PDF-Dateien werden unterstützt." }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF zu groß (max. 25 MB)." }, { status: 413 });
    }

    const forward = new FormData();
    forward.append("file", file, file.name);

    const upstream = await fetch(`${SERVICE_URL.replace(/\/$/, "")}/verify-pdf`, {
      method: "POST",
      body: forward,
      signal: AbortSignal.timeout(280_000),
    });

    if (!upstream.ok) {
      let detail = "";
      try {
        const errBody = await upstream.json();
        detail = errBody?.detail || errBody?.error || "";
      } catch {
        detail = await upstream.text().catch(() => "");
      }
      return NextResponse.json(
        { error: detail || `PDF-Dienst antwortete mit Fehler ${upstream.status}.` },
        { status: upstream.status === 422 ? 422 : 502 }
      );
    }

    const data = await upstream.json();
    const { references, results } = mapServiceResponse(data);
    return NextResponse.json({ references, results });
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return NextResponse.json(
      {
        error: isTimeout
          ? "Der PDF-Dienst hat zu lange gebraucht (Timeout). Bitte später erneut versuchen."
          : e?.message || "PDF-Verifizierung fehlgeschlagen.",
      },
      { status: 500 }
    );
  }
}

interface ServiceReference {
  id: string;
  raw: string;
  title?: string | null;
  authors?: string[] | null;
  doi?: string | null;
}

interface ServiceResult {
  referenceId: string;
  verdict: "verified" | "uncertain" | "not_found" | "error";
  confidence: number;
  source?: string | null;
  matchedTitle?: string | null;
  matchedAuthors?: string[] | null;
  doi?: string | null;
  links: { label: string; url: string }[];
  checkedDbs: string[];
  failedDbs: string[];
  retracted: boolean;
  notes?: string | null;
}

function mapServiceResponse(data: {
  references: ServiceReference[];
  results: ServiceResult[];
}): { references: ParsedReference[]; results: VerificationResult[] } {
  const references: ParsedReference[] = [];
  const results: VerificationResult[] = [];

  for (const item of data.references || []) {
    const ref: ParsedReference = {
      id: item.id,
      raw: item.raw,
      title: item.title || undefined,
      authors: item.authors?.length ? item.authors : undefined,
      doi: item.doi || undefined,
    };
    references.push(ref);

    const r = (data.results || []).find((x) => x.referenceId === item.id);
    if (!r) continue;

    const bestMatch: SourceMatch | undefined = r.source
      ? {
          source: r.source,
          matchedTitle: r.matchedTitle || undefined,
          matchedAuthors: r.matchedAuthors?.length ? r.matchedAuthors : undefined,
          doi: r.doi || undefined,
          links: r.links || [],
          similarity: r.confidence ?? 0,
        }
      : undefined;

    let notes = r.notes || undefined;
    if (r.failedDbs?.length) {
      const hint = `Zeitüberschreitung/Fehler bei: ${r.failedDbs.join(", ")}.`;
      notes = notes ? `${notes} ${hint}` : hint;
    }

    results.push({
      reference: ref,
      verdict: r.verdict,
      confidence: r.confidence ?? 0,
      bestMatch,
      allMatches: bestMatch ? [bestMatch] : [],
      links: r.links || [],
      checkedSources: r.checkedDbs || [],
      notes,
    });
  }

  return { references, results };
}
