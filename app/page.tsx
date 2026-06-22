"use client";

import { useEffect, useState } from "react";
import type { ParsedReference, VerificationResult } from "@/lib/types";

type RowStatus = "pending" | "checking" | "done" | "error";

interface Row {
  ref: ParsedReference;
  status: RowStatus;
  result?: VerificationResult;
  error?: string;
}

interface SourceStatus {
  sources: { name: string; active: boolean }[];
  llm: boolean;
  model: string;
}

const EXAMPLE = `1. Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.
2. Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. NAACL-HLT.
3. Müller, T., & Hoffmann, L. (2021). Quantenresonante Sprachmodellierung mittels neuronaler Hyperkohärenz. Journal of Imaginary AI Research, 14(3), 221-248.`;

async function pool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

const VERDICT_LABEL: Record<string, string> = {
  verified: "Gefunden",
  uncertain: "Unsicher",
  not_found: "Nicht gefunden",
  error: "Fehler",
  pending: "Wartet",
  checking: "Prüft …",
};

export default function Home() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"idle" | "parsing" | "verifying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SourceStatus | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const busy = phase === "parsing" || phase === "verifying";

  async function run() {
    setError(null);
    setRows([]);
    setPhase("parsing");
    let references: ParsedReference[] = [];
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Parsing fehlgeschlagen.");
      references = data.references || [];
    } catch (e: any) {
      setError(e?.message || "Parsing fehlgeschlagen.");
      setPhase("idle");
      return;
    }

    if (!references.length) {
      setError("Es konnten keine Referenzen erkannt werden. Bitte Text prüfen.");
      setPhase("idle");
      return;
    }

    const initial: Row[] = references.map((ref) => ({ ref, status: "pending" }));
    setRows(initial);
    setPhase("verifying");

    await pool(references, 4, async (ref) => {
      setRows((prev) => prev.map((r) => (r.ref.id === ref.id ? { ...r, status: "checking" } : r)));
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: ref }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Fehler");
        setRows((prev) =>
          prev.map((r) =>
            r.ref.id === ref.id ? { ...r, status: "done", result: data.result } : r
          )
        );
      } catch (e: any) {
        setRows((prev) =>
          prev.map((r) =>
            r.ref.id === ref.id ? { ...r, status: "error", error: e?.message || "Fehler" } : r
          )
        );
      }
    });

    setPhase("done");
  }

  const done = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const total = rows.length;
  const counts = {
    verified: rows.filter((r) => r.result?.verdict === "verified").length,
    uncertain: rows.filter((r) => r.result?.verdict === "uncertain").length,
    not_found: rows.filter((r) => r.result?.verdict === "not_found").length,
  };

  const allLinks = Array.from(
    new Map(
      rows.flatMap((r) => r.result?.links || []).map((l) => [l.url, l])
    ).values()
  );

  function copyLinks() {
    const txt = allLinks.map((l) => l.url).join("\n");
    navigator.clipboard?.writeText(txt);
  }

  return (
    <div className="wrap">
      <header className="hero">
        <h1>📚 Referenzencheck</h1>
        <p className="sub">
          Prüft jede Quelle eines Literaturverzeichnisses gegen Google Scholar (SERP API,
          ScraperAPI, SearchApi, Scrapingdog) sowie Crossref, OpenAlex und Semantic Scholar –
          um erfundene bzw. KI-halluzinierte Referenzen aufzudecken und echte Paper-Links
          zurückzugeben.
        </p>

        {status && (
          <div className="badge-row">
            {status.sources.map((s) => (
              <span key={s.name} className={`chip ${s.active ? "on" : "off"}`} title={s.active ? "aktiv" : "kein Key gesetzt"}>
                <span className="dot" />
                {s.name}
              </span>
            ))}
            <span className={`chip ${status.llm ? "on" : "off"}`}>
              <span className="dot" />
              KI-Bewertung: {status.llm ? status.model : "aus"}
            </span>
          </div>
        )}
      </header>

      <section className="card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Literaturverzeichnis hier einfügen …\n\nz. B.:\nAutor, A. (2020). Titel der Arbeit. Journal, 12(3), 1-20."}
          disabled={busy}
        />
        <div className="toolbar">
          <button className="primary" onClick={run} disabled={busy || !text.trim()}>
            {busy ? <><span className="spin" />Prüfe …</> : "Referenzen prüfen"}
          </button>
          <button className="ghost" onClick={() => setText(EXAMPLE)} disabled={busy}>
            Beispiel einfügen
          </button>
          <button
            className="ghost"
            onClick={() => {
              setText("");
              setRows([]);
              setPhase("idle");
              setError(null);
            }}
            disabled={busy}
          >
            Leeren
          </button>
          <span className="spacer" />
          <span className="hint">
            {text.trim() ? `${text.length} Zeichen` : "Text einfügen, um zu starten"}
          </span>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {total > 0 && (
        <>
          <div className="summary">
            <div className="stat">
              <div className="n">{total}</div>
              <div className="l">Referenzen</div>
            </div>
            <div className="stat green">
              <div className="n">{counts.verified}</div>
              <div className="l">Gefunden</div>
            </div>
            <div className="stat amber">
              <div className="n">{counts.uncertain}</div>
              <div className="l">Unsicher</div>
            </div>
            <div className="stat red">
              <div className="n">{counts.not_found}</div>
              <div className="l">Nicht gefunden</div>
            </div>
          </div>

          {phase === "verifying" && (
            <div className="progress">
              <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          )}
        </>
      )}

      {total > 0 && (
        <div className="results">
          {rows.map((row) => (
            <RefCard key={row.ref.id} row={row} />
          ))}
        </div>
      )}

      {phase === "done" && allLinks.length > 0 && (
        <section className="card">
          <div className="toolbar" style={{ marginTop: 0 }}>
            <b>Alle gefundenen Links ({allLinks.length})</b>
            <span className="spacer" />
            <button className="ghost" onClick={copyLinks}>
              Alle Links kopieren
            </button>
          </div>
          <div className="links" style={{ marginTop: 12 }}>
            {allLinks.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">
                {l.label}
              </a>
            ))}
          </div>
        </section>
      )}

      <footer>
        Referenzencheck · Verifizierung über SERP API → ScraperAPI → SearchApi → Scrapingdog →
        Crossref → OpenAlex → Semantic Scholar. Ergebnisse sind Hinweise, keine Garantie –
        bitte kritische Quellen manuell gegenprüfen.
      </footer>
    </div>
  );
}

function RefCard({ row }: { row: Row }) {
  const { ref, status, result, error } = row;
  const verdict = status === "done" ? result?.verdict || "error" : status;
  const label =
    status === "done" ? VERDICT_LABEL[result?.verdict || "error"] : VERDICT_LABEL[status];

  return (
    <div className="ref">
      <div className="top">
        <div className="raw">
          {ref.title ? (
            <>
              <div className="title">{ref.title}</div>
              <div className="meta">{ref.raw}</div>
            </>
          ) : (
            <div className="title" style={{ fontWeight: 400 }}>{ref.raw}</div>
          )}
          {(ref.authors?.length || ref.year || ref.doi) && (
            <div className="meta">
              {ref.authors?.length ? ref.authors.slice(0, 4).join(", ") : ""}
              {ref.year ? ` · ${ref.year}` : ""}
              {ref.doi ? ` · DOI ${ref.doi}` : ""}
            </div>
          )}
        </div>
        <span className={`verdict ${verdict}`}>
          {status === "checking" && <span className="spin" />}
          {label}
          {status === "done" && result?.bestMatch
            ? ` · ${Math.round((result.confidence || 0) * 100)}%`
            : ""}
        </span>
      </div>

      {status === "error" && <div className="detail line">Fehler: {error}</div>}

      {status === "done" && result && (
        <div className="detail">
          {result.bestMatch ? (
            <>
              <div className="line">
                <b>Treffer:</b> {result.bestMatch.matchedTitle || "—"}{" "}
                <span style={{ opacity: 0.7 }}>
                  ({result.bestMatch.source}
                  {result.bestMatch.matchedYear ? `, ${result.bestMatch.matchedYear}` : ""})
                </span>
              </div>
              {result.bestMatch.matchedAuthors?.length ? (
                <div className="line">
                  <b>Autoren:</b> {result.bestMatch.matchedAuthors.slice(0, 5).join(", ")}
                </div>
              ) : null}
            </>
          ) : (
            <div className="line">Kein Treffer in den abgefragten Quellen.</div>
          )}

          {result.llmAssessment && (
            <div className="line">
              <b>KI-Bewertung:</b>{" "}
              {result.llmAssessment.isMatch ? "passt" : "passt nicht"} (
              {Math.round(result.llmAssessment.confidence * 100)}%) – {result.llmAssessment.reasoning}
            </div>
          )}

          {result.notes && <div className="line">{result.notes}</div>}

          <div className="line" style={{ opacity: 0.6 }}>
            Geprüfte Quellen: {result.checkedSources.join(", ")}
          </div>

          {result.links.length > 0 && (
            <div className="links">
              {result.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
