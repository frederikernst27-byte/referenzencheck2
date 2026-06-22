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
  opts: {
    json?: boolean;
    temperature?: number;
    timeoutMs?: number;
    maxTokens?: number;
    model?: string;
  } = {}
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY ist nicht gesetzt");

  const model = opts.model || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
  const { json = false, temperature = 0, timeoutMs = 45000, maxTokens } = opts;

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
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
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

/**
 * Bergt aus (ggf. abgeschnittenem) Text alle vollständigen Objekte des
 * `references`-Arrays. So gehen bei einer durch das Token-Limit abgeschnittenen
 * Antwort nicht alle Referenzen verloren – die vollständig übertragenen bleiben.
 */
function salvageReferences(s: string): { references: any[] } | null {
  const keyIdx = s.indexOf('"references"');
  if (keyIdx === -1) return null;
  const arrStart = s.indexOf("[", keyIdx);
  if (arrStart === -1) return null;

  const objs: any[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;

  for (let i = arrStart + 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          objs.push(JSON.parse(s.slice(objStart, i + 1)));
        } catch {
          /* unvollständiges Objekt überspringen */
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return objs.length ? { references: objs } : null;
}

/** Robustes JSON-Parsing: entfernt Markdown-Fences, birgt abgeschnittene Antworten. */
export function safeJsonParse<T = any>(content: string): T {
  let s = (content || "").trim();
  // ```json ... ``` Fences entfernen
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* weiter mit Heuristiken */
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1)) as T;
    } catch {
      /* weiter mit Salvage */
    }
  }
  const salvaged = salvageReferences(s);
  if (salvaged) return salvaged as T;
  throw new Error("Konnte JSON-Antwort nicht parsen");
}
