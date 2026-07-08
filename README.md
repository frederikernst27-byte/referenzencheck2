# 📚 Referenzencheck

Ein Scanner für Literaturverzeichnisse, der prüft, ob die zitierten Quellen
**wirklich existieren** – um KI-Halluzinationen und erfundene Referenzen
aufzudecken. Am Ende werden die Links zu den tatsächlich gefundenen Papern
zurückgegeben.

Es gibt zwei Eingabewege:

- **Text einfügen** – Literaturverzeichnis als Text einfügen oder per PDF-Button
  den Text extrahieren lassen (bestehender Weg, siehe unten).
- **PDF direkt prüfen** *(Beta, optional)* – ganzes PDF hochladen; Extraktion
  und Prüfung laufen in einem Schritt über die separat gehostete
  [`hallucinator`](https://github.com/gianlucasb/hallucinator)-Engine (siehe
  „PDF-Direktprüfung" weiter unten). Ohne konfigurierten Dienst bleibt der Tab
  sichtbar, aber deaktiviert.

## Funktionsweise

1. **Parsing** – Das eingefügte Literaturverzeichnis wird mit **DeepSeek
   (über OpenRouter)** in einzelne, strukturierte Referenzen zerlegt
   (Titel, Autoren, Jahr, DOI …). Ohne OpenRouter-Key greift eine
   regelbasierte Heuristik.
2. **Verifizierung** – Jede Referenz wird nacheinander gegen folgende Dienste
   geprüft (Kette stoppt beim ersten sicheren Treffer):

   `SERP API` → `ScrapingBee` → `ScraperAPI` → `SearchApi` → `Scrapingdog`
   → `Crossref` → `OpenAlex` → `Semantic Scholar`

   `ScrapingBee` dient als Backup für die SERP API: Fällt diese aus (z. B.
   Kontingent aufgebraucht), übernimmt automatisch die nächste Quelle.

3. **Bewertung** – Titel-Ähnlichkeit (Dice-Koeffizient + Token-Containment)
   und DOI-Abgleich ergeben einen Score. Optional bewertet DeepSeek zusätzlich,
   ob ein gefundener Treffer wirklich zur Referenz passt.
4. **Ergebnis** – Pro Referenz: `Gefunden` / `Unsicher` /
   `Nicht gefunden (mögliche Halluzination)` plus alle gefundenen Links.

## PDF-Direktprüfung (Beta, optional)

Statt Text einzufügen, kann im Modus „PDF direkt prüfen" ein ganzes PDF
hochgeladen werden. Die App leitet es an einen separat gehosteten
`hallucinator-service` weiter (Env-Var `HALLUCINATOR_SERVICE_URL`), der:

1. die Referenzen direkt aus dem PDF extrahiert (Rust/MuPDF, kein manuelles
   Kopieren nötig),
2. jede Referenz parallel gegen CrossRef, arXiv, DBLP, Semantic Scholar u. a.
   prüft, inkl. Retraction-Check,
3. die Ergebnisse mit denselben Komponenten wie im Text-Modus anzeigt
   (Übersicht, Kartenliste, Excel-Export) – allerdings ohne die
   Zwischenschritt-Review einzelner Referenzen.

Der Dienst läuft **nicht** auf Vercel (Python/Rust-Paket, längere Laufzeiten
pro Referenz als Vercel-Functions erlauben), sondern separat z. B. auf
Railway oder Render. Deploy-Anleitung, Kosten und Grenzen: siehe
[`hallucinator-service/README.md`](hallucinator-service/README.md). Ist
`HALLUCINATOR_SERVICE_URL` nicht gesetzt, bleibt der Tab im UI sichtbar, aber
deaktiviert.

## Tech-Stack

- Next.js (App Router, TypeScript)
- Serverless Route Handlers (`/api/parse`, `/api/verify`, `/api/status`,
  `/api/pdf`, `/api/pdf-verify`)
- Keine Datenbank nötig – zustandslos, ideal für Vercel
- PDF-Direktprüfung: separater `hallucinator-service` (Python/FastAPI,
  Rust-Paket `hallucinator`), nicht auf Vercel – siehe
  `hallucinator-service/README.md`

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
| `SCRAPINGBEE_KEY` | Google Scholar via ScrapingBee (Backup für SERP API) |
| `SCRAPERAPI_KEY` | Google Scholar via ScraperAPI |
| `SEARCHAPI_KEY` | Google Scholar via SearchApi.io |
| `SCRAPINGDOG_KEY` | Google Scholar via Scrapingdog |
| `SEMANTIC_SCHOLAR_KEY` | Höhere Rate-Limits (optional) |
| `CROSSREF_MAILTO` / `OPENALEX_MAILTO` | "Polite Pool" der freien APIs |
| `OPENROUTER_API_KEY` | KI-Parsing & Treffer-Bewertung (DeepSeek) |
| `OPENROUTER_MODEL` | Modell-ID, Standard `deepseek/deepseek-chat` |
| `OPENROUTER_PARSE_MODEL` | Optional eigenes Modell fürs Zerlegen der Referenzen (Fallback: `OPENROUTER_MODEL`) |
| `TELEGRAM_BOT_TOKEN` | Token des Telegram-Bots (von @BotFather) |
| `TELEGRAM_WEBHOOK_SECRET` | Geheimnis zur Absicherung des Telegram-Webhooks |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV / Upstash – Speicher für `/setkey` (alternativ `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) |
| `HALLUCINATOR_SERVICE_URL` | URL des separat gehosteten `hallucinator-service` (aktiviert den Modus „PDF direkt prüfen") |

## Telegram-Bot

Der Referenzencheck ist zusätzlich als Telegram-Bot nutzbar – dieselbe
Verifizierungs-Logik, nur über Chat. Nutzer fügen ihr Literaturverzeichnis ein
und erhalten pro Quelle `Gefunden` / `Unsicher` / `Nicht gefunden` plus Links.

**Befehle:** `/start`, `/help`, `/status`, `/setkey <sk-or-…>`, `/clearkey`

Standardmäßig läuft der Bot über den Server-`OPENROUTER_API_KEY`; nach jeder
Prüfung erinnert er daran, mit `/setkey` einen eigenen Key zu hinterlegen (spart
dem Betreiber Kosten). `/setkey` benötigt einen persistenten Speicher
(Vercel KV / Upstash).

### Einrichtung
1. Bot bei [@BotFather](https://t.me/BotFather) anlegen → Token kopieren.
2. In Vercel als Env-Vars setzen:
   - `TELEGRAM_BOT_TOKEN` = der Token von BotFather
   - `TELEGRAM_WEBHOOK_SECRET` = frei wählbares Geheimnis
3. *(Optional, nur für `/setkey`)* Vercel-KV-/Upstash-Integration hinzufügen –
   das setzt `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatisch.
4. Nach dem Deploy einmal im Browser aufrufen, um den Webhook zu registrieren:
   `https://<deine-domain>/api/telegram?setup=1&secret=<TELEGRAM_WEBHOOK_SECRET>`
   → Antwort `{"ok":true,...}`.

> **Hinweis:** Der Bot-Token gehört wie alle Keys ausschließlich in
> Environment-Variablen. Wurde er versehentlich öffentlich, bei BotFather mit
> `/revoke` neu generieren.

## Deployment

### Frontend (Vercel)

Das Projekt ist ein Standard-Next.js-Projekt und wird von Vercel automatisch
erkannt. Environment-Variablen im Vercel-Dashboard hinterlegen, inkl.
`HALLUCINATOR_SERVICE_URL` (optional, siehe oben).

> **Hinweis:** API-Keys gehören ausschließlich in Environment-Variablen,
> niemals in den Code oder ins Repo.

### PDF-Direktprüfung (optional, nicht Vercel)

Für den Modus „PDF direkt prüfen" zusätzlich `hallucinator-service/` als
eigenen Docker-Dienst bei Railway oder Render deployen (Details, Kosten und
Grenzen: `hallucinator-service/README.md`), danach die öffentliche URL als
`HALLUCINATOR_SERVICE_URL` in Vercel eintragen. Ohne diesen Schritt bleibt
der Text-Modus vollständig nutzbar, der PDF-Direktprüfung-Tab ist nur
deaktiviert.
