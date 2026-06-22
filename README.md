# 📚 Referenzencheck

Ein Scanner für Literaturverzeichnisse, der prüft, ob die zitierten Quellen
**wirklich existieren** – um KI-Halluzinationen und erfundene Referenzen
aufzudecken. Am Ende werden die Links zu den tatsächlich gefundenen Papern
zurückgegeben.

## Funktionsweise

1. **Parsing** – Das eingefügte Literaturverzeichnis wird mit **DeepSeek
   (über OpenRouter)** in einzelne, strukturierte Referenzen zerlegt
   (Titel, Autoren, Jahr, DOI …). Ohne OpenRouter-Key greift eine
   regelbasierte Heuristik.
2. **Verifizierung** – Jede Referenz wird nacheinander gegen folgende Dienste
   geprüft (Kette stoppt beim ersten sicheren Treffer):

   `SERP API` → `ScraperAPI` → `SearchApi` → `Scrapingdog`
   → `Crossref` → `OpenAlex` → `Semantic Scholar`

3. **Bewertung** – Titel-Ähnlichkeit (Dice-Koeffizient + Token-Containment)
   und DOI-Abgleich ergeben einen Score. Optional bewertet DeepSeek zusätzlich,
   ob ein gefundener Treffer wirklich zur Referenz passt.
4. **Ergebnis** – Pro Referenz: `Gefunden` / `Unsicher` /
   `Nicht gefunden (mögliche Halluzination)` plus alle gefundenen Links.

## Tech-Stack

- Next.js 14 (App Router, TypeScript)
- Serverless Route Handlers (`/api/parse`, `/api/verify`, `/api/status`)
- Keine Datenbank nötig – zustandslos, ideal für Vercel

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local   # Keys eintragen
npm run dev
```

→ http://localhost:3000

## Environment-Variablen

Alle Keys sind **optional** – fehlt ein Key, wird die jeweilige Quelle
übersprungen. Crossref/OpenAlex/Semantic Scholar funktionieren ohne Key.

| Variable | Zweck |
|---|---|
| `SERPAPI_KEY` | Google Scholar via SERP API |
| `SCRAPERAPI_KEY` | Google Scholar via ScraperAPI |
| `SEARCHAPI_KEY` | Google Scholar via SearchApi.io |
| `SCRAPINGDOG_KEY` | Google Scholar via Scrapingdog |
| `SEMANTIC_SCHOLAR_KEY` | Höhere Rate-Limits (optional) |
| `CROSSREF_MAILTO` / `OPENALEX_MAILTO` | "Polite Pool" der freien APIs |
| `OPENROUTER_API_KEY` | KI-Parsing & Treffer-Bewertung (DeepSeek) |
| `OPENROUTER_MODEL` | Modell-ID, Standard `deepseek/deepseek-chat` |

## Deployment (Vercel)

Das Projekt ist ein Standard-Next.js-Projekt und wird von Vercel automatisch
erkannt. Environment-Variablen im Vercel-Dashboard hinterlegen.

> **Hinweis:** API-Keys gehören ausschließlich in Environment-Variablen,
> niemals in den Code oder ins Repo.
