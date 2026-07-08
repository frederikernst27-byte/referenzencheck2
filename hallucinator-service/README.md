# hallucite-service

Kleiner FastAPI-Wrapper um [`hallucinator`](https://github.com/gianlucasb/hallucinator)
(PyPI-Paket, vorkompilierte Rust-Wheels — kein Rust-Toolchain, kein `pdftotext`
nötig). Nimmt ein PDF entgegen, extrahiert die Referenzen und prüft sie gegen
CrossRef, arXiv, DBLP, Semantic Scholar, ACL Anthology, Europe PMC, PubMed,
OpenAlex u. a. Gibt JSON zurück, das `app/api/pdf-verify/route.ts` in der
Next.js-App direkt weiterverarbeitet.

Das ist ein **eigenständiger Dienst**, getrennt von der Vercel-App — bewusst,
damit die Uni-Infrastruktur nicht angefasst werden muss und die (potenziell
langsamen) Datenbankabfragen nicht an Vercels Function-Timeouts scheitern.

## Lokal testen

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# in einem zweiten Terminal:
curl -F "file=@/pfad/zu/paper.pdf" http://localhost:8000/verify-pdf
```

## Deployment (nicht auf dem Uni-Server)

Empfehlung: **Railway** oder **Render**, weil beide Docker-Deploys mit
dauerhaft laufendem Prozess unterstützen (kein Cold-Start-Problem, kein
Timeout-Limit wie bei Vercel-Serverless-Functions). Fly.io funktioniert
genauso.

### Railway
1. Neues Projekt → "Deploy from GitHub repo" → dieses Unterverzeichnis
   (`hallucinator-service/`) als Root angeben, oder als eigenes Repo pushen.
2. Railway erkennt das `Dockerfile` automatisch.
3. Env-Vars setzen (siehe unten).
4. Nach dem Deploy die öffentliche URL kopieren (z. B.
   `https://hallucite-service-production.up.railway.app`).

### Render
1. "New Web Service" → Repo verbinden, Root auf `hallucinator-service/`
   setzen, Environment "Docker" wählen.
2. Env-Vars setzen.
3. Plan mit genug RAM wählen (mind. 512 MB, hallucinator läuft nativ in
   Rust, ist aber bei vielen parallelen Requests speicherhungriger als ein
   simples Python-Skript).

## Environment-Variablen

| Variable | Zweck |
|---|---|
| `ALLOWED_ORIGINS` | Kommagetrennte Liste erlaubter Origins fürs CORS, z. B. `https://referenzencheck2.vercel.app`. Ohne Angabe: `*` (offen — nur für lokales Testen). |
| `SEMANTIC_SCHOLAR_KEY` | Optional, höhere Rate-Limits. |
| `OPENALEX_KEY` | Optional, kostenlos unter openalex.org/settings/api. |
| `CROSSREF_MAILTO` | Optional, "polite pool" bei CrossRef. |
| `HALLUCITE_DBLP` | Optional: Pfad zu einer lokalen DBLP-SQLite-Datei (persistentes Volume nötig, ~2,5 GB). Ohne diese Variable fragt der Dienst DBLP live online ab — für den Start ausreichend. |
| `HALLUCITE_CACHE` | Optional: Pfad zu einer SQLite-Cache-Datei, spart wiederholte Abfragen über Neustarts hinweg. |
| `HALLUCITE_DISABLED_DBS` | Optional: Kommagetrennte Liste zu deaktivierender Datenbanken (`crossref,arxiv,dblp,semantic_scholar,acl,neurips,ssrn,europe_pmc,pubmed,openalex`). |

## Freizugebende Domains (ausgehend, für die Uni-Firewall irrelevant, da der
Dienst NICHT auf dem Uni-Server läuft — hier nur zur Info, falls doch mal
lokal getestet wird)

- `pypi.org`, `files.pythonhosted.org` (Installation)
- `api.crossref.org`, `export.arxiv.org`, `dblp.org`, `api.semanticscholar.org`,
  `api.openalex.org`, `aclanthology.org`, `www.ebi.ac.uk`,
  `eutils.ncbi.nlm.nih.gov`, `doi.org` — je nachdem, welche DBs aktiv sind

## API

`POST /verify-pdf` — `multipart/form-data`, Feld `file` (PDF, max. 25 MB).

Antwort:

```json
{
  "references": [
    { "id": "1", "raw": "...", "title": "...", "authors": ["..."], "doi": null }
  ],
  "results": [
    {
      "referenceId": "1",
      "verdict": "verified",
      "confidence": 0.95,
      "source": "crossref",
      "matchedTitle": "...",
      "matchedAuthors": ["..."],
      "doi": "10.xxxx/...",
      "links": [{ "label": "crossref", "url": "https://..." }],
      "checkedDbs": ["crossref", "arxiv", "dblp"],
      "failedDbs": [],
      "retracted": false,
      "notes": null
    }
  ]
}
```

`GET /health` — einfacher Uptime-Check für Railway/Render.
