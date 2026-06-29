import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Keine PDF-Datei übermittelt." }, { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    // unpdf nutzt einen serverless-tauglichen pdf.js-Build (keine nativen
    // Abhängigkeiten, kein Worker) – läuft auf Vercel ohne Crash.
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });

    const cleaned = text.trim();

    if (!cleaned) {
      return NextResponse.json({ error: "PDF enthält keinen lesbaren Text." }, { status: 422 });
    }

    return NextResponse.json({ text: cleaned });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "PDF-Verarbeitung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
