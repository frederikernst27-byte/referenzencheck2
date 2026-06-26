import { NextRequest, NextResponse } from "next/server";
import { normalizeReferences } from "@/lib/parse";
import type { ParsedReference } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey =
      typeof body?.openrouterKey === "string" ? body.openrouterKey.trim() || undefined : undefined;
    const refs: ParsedReference[] = Array.isArray(body?.references) ? body.references : [];
    if (!refs.length) {
      return NextResponse.json({ error: "Keine Referenzen übergeben." }, { status: 400 });
    }
    const normalized = await normalizeReferences(refs, apiKey);
    return NextResponse.json({ references: normalized });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Normalisierung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
