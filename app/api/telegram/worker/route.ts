import { NextRequest, NextResponse } from "next/server";
import { verifyOneAndSend } from "@/lib/bot";
import type { ParsedReference } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Interner Worker: prüft EINE Referenz und sendet das Ergebnis an den Chat.
 * Wird vom Telegram-Webhook per Fan-out aufgerufen, damit jede Referenz ein
 * eigenes Funktions-Zeitbudget bekommt. Durch das Secret abgesichert.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "kein JSON" }, { status: 400 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && body?.secret !== secret) {
    return NextResponse.json({ ok: false, error: "Falsches Secret" }, { status: 401 });
  }

  const chatId = Number(body?.chatId);
  const ref = body?.ref as ParsedReference | undefined;
  if (!chatId || !ref || typeof ref.raw !== "string") {
    return NextResponse.json({ ok: false, error: "Ungültige Anfrage" }, { status: 400 });
  }

  const verdict = await verifyOneAndSend(
    chatId,
    Number(body?.index) || 0,
    ref,
    typeof body?.userKey === "string" && body.userKey ? body.userKey : undefined
  );

  return NextResponse.json({ ok: true, verdict });
}
