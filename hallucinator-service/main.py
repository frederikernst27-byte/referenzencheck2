"""
hallucite-service — kleiner FastAPI-Wrapper um das `hallucinator`-Paket
(https://github.com/gianlucasb/hallucinator).

Nimmt ein PDF entgegen, extrahiert die Referenzen (Rust/MuPDF, kein
externes pdftotext nötig) und prüft sie gegen CrossRef, arXiv, DBLP,
Semantic Scholar & Co. Gibt ein JSON zurück, das die Next.js-App
(app/api/pdf-verify/route.ts) direkt in ihre bestehenden Typen mappt.

Lokal starten:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Deployment: siehe README.md in diesem Ordner (Railway/Render/Fly.io).
"""

import os
import tempfile
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from hallucinator import PdfExtractor, Validator, ValidatorConfig

app = FastAPI(title="hallucite-service", version="1.0.0")

# Nur die eigene Vercel-Domain (und ggf. localhost) sollte diesen Dienst
# aufrufen dürfen. ALLOWED_ORIGINS als kommagetrennte Liste setzen, z. B.
# "https://referenzencheck2.vercel.app,http://localhost:3000"
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

MAX_PDF_BYTES = 25 * 1024 * 1024  # 25 MB

_validator: Optional[Validator] = None


def get_validator() -> Validator:
    """Ein Validator wird einmal gebaut und wiederverwendet (siehe hallucinator-Doku:
    'Creating many validators is wasteful — reuse a single instance')."""
    global _validator
    if _validator is None:
        config = ValidatorConfig()

        if os.environ.get("SEMANTIC_SCHOLAR_KEY"):
            config.s2_api_key = os.environ["SEMANTIC_SCHOLAR_KEY"]
        if os.environ.get("OPENALEX_KEY"):
            config.openalex_key = os.environ["OPENALEX_KEY"]
        if os.environ.get("CROSSREF_MAILTO"):
            config.crossref_mailto = os.environ["CROSSREF_MAILTO"]

        # Optional: lokale DBLP-Offline-DB, falls per Volume gemountet
        # (siehe README.md — für den Start nicht nötig, Validator fragt
        # dann online gegen dblp.org).
        dblp_path = os.environ.get("HALLUCITE_DBLP")
        if dblp_path and os.path.exists(dblp_path):
            config.dblp_offline_path = dblp_path

        # Optional: persistenter Cache, spart wiederholte Abfragen
        cache_path = os.environ.get("HALLUCITE_CACHE")
        if cache_path:
            config.cache_path = cache_path

        disabled = os.environ.get("HALLUCITE_DISABLED_DBS")
        if disabled:
            config.disabled_dbs = [d.strip() for d in disabled.split(",") if d.strip()]

        _validator = Validator(config)
    return _validator


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/verify-pdf")
async def verify_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Nur PDF-Dateien werden unterstützt.")

    content = await file.read()
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF zu groß (max. 25 MB).")
    if not content:
        raise HTTPException(400, "Leere Datei.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        extractor = PdfExtractor()
        try:
            extraction = extractor.extract(tmp_path)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"PDF-Extraktion fehlgeschlagen: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    if not extraction.references:
        raise HTTPException(
            422,
            "Es konnten keine Referenzen im PDF gefunden werden. "
            "Ggf. ist das Literaturverzeichnis ungewöhnlich formatiert.",
        )

    validator = get_validator()
    validation_results = validator.check(extraction.references)

    references = []
    results = []

    for i, (ref, res) in enumerate(zip(extraction.references, validation_results)):
        ref_id = str(i + 1)
        references.append(
            {
                "id": ref_id,
                "raw": ref.raw_citation,
                "title": ref.title,
                "authors": list(ref.authors) if ref.authors else None,
                "doi": ref.doi,
            }
        )

        verdict = {
            "verified": "verified",
            "author_mismatch": "uncertain",
            "not_found": "not_found",
        }.get(res.status, "error")

        # hallucinator liefert keinen numerischen Score wie unsere alte
        # Similarity-Pipeline -> grobe Heuristik nach Status.
        confidence = {"verified": 0.95, "author_mismatch": 0.55, "not_found": 0.3}.get(
            res.status, 0.0
        )

        links = []
        if res.paper_url:
            links.append({"label": res.source or "Quelle", "url": res.paper_url})
        if res.doi_info and res.doi_info.doi:
            links.append({"label": "DOI", "url": f"https://doi.org/{res.doi_info.doi}"})
        if res.arxiv_info and res.arxiv_info.arxiv_id:
            links.append(
                {"label": "arXiv", "url": f"https://arxiv.org/abs/{res.arxiv_info.arxiv_id}"}
            )

        retracted = bool(res.retraction_info and res.retraction_info.is_retracted)
        notes = None
        if retracted:
            notes = "Achtung: Dieses Paper wurde zurückgezogen (Retraction erkannt)."
            if res.retraction_info.retraction_source:
                notes += f" Quelle: {res.retraction_info.retraction_source}."

        results.append(
            {
                "referenceId": ref_id,
                "verdict": verdict,
                "confidence": confidence,
                "source": res.source,
                "matchedTitle": res.title,
                "matchedAuthors": list(res.found_authors) if res.found_authors else None,
                "doi": res.doi_info.doi if res.doi_info else None,
                "links": links,
                "checkedDbs": [db.db_name for db in res.db_results],
                "failedDbs": list(res.failed_dbs) if res.failed_dbs else [],
                "retracted": retracted,
                "notes": notes,
            }
        )

    return {"references": references, "results": results}
