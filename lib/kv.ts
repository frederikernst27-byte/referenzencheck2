/**
 * Minimaler Key-Value-Speicher für per-Chat hinterlegte OpenRouter-Keys.
 *
 * Nutzt eine Upstash-/Vercel-KV-REST-API, wenn die entsprechenden Env-Vars
 * gesetzt sind (beide gängigen Namens-Paare werden unterstützt). Ist nichts
 * konfiguriert, greift ein In-Memory-Fallback: lokal funktional, in Serverless
 * aber nicht über Kaltstarts hinweg persistent. `isPersistent()` macht das nach
 * außen sichtbar, damit der Bot ehrlich kommunizieren kann.
 */

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function isPersistent(): boolean {
  return !!(REST_URL && REST_TOKEN);
}

const mem = new Map<string, string>();

/** Führt einen Redis-Befehl über die Upstash-REST-API aus. */
async function rest(command: (string | number)[]): Promise<any> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`KV ${command[0]} fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return data?.result;
}

export async function kvGet(key: string): Promise<string | null> {
  if (!isPersistent()) return mem.get(key) ?? null;
  const r = await rest(["GET", key]);
  return typeof r === "string" ? r : null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (!isPersistent()) {
    mem.set(key, value);
    return;
  }
  await rest(["SET", key, value]);
}

export async function kvDel(key: string): Promise<void> {
  if (!isPersistent()) {
    mem.delete(key);
    return;
  }
  await rest(["DEL", key]);
}

const userKey = (chatId: number | string) => `or_key:${chatId}`;

export async function getUserKey(chatId: number | string): Promise<string | undefined> {
  return (await kvGet(userKey(chatId))) || undefined;
}

export async function setUserKey(chatId: number | string, key: string): Promise<void> {
  await kvSet(userKey(chatId), key);
}

export async function delUserKey(chatId: number | string): Promise<void> {
  await kvDel(userKey(chatId));
}
