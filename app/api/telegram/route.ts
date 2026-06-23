import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { processUpdate } from "@/lib/bot";
import { hasTelegram, setWebhook } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Eingehende Telegram-Updates. Sofort 200, Verarbeitung im Hintergrund. */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get(SECRET_HEADER) !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!hasTelegram()) {
    return NextResponse.json({ ok: false, error: "Bot nicht konfiguriert" }, { status: 503 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // nichts zu verarbeiten
  }

  // Eigene Basis-URL bestimmen (für das Fan-out an die Worker-Route).
  const host = req.headers.get("x-forwarded-host") || new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;

  // Telegram darf nicht auf die (langsame) Verifizierung warten -> Hintergrund.
  after(async () => {
    try {
      await processUpdate(update as any, origin);
    } catch {
      /* Fehler werden in processUpdate behandelt */
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * GET ohne Parameter: Health-Info.
 * GET ?setup=1&secret=<TELEGRAM_WEBHOOK_SECRET>: registriert den Webhook auf
 * https://<host>/api/telegram inkl. secret_token.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("setup") !== "1") {
    return NextResponse.json({ ok: true, bot: hasTelegram() ? "konfiguriert" : "kein Token" });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_WEBHOOK_SECRET ist nicht gesetzt." },
      { status: 500 }
    );
  }
  if (url.searchParams.get("secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Falsches Secret." }, { status: 401 });
  }
  if (!hasTelegram()) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN ist nicht gesetzt." },
      { status: 500 }
    );
  }

  const host = req.headers.get("x-forwarded-host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const webhookUrl = `${proto}://${host}/api/telegram`;
  try {
    const result = await setWebhook(webhookUrl, secret);
    return NextResponse.json({ ok: true, webhook: webhookUrl, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "setWebhook fehlgeschlagen" }, { status: 500 });
  }
}
