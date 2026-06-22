const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function hasOpenRouter(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function openRouterChat(
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY ist nicht gesetzt");

  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
  const { json = false, temperature = 0, timeoutMs = 45000 } = opts;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://referenzencheck.vercel.app",
        "X-Title": "Referenzencheck",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(t);
  }
}

/** Robustes JSON-Parsing: entfernt Markdown-Fences und sucht das erste JSON-Objekt. */
export function safeJsonParse<T = any>(content: string): T {
  let s = (content || "").trim();
  // ```json ... ``` Fences entfernen
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(s.slice(start, end + 1)) as T;
    }
    throw new Error("Konnte JSON-Antwort nicht parsen");
  }
}
