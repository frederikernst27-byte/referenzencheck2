"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import type { ParsedReference, VerificationResult } from "@/lib/types";

type RowStatus = "pending" | "checking" | "done" | "error";

interface Row {
  ref: ParsedReference;
  status: RowStatus;
  result?: VerificationResult;
  error?: string;
}

interface EditItem {
  id: string;
  raw: string;
  title?: string;
  year?: number;
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
  const [phase, setPhase] = useState<"idle" | "parsing" | "review" | "verifying" | "done">("idle");
  const [parsedRefs, setParsedRefs] = useState<ParsedReference[]>([]);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [orKey, setOrKey] = useState("");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    try {
      setOrKey(localStorage.getItem("or_key") || "");
    } catch {}
  }, []);

  function handleOrKeyChange(val: string) {
    setOrKey(val);
    try { localStorage.setItem("or_key", val); } catch {}
  }

  const busy = phase === "parsing" || phase === "verifying";

  // Schritt 1: Text -> KI-Parsing -> editierbare Vorschau
  async function parse() {
    setError(null);
    setRows([]);
    setDirty(false);
    setPhase("parsing");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(orKey ? { openrouterKey: orKey } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Parsing fehlgeschlagen.");
      const refs: ParsedReference[] = data.references || [];
      if (!refs.length) {
        setError("Es konnten keine Referenzen erkannt werden. Bitte Text prüfen.");
        setPhase("idle");
        return;
      }
      setParsedRefs(refs);
      setEditItems(refs.map((r) => ({ id: r.id, raw: r.raw, title: r.title, year: r.year })));
      setPhase("review");
    } catch (e: any) {
      setError(e?.message || "Parsing fehlgeschlagen.");
      setPhase("idle");
    }
  }

  function updateItem(id: string, raw: string) {
    setDirty(true);
    setEditItems((prev) => prev.map((it) => (it.id === id ? { ...it, raw } : it)));
  }
  function deleteItem(id: string) {
    setDirty(true);
    setEditItems((prev) => prev.filter((it) => it.id !== id));
  }
  function addItem() {
    setDirty(true);
    setEditItems((prev) => [...prev, { id: `new-${Date.now()}`, raw: "" }]);
  }

  // Schritt 2: (korrigierte) Referenzen -> Verifizierung
  async function startSearch() {
    setError(null);
    const rawList = editItems.map((it) => it.raw.trim()).filter(Boolean);
    if (!rawList.length) {
      setError("Keine Referenzen zum Prüfen.");
      return;
    }

    let refs: ParsedReference[];
    if (dirty) {
      // Nutzer hat etwas geändert -> Felder für die korrigierte Liste neu strukturieren.
      setStarting(true);
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ references: rawList, ...(orKey ? { openrouterKey: orKey } : {}) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Strukturierung fehlgeschlagen.");
        refs = data.references || [];
      } catch (e: any) {
        setError(e?.message || "Strukturierung fehlgeschlagen.");
        setStarting(false);
        return;
      }
      setStarting(false);
    } else {
      refs = parsedRefs;
    }

    if (!refs.length) {
      setError("Keine Referenzen zum Prüfen.");
      return;
    }

    const initial: Row[] = refs.map((ref) => ({ ref, status: "pending" }));
    setRows(initial);
    setPhase("verifying");

    await pool(refs, 4, async (ref) => {
      setRows((prev) => prev.map((r) => (r.ref.id === ref.id ? { ...r, status: "checking" } : r)));
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: ref, ...(orKey ? { openrouterKey: orKey } : {}) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Fehler");
        setRows((prev) =>
          prev.map((r) => (r.ref.id === ref.id ? { ...r, status: "done", result: data.result } : r))
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

  function reset() {
    setText("");
    setParsedRefs([]);
    setEditItems([]);
    setRows([]);
    setDirty(false);
    setError(null);
    setPhase("idle");
  }

  const done = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const total = rows.length;
  const counts = {
    verified: rows.filter((r) => r.result?.verdict === "verified").length,
    uncertain: rows.filter((r) => r.result?.verdict === "uncertain").length,
    not_found: rows.filter((r) => r.result?.verdict === "not_found").length,
  };

  const allLinks = Array.from(
    new Map(rows.flatMap((r) => r.result?.links || []).map((l) => [l.url, l])).values()
  );

  function copyLinks() {
    navigator.clipboard?.writeText(allLinks.map((l) => l.url).join("\n"));
  }

  function downloadExcel() {
    const VERDICT_DE: Record<string, string> = {
      verified: "Gefunden",
      uncertain: "Unsicher",
      not_found: "Nicht gefunden",
      error: "Fehler",
    };
    const data = rows.map((row, i) => ({
      "#": i + 1,
      Referenz: row.ref.raw,
      Titel: row.ref.title || "",
      Autoren: row.ref.authors?.join("; ") || "",
      Jahr: row.ref.year || "",
      DOI: row.ref.doi || "",
      Ergebnis: VERDICT_DE[row.result?.verdict || row.status] || row.status,
      "Übereinstimmung (%)": row.result?.confidence != null
        ? Math.round(row.result.confidence * 100)
        : "",
      "Gefundener Titel": row.result?.bestMatch?.matchedTitle || "",
      "Gefundene Autoren": row.result?.bestMatch?.matchedAuthors?.join("; ") || "",
      "Gefundenes Jahr": row.result?.bestMatch?.matchedYear || "",
      Quelle: row.result?.bestMatch?.source || "",
      Links: row.result?.links.map((l) => l.url).join(" | ") || "",
      Hinweis: row.result?.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // Spaltenbreiten
    ws["!cols"] = [
      { wch: 4 }, { wch: 60 }, { wch: 40 }, { wch: 35 }, { wch: 6 }, { wch: 22 },
      { wch: 16 }, { wch: 18 }, { wch: 40 }, { wch: 35 }, { wch: 14 }, { wch: 18 },
      { wch: 50 }, { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Referenzencheck");
    XLSX.writeFile(wb, "referenzencheck.xlsx");
  }

  const showInput = phase === "idle" || phase === "parsing";

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
              <span
                key={s.name}
                className={`chip ${s.active ? "on" : "off"}`}
                title={s.active ? "aktiv" : "kein Key gesetzt"}
              >
                <span className="dot" />
                {s.name}
              </span>
            ))}
            <span className={`chip ${status.llm ? "on" : "off"}`}>
              <span className="dot" />
              KI: {status.llm ? status.model : "aus"}
            </span>
          </div>
        )}
      </header>

      {/* Schritt 1: Eingabe */}
      {showInput && (
        <section className="card">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "Literaturverzeichnis hier einfügen …\n\nz. B.:\nAutor, A. (2020). Titel der Arbeit. Journal, 12(3), 1-20."
            }
            disabled={busy}
          />
          <div className="toolbar">
            <button className="primary" onClick={parse} disabled={busy || !text.trim()}>
              {phase === "parsing" ? (
                <>
                  <span className="spin" />
                  Erkenne Referenzen …
                </>
              ) : (
                "Referenzen erkennen"
              )}
            </button>
            <button className="ghost" onClick={() => setText(EXAMPLE)} disabled={busy}>
              Beispiel einfügen
            </button>
            <button className="ghost" onClick={reset} disabled={busy}>
              Leeren
            </button>
            <span className="spacer" />
            <span className="hint">
              {text.trim() ? `${text.length} Zeichen` : "Text einfügen, um zu starten"}
            </span>
          </div>
        </section>
      )}

      {/* Options: eigener OpenRouter-Key */}
      {showInput && (
        <details className="options-panel">
          <summary>⚙ Optionen</summary>
          <div className="or-key-row">
            <label htmlFor="or-key">OpenRouter-Key</label>
            <input
              id="or-key"
              className="or-key-input"
              type="password"
              placeholder="sk-or-…"
              value={orKey}
              onChange={(e) => handleOrKeyChange(e.target.value)}
              autoComplete="off"
            />
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">
              Key erstellen →
            </a>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Trage hier deinen eigenen OpenRouter-Key ein, damit du nicht den Key des
            Betreibers verbrauchst. Der Key wird nur in diesem Browser gespeichert und
            ausschließlich für deine Anfragen verwendet – nie dauerhaft auf dem Server.
          </p>
        </details>
      )}

      {error && <div className="error">{error}</div>}

      {/* Schritt 2: Editierbare Vorschau */}
      {phase === "review" && (
        <section className="card">
          <div className="review-head">
            <b>{editItems.length} Referenzen erkannt</b>
            <span className="hint">Bitte prüfen/korrigieren – eine Referenz pro Feld.</span>
          </div>

          <div className="editlist">
            {editItems.map((it, idx) => (
              <div className="edititem" key={it.id}>
                <span className="idx">{idx + 1}</span>
                <div className="edit-main">
                  <textarea
                    value={it.raw}
                    onChange={(e) => updateItem(it.id, e.target.value)}
                    rows={2}
                    placeholder="Referenztext …"
                  />
                  {it.title && (
                    <div className="edit-hint">
                      Titel erkannt: {it.title}
                      {it.year ? ` · ${it.year}` : ""}
                    </div>
                  )}
                </div>
                <button
                  className="del"
                  onClick={() => deleteItem(it.id)}
                  title="Eintrag entfernen"
                  aria-label="Eintrag entfernen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="toolbar">
            <button className="primary" onClick={startSearch} disabled={starting || !editItems.length}>
              {starting ? (
                <>
                  <span className="spin" />
                  Bereite Suche vor …
                </>
              ) : (
                `Suche starten (${editItems.filter((i) => i.raw.trim()).length})`
              )}
            </button>
            <button className="ghost" onClick={addItem} disabled={starting}>
              + Eintrag hinzufügen
            </button>
            <button className="ghost" onClick={() => setPhase("idle")} disabled={starting}>
              ← Text bearbeiten
            </button>
          </div>
        </section>
      )}

      {/* Schritt 3: Ergebnisse */}
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

          <div className="results">
            {rows.map((row) => (
              <RefCard key={row.ref.id} row={row} />
            ))}
          </div>
        </>
      )}

      {phase === "done" && (
        <section className="card">
          <div className="toolbar" style={{ marginTop: 0 }}>
            {allLinks.length > 0 && <b>Alle gefundenen Links ({allLinks.length})</b>}
            <span className="spacer" />
            {allLinks.length > 0 && (
              <button className="ghost" onClick={copyLinks}>
                Alle Links kopieren
              </button>
            )}
            <button className="ghost" onClick={downloadExcel}>
              Excel herunterladen
            </button>
            <button className="ghost" onClick={reset}>
              Neue Prüfung
            </button>
          </div>
          {allLinks.length > 0 && (
            <div className="links" style={{ marginTop: 12 }}>
              {allLinks.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <footer>
        Referenzencheck · Verifizierung über SERP API → ScraperAPI → SearchApi → Scrapingdog →
        Crossref → OpenAlex → Semantic Scholar. Ergebnisse sind Hinweise, keine Garantie –
        bitte kritische Quellen manuell gegenprüfen.
        <br />
        Kontakt:{" "}
        <a href="mailto:frederik.ernst@stud.uni-due.de">frederik.ernst@stud.uni-due.de</a>
        {" · "}
        <a href="https://github.com/frederikernst27-byte/referenzencheck2" target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
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
            <div className="title" style={{ fontWeight: 400 }}>
              {ref.raw}
            </div>
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
              <b>KI-Bewertung:</b> {result.llmAssessment.isMatch ? "passt" : "passt nicht"} (
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
