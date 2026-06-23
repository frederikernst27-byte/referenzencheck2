const API_BASE = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN ist nicht gesetzt");
  return t;
}

export function hasTelegram(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** Roher Aufruf der Telegram-Bot-API. */
async function tgCall(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(`Telegram ${method} fehlgeschlagen: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.result;
}

/** Escaped Text für parse_mode "HTML". */
export function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_LEN = 3500; // Sicherheitsmarge unter Telegrams 4096-Zeichen-Limit

/** Zerlegt langen Text an Zeilengrenzen in Telegram-taugliche Stücke. */
function chunk(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const parts: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    // Einzelne überlange Zeile hart schneiden.
    if (line.length > MAX_LEN) {
      if (buf) {
        parts.push(buf);
        buf = "";
      }
      for (let i = 0; i < line.length; i += MAX_LEN) parts.push(line.slice(i, i + MAX_LEN));
      continue;
    }
    if ((buf + "\n" + line).length > MAX_LEN) {
      parts.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/** Sendet eine (ggf. mehrteilige) HTML-Nachricht. */
export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  for (const part of chunk(text)) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: part,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

export async function sendChatAction(chatId: number | string, action = "typing"): Promise<void> {
  try {
    await tgCall("sendChatAction", { chat_id: chatId, action });
  } catch {
    /* unkritisch */
  }
}

export async function setWebhook(url: string, secret: string): Promise<any> {
  return tgCall("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(): Promise<any> {
  return tgCall("deleteWebhook", { drop_pending_updates: true });
}
