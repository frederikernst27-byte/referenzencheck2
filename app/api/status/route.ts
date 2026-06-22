import { NextResponse } from "next/server";
import { allSourceNames, sourceChain } from "@/lib/sources";
import { hasOpenRouter } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Zeigt an, welche Quellen/Keys konfiguriert sind (ohne die Keys preiszugeben). */
export async function GET() {
  const active = new Set(sourceChain().map((s) => s.name));
  const sources = allSourceNames().map((name) => ({ name, active: active.has(name) }));
  return NextResponse.json({
    sources,
    llm: hasOpenRouter(),
    model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
  });
}
