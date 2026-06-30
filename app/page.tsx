"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import XLSX from "xlsx-js-style";
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

// Bei jeder Änderung erhöhen – wird oben im Header angezeigt, damit man sieht,
// welche Version gerade live ist.
const APP_VERSION = "v0.6.0";

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
  uncertain: "Bitte manuell überprüfen",
  not_found: "Bitte manuell überprüfen",
  error: "Bitte manuell überprüfen",
  pending: "Wartet",
  checking: "Prüft …",
};

export default function Home() {
  const [text, setText] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "parsing" | "normalizing" | "review" | "verifying" | "done">("idle");
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

  const busy = phase === "parsing" || phase === "normalizing" || phase === "verifying" || pdfLoading;

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPdfLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (orKey) form.append("openrouterKey", orKey);
      const res = await fetch("/api/pdf", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "PDF-Verarbeitung fehlgeschlagen.");
      setText(data.text);
    } catch (err: any) {
      setError(err?.message || "PDF konnte nicht gelesen werden.");
    } finally {
      setPdfLoading(false);
    }
  }

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
      // Normalisierungsschritt: KI bringt alle Referenzen in ein einheitliches Format
      setPhase("normalizing");
      let normalizedRefs = refs;
      try {
        const normRes = await fetch("/api/normalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ references: refs, ...(orKey ? { openrouterKey: orKey } : {}) }),
        });
        if (normRes.ok) {
          const normData = await normRes.json();
          if (Array.isArray(normData?.references) && normData.references.length) {
            normalizedRefs = normData.references;
          }
        }
      } catch {
        // Normalisierung optional – bei Fehler mit Original-Refs weitermachen
      }

      setParsedRefs(normalizedRefs);
      setEditItems(normalizedRefs.map((r) => ({ id: r.id, raw: r.raw, title: r.title, year: r.year })));
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

  async function startSearch() {
    setError(null);
    const rawList = editItems.map((it) => it.raw.trim()).filter(Boolean);
    if (!rawList.length) {
      setError("Keine Referenzen zum Prüfen.");
      return;
    }

    let refs: ParsedReference[];
    if (dirty) {
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
    const HEADERS = [
      "#", "Referenz", "Titel", "Autoren", "Jahr", "DOI",
      "Ergebnis", "Übereinstimmung (%)", "Gefundener Titel",
      "Gefundene Autoren", "Gefundenes Jahr", "Quelle", "Link", "Hinweis",
    ];

    const COL_WIDTHS = [
      4, 60, 40, 35, 6, 22, 20, 18, 40, 35, 14, 18, 45, 50,
    ];

    // Farbschema
    const COLORS = {
      headerBg: "1A5CAC",   // TM-Blau
      headerFg: "FFFFFF",
      verifiedBg: "D6F4E3", verifiedFg: "145C33",
      uncertainBg: "FFF3CD", uncertainFg: "7A5200",
      notFoundBg: "FDDEDE",  notFoundFg: "7A1C1C",
      defaultBg: "F8F9FA",
      altBg: "FFFFFF",
    };

    const VERDICT_DE: Record<string, string> = {
      verified: "Gefunden",
      uncertain: "Bitte manuell überprüfen",
      not_found: "Bitte manuell überprüfen",
      error: "Bitte manuell überprüfen",
    };

    function cell(v: string | number, extra: Record<string, any> = {}): any {
      return { v, t: typeof v === "number" ? "n" : "s", ...extra };
    }

    function headerCell(v: string): any {
      return {
        v, t: "s",
        s: {
          font: { bold: true, color: { rgb: COLORS.headerFg }, sz: 11 },
          fill: { fgColor: { rgb: COLORS.headerBg } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
            bottom: { style: "medium", color: { rgb: "FFFFFF" } },
          },
        },
      };
    }

    function rowStyle(verdict: string, isAlt: boolean) {
      let bg = isAlt ? COLORS.altBg : COLORS.defaultBg;
      let fg = "000000";
      if (verdict === "verified") { bg = COLORS.verifiedBg; fg = COLORS.verifiedFg; }
      else if (verdict === "uncertain" || verdict === "not_found" || verdict === "error") {
        if (verdict === "uncertain") { bg = COLORS.uncertainBg; fg = COLORS.uncertainFg; }
        else { bg = COLORS.notFoundBg; fg = COLORS.notFoundFg; }
      }
      return {
        fill: { fgColor: { rgb: bg } },
        font: { color: { rgb: fg }, sz: 10 },
        alignment: { vertical: "top", wrapText: true },
        border: {
          bottom: { style: "thin", color: { rgb: "D0D0D0" } },
        },
      };
    }

    const ws: any = {};
    const range = { s: { c: 0, r: 0 }, e: { c: HEADERS.length - 1, r: rows.length } };
    ws["!ref"] = XLSX.utils.encode_range(range);
    ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
    ws["!rows"] = [{ hpt: 32 }]; // Header-Zeile höher

    // Header-Zeile
    HEADERS.forEach((h, c) => {
      ws[XLSX.utils.encode_cell({ r: 0, c })] = headerCell(h);
    });

    // Datenzeilen
    rows.forEach((row, rowIdx) => {
      const r = rowIdx + 1;
      const verdict = row.result?.verdict || (row.status === "error" ? "error" : "pending");
      const isAlt = rowIdx % 2 === 1;
      const s = rowStyle(verdict, isAlt);

      const confidence = row.result?.confidence != null
        ? Math.round(row.result.confidence * 100)
        : null;

      const firstLink = row.result?.links?.[0]?.url || "";
      const linkLabel = row.result?.links?.[0]?.label || firstLink;

      const rowData: (string | number)[] = [
        rowIdx + 1,
        row.ref.raw || "-",
        row.ref.title || "-",
        row.ref.authors?.join("; ") || "-",
        row.ref.year || "-",
        row.ref.doi || "-",
        VERDICT_DE[verdict] || "-",
        confidence ?? "-",
        row.result?.bestMatch?.matchedTitle || "-",
        row.result?.bestMatch?.matchedAuthors?.join("; ") || "-",
        row.result?.bestMatch?.matchedYear || "-",
        row.result?.bestMatch?.source || "-",
        firstLink ? linkLabel : "-",
        row.result?.notes || "-",
      ];

      rowData.forEach((v, c) => {
        const addr = XLSX.utils.encode_cell({ r, c });
        // Link-Spalte (Index 12) als anklickbare Hyperlink
        if (c === 12 && firstLink) {
          ws[addr] = {
            v: String(v), t: "s",
            l: { Target: firstLink },
            s: {
              ...s,
              font: { ...s.font, color: { rgb: "1A5CAC" }, underline: true },
            },
          };
        } else {
          ws[addr] = { v, t: typeof v === "number" ? "n" : "s", s };
        }
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Referenzencheck");
    XLSX.writeFile(wb, "referenzencheck.xlsx");
  }

  const showInput = phase === "idle" || phase === "parsing" || phase === "normalizing";

  const sortedRows = [...rows].sort((a, b) => {
    const needsCheck = (r: Row) =>
      r.result?.verdict === "not_found" ||
      r.result?.verdict === "uncertain" ||
      r.status === "error";
    return needsCheck(b) ? 1 : needsCheck(a) ? -1 : 0;
  });

  return (
    <div className="wrap">
      {/* ── Header ── */}
      <header className="hero">
        <div className="hero-top">
          <Image
            src="/tm-logo.svg"
            alt="Lehrstuhl Information Systems & Transformation Management"
            width={90}
            height={66}
            priority
            className="tm-logo"
          />
          <div className="hero-title-block">
            <h1>
              Referenz Checker <span className="app-version">{APP_VERSION}</span>
            </h1>
            <div className="chair-label">
              Lehrstuhl Information Systems &amp; Transformation Management
            </div>
          </div>
        </div>
        <p className="sub">
          Prüft jede Quelle eines Literaturverzeichnisses automatisch auf Echtheit –
          erkennt erfundene bzw. KI-halluzinierte Referenzen und liefert echte Paper-Links.
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

      {/* ── Schritt 1: Eingabe ── */}
      {showInput && (
        <>
          {phase === "normalizing" ? (
            <div className="phase-guide normalizing-guide">
              <div className="phase-guide-title">Normalisierung läuft …</div>
              <ol className="phase-steps">
                <li>Die KI bringt alle erkannten Referenzen in ein einheitliches Format.</li>
                <li>Autoren, Titel, Jahr und Quelle werden standardisiert – das verbessert die Trefferquote bei der Suche deutlich.</li>
                <li>Einen Moment Geduld, das dauert wenige Sekunden …</li>
              </ol>
            </div>
          ) : (
            <div className="phase-guide">
              <div className="phase-guide-title">Schritt 1 von 3 – Literaturverzeichnis einfügen</div>
              <ol className="phase-steps">
                <li>Lade dein PDF direkt hoch (Button <b>„PDF hochladen"</b>) – oder kopiere das Literaturverzeichnis manuell in das Textfeld.</li>
                <li>Klicke auf <b>„Referenzen erkennen"</b> – die KI erkennt und normalisiert alle Einträge automatisch.</li>
              </ol>
            </div>
          )}

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
                ) : phase === "normalizing" ? (
                  <>
                    <span className="spin" />
                    Formatiere einheitlich …
                  </>
                ) : (
                  "Referenzen erkennen"
                )}
              </button>
              <label className={`ghost btn-label${busy ? " disabled" : ""}`}>
                {pdfLoading ? (
                  <>
                    <span className="spin" />
                    PDF wird geladen …
                  </>
                ) : (
                  "PDF hochladen"
                )}
                <input
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={handlePdfUpload}
                  disabled={busy}
                />
              </label>
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
        </>
      )}

      {error && <div className="error">{error}</div>}

      {/* ── Schritt 2: Editierbare Vorschau ── */}
      {phase === "review" && (
        <>
          <div className="phase-guide">
            <div className="phase-guide-title">Schritt 2 von 3 – Erkannte Referenzen prüfen</div>
            <ol className="phase-steps">
              <li>Die KI hat <b>{editItems.length} Referenz(en)</b> erkannt – prüfe, ob alle korrekt erkannt wurden.</li>
              <li>Korrigiere fehlerhafte Einträge direkt im Textfeld oder lösche sie mit <b>✕</b>.</li>
              <li>Füge fehlende Einträge mit <b>„+ Eintrag hinzufügen"</b> manuell hinzu.</li>
              <li>Klicke anschließend auf <b>„Suche starten"</b>, um alle Referenzen zu prüfen.</li>
            </ol>
          </div>

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
        </>
      )}

      {/* ── Schritt 3: Ergebnisse ── */}
      {total > 0 && (
        <>
          {(phase === "verifying" || phase === "done") && (
            <div className="phase-guide">
              <div className="phase-guide-title">
                {phase === "verifying"
                  ? "Schritt 3 von 3 – Referenzen werden geprüft …"
                  : "Schritt 3 von 3 – Prüfung abgeschlossen"}
              </div>
              <ol className="phase-steps">
                {phase === "verifying" ? (
                  <li>Die Referenzen werden gerade gegen Google Scholar, Crossref, OpenAlex und Semantic Scholar geprüft. Bitte warten.</li>
                ) : (
                  <>
                    <li>Einträge mit <span className="inline-tag red">Bitte manuell überprüfen</span> konnten nicht automatisch verifiziert werden – diese stehen oben.</li>
                    <li>Öffne diese Quellen manuell in Google Scholar oder der Bibliotheksdatenbank und prüfe, ob sie existieren.</li>
                    <li>Mit <b>„Excel herunterladen"</b> kannst du alle Ergebnisse exportieren und weiterleiten.</li>
                  </>
                )}
              </ol>
            </div>
          )}

          <div className="summary">
            <div className="stat">
              <div className="n">{total}</div>
              <div className="l">Referenzen</div>
            </div>
            <div className="stat green">
              <div className="n">{counts.verified}</div>
              <div className="l">Gefunden</div>
            </div>
            <div className="stat red">
              <div className="n">{counts.uncertain + counts.not_found}</div>
              <div className="l">Manuell prüfen</div>
            </div>
          </div>

          {phase === "verifying" && (
            <div className="progress">
              <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          )}

          <div className="results">
            {sortedRows.map((row) => (
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
        Referenz Checker · Lehrstuhl Information Systems &amp; Transformation Management ·
        Verifizierung über SERP API → ScraperAPI → SearchApi → Scrapingdog →
        Crossref → OpenAlex → Semantic Scholar. Ergebnisse sind Hinweise, keine Garantie –
        bitte kritische Quellen manuell gegenprüfen.
        <br />
        Bei Fragen oder Problemen gerne eine E-Mail schreiben:{" "}
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
