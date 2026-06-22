import { NextRequest, NextResponse } from "next/server";
import { verifyReference } from "@/lib/verify";
import type { ParsedReference } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reference: ParsedReference | undefined = body?.reference;
    if (!reference || typeof reference.raw !== "string" || !reference.raw.trim()) {
      return NextResponse.json({ error: "Keine gültige Referenz übergeben." }, { status: 400 });
    }
    const apiKey = typeof body?.openrouterKey === "string" ? body.openrouterKey.trim() || undefined : undefined;
    const result = await verifyReference(reference, apiKey);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Verifizierung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
