import { NextRequest, NextResponse } from "next/server";
import { parseReferences } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: unknown = body?.text;
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Kein Text übergeben." }, { status: 400 });
    }
    if (text.length > 60000) {
      return NextResponse.json(
        { error: "Text zu lang (max. 60.000 Zeichen)." },
        { status: 413 }
      );
    }
    const references = await parseReferences(text);
    return NextResponse.json({ references });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Parsing fehlgeschlagen." },
      { status: 500 }
    );
  }
}
