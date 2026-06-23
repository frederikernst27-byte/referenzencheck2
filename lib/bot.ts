import { parseReferences } from "./parse";
import { verifyReference } from "./verify";
import { sourceChain } from "./sources";
import { hasOpenRouter } from "./openrouter";
import { escapeHtml, sendChatAction, sendMessage } from "./telegram";
import { delUserKey, getUserKey, isPersistent, setUserKey } from "./kv";
import type { ParsedReference, VerificationResult } from "./types";

const MAX_REFS = 50; // Timeout-Schutz: nicht mehr Einträge pro Anfrage prüfen
const OR_KEYS_URL = "https://openrouter.ai/keys";

interface TgMessage {
  chat?: { id: number };
  from?: { id: number };
  text?: string;
}
interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
}

const VERDICT: Record<string, { icon: string; label: string }> = {
  verified: { icon: "✅", label: "Gefunden" },
  uncertain: { icon: "⚠️", label: "Unsicher" },
  not_found: { icon: "❌", label: "Nicht gefunden" },
  error: { icon: "⛔", label: "Fehler" },
};

/** Einfache Parallelitäts-Begrenzung (analog zu app/page.tsx). */
async function pool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/** Bricht das Warten nach ms ab (die Hintergrundarbeit läuft ggf. weiter). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Zeitüberschreitung")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function reminderFooter(): string {
  return (
    "\n\n💡 <b>Tipp:</b> Mit /setkey kannst du deinen eigenen OpenRouter-Key nutzen – " +
    "das ist schneller und schont meinen. Key erstellen: " +
    `<a href="${OR_KEYS_URL}">${OR_KEYS_URL}</a>`
  );
}

const HELP =
  "📚 <b>Referenzencheck-Bot</b>\n\n" +
  "Schick mir einfach dein <b>Literaturverzeichnis</b> (Text einfügen) und ich prüfe " +
  "jede Quelle gegen Google Scholar, Crossref, OpenAlex & Semantic Scholar – " +
  "um erfundene bzw. KI-halluzinierte Referenzen aufzudecken und echte Links zu liefern.\n\n" +
  "<b>Befehle</b>\n" +
  "• /setkey <code>sk-or-…</code> – eigenen OpenRouter-Key hinterlegen\n" +
  "• /clearkey – eigenen Key wieder entfernen\n" +
  "• /status – aktive Quellen & Key-Status\n" +
  "• /help – diese Hilfe\n\n" +
  `Eigenen Key erstellen: <a href="${OR_KEYS_URL}">${OR_KEYS_URL}</a>`;

function formatResult(n: number, r: VerificationResult): string {
  const v = VERDICT[r.verdict] || VERDICT.error;
  const ref = r.reference;
  const head = ref.title || ref.raw;
  let out = `${v.icon} <b>${n}. ${v.label}</b>`;
  if (r.confidence) out += ` · ${Math.round(r.confidence * 100)}%`;
  out += `\n${escapeHtml(head.slice(0, 300))}`;
  if (r.bestMatch?.matchedTitle && r.verdict !== "not_found") {
    out += `\n↳ Treffer: ${escapeHtml(r.bestMatch.matchedTitle.slice(0, 200))} (${escapeHtml(
      r.bestMatch.source
    )}${r.bestMatch.matchedYear ? `, ${r.bestMatch.matchedYear}` : ""})`;
  }
  const link = r.links[0];
  if (link) out += `\n🔗 <a href="${escapeHtml(link.url)}">${escapeHtml(link.label || link.url)}</a>`;
  if (r.notes) out += `\nℹ️ ${escapeHtml(r.notes.slice(0, 300))}`;
  return out;
}

async function handleCommand(chatId: number, text: string): Promise<boolean> {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ""); // /cmd@BotName -> /cmd

  if (cmd === "/start" || cmd === "/help") {
    await sendMessage(chatId, HELP);
    return true;
  }

  if (cmd === "/setkey") {
    const key = rest.join(" ").trim();
    if (!key) {
      await sendMessage(chatId, "Bitte den Key mitsenden:\n<code>/setkey sk-or-…</code>");
      return true;
    }
    if (!/^sk-or-/.test(key)) {
      await sendMessage(
        chatId,
        "Das sieht nicht nach einem OpenRouter-Key aus (beginnt mit <code>sk-or-</code>). " +
          `Key erstellen: <a href="${OR_KEYS_URL}">${OR_KEYS_URL}</a>`
      );
      return true;
    }
    if (!isPersistent()) {
      await sendMessage(
        chatId,
        "⚠️ Dauerhaftes Speichern ist auf dem Server nicht konfiguriert – dein Key kann " +
          "gerade nicht zuverlässig gemerkt werden. Bitte den Betreiber, Vercel KV / Upstash zu aktivieren."
      );
      return true;
    }
    await setUserKey(chatId, key);
    await sendMessage(
      chatId,
      "✅ Dein OpenRouter-Key ist gespeichert und wird ab jetzt für deine Prüfungen genutzt.\n" +
        "🔒 Bitte <b>lösche die Nachricht mit dem Key</b> aus dem Chat. Entfernen mit /clearkey."
    );
    return true;
  }

  if (cmd === "/clearkey") {
    await delUserKey(chatId);
    await sendMessage(chatId, "🗑️ Dein gespeicherter Key wurde entfernt. Es gilt wieder der Server-Key.");
    return true;
  }

  if (cmd === "/status") {
    const sources = sourceChain().map((s) => s.name);
    const own = (await getUserKey(chatId)) ? "eigener Key" : "Server-Key";
    await sendMessage(
      chatId,
      "<b>Status</b>\n" +
        `Aktive Quellen: ${sources.length ? escapeHtml(sources.join(", ")) : "—"}\n` +
        `KI-Bewertung: ${hasOpenRouter() ? "an" : "aus"}\n` +
        `Dein KI-Key: ${own}`
    );
    return true;
  }

  if (cmd.startsWith("/")) {
    await sendMessage(chatId, "Unbekannter Befehl. /help zeigt alle Befehle.");
    return true;
  }

  return false; // kein Befehl
}

async function safeSend(chatId: number, msg: string): Promise<void> {
  try {
    await sendMessage(chatId, msg);
  } catch {
    /* einzelner Sendefehler darf den Ablauf nicht abbrechen */
  }
}

/** Basis-URL für interne Self-Calls (Fan-out an die Worker-Route). */
function selfBaseUrl(origin?: string): string | undefined {
  if (origin) return origin.replace(/\/+$/, "");
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return v ? `https://${v}` : undefined;
}

/**
 * Prüft EINE Referenz und sendet das Ergebnis sofort an den Chat.
 * Wird sowohl inline (Fallback) als auch von der Worker-Route aufgerufen –
 * dort läuft jede Referenz in einer eigenen Funktion mit eigenem Zeitbudget.
 */
export async function verifyOneAndSend(
  chatId: number,
  index: number,
  ref: ParsedReference,
  userKey?: string
): Promise<string> {
  try {
    const r = await withTimeout(verifyReference(ref, userKey), 50000);
    await safeSend(chatId, formatResult(index, r));
    return r.verdict;
  } catch {
    await safeSend(
      chatId,
      `${VERDICT.error.icon} <b>${index}. Konnte nicht geprüft werden</b>\n${escapeHtml(ref.raw.slice(0, 200))}`
    );
    return "error";
  }
}

async function handleBibliography(chatId: number, text: string, origin?: string): Promise<void> {
  const userKey = await getUserKey(chatId);
  const usingServerKey = !userKey;

  await sendChatAction(chatId, "typing");
  await sendMessage(chatId, "🔎 Ich erkenne und prüfe deine Referenzen … das kann einen Moment dauern.");

  let refs: ParsedReference[];
  try {
    refs = await parseReferences(text, userKey);
  } catch (e: any) {
    await sendMessage(chatId, `⛔ Konnte den Text nicht verarbeiten: ${escapeHtml(e?.message || "Fehler")}`);
    return;
  }

  if (!refs.length) {
    await sendMessage(chatId, "Ich konnte keine Referenzen erkennen. Bitte füge ein Literaturverzeichnis ein.");
    return;
  }

  let capped = false;
  if (refs.length > MAX_REFS) {
    refs = refs.slice(0, MAX_REFS);
    capped = true;
  }

  await sendMessage(
    chatId,
    `📑 <b>${refs.length} Referenzen erkannt</b>${capped ? ` (auf ${MAX_REFS} begrenzt)` : ""} – prüfe …`
  );

  const counts = { verified: 0, uncertain: 0, not_found: 0, error: 0 };
  const tally = (verdict: string) => {
    (counts as any)[verdict] = ((counts as any)[verdict] || 0) + 1;
  };

  const base = selfBaseUrl(origin);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

  if (base) {
    // Fan-out: jede Referenz in einer EIGENEN Serverless-Funktion prüfen. Dadurch
    // hat jede Referenz ihr eigenes 60-s-Budget und sendet ihr Ergebnis selbst –
    // ein Timeout dieser Funktion kann die Einzel-Ergebnisse nicht mehr verhindern.
    const settled = await Promise.allSettled(
      refs.map((ref, idx) =>
        fetch(`${base}/api/telegram/worker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, index: idx + 1, ref, userKey, secret }),
        }).then((r) => r.json() as Promise<{ verdict?: string }>)
      )
    );
    settled.forEach((s) => tally(s.status === "fulfilled" && s.value?.verdict ? s.value.verdict : "error"));
  } else {
    // Fallback (z. B. lokal ohne Self-URL): inline mit Concurrency-Pool.
    await pool(refs, 4, async (ref, idx) => {
      tally(await verifyOneAndSend(chatId, idx + 1, ref, userKey));
    });
  }

  let summary =
    "<b>Zusammenfassung</b>\n" +
    `✅ Gefunden: ${counts.verified}\n` +
    `⚠️ Unsicher: ${counts.uncertain}\n` +
    `❌ Nicht gefunden: ${counts.not_found}` +
    (counts.error ? `\n⛔ Fehler/Timeout: ${counts.error}` : "");
  if (usingServerKey) summary += reminderFooter();
  await safeSend(chatId, summary);
}

/** Verarbeitet ein einzelnes Telegram-Update (Hintergrundarbeit). */
export async function processUpdate(update: TgUpdate, origin?: string): Promise<void> {
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;
  if (!chatId || !text || !text.trim()) return;

  try {
    const wasCommand = await handleCommand(chatId, text);
    if (!wasCommand) await handleBibliography(chatId, text, origin);
  } catch (e: any) {
    try {
      await sendMessage(chatId, `⛔ Es ist ein Fehler aufgetreten: ${escapeHtml(e?.message || "unbekannt")}`);
    } catch {
      /* nichts mehr zu tun */
    }
  }
}
