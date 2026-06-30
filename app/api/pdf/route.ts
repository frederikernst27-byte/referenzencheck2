import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { extractReferencesSection } from "@/lib/parse";

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

    // Bei ganzen Artikeln direkt nur den Literaturverzeichnis-Abschnitt zurückgeben,
    // damit der Nutzer sofort die Referenzen sieht (statt des ganzen PDFs).
    const references = extractReferencesSection(cleaned);

    return NextResponse.json({ text: references });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "PDF-Verarbeitung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
