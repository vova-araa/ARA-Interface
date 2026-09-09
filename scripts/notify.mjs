#!/usr/bin/env node
/**
 * Telegram-notifier. Stuurt een bericht naar je Telegram wanneer
 * ARA_TELEGRAM_BOT_TOKEN + ARA_TELEGRAM_CHAT_ID gezet zijn; anders no-op.
 *
 *   node scripts/notify.mjs "tekst"        (of import { sendTelegram })
 *   ARA_NOTIFY_DRYRUN=1 → print de payload i.p.v. versturen (test).
 *
 * Setup (eenmalig): maak een bot via @BotFather → token; stuur de bot een
 * bericht en haal je chat_id op via https://api.telegram.org/bot<token>/getUpdates
 */
export async function sendTelegram(text) {
  const token = process.env.ARA_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ARA_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: 'not-configured' };

  const payload = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  };
  if (process.env.ARA_NOTIFY_DRYRUN === '1') {
    console.log(`[notify dryrun] ${JSON.stringify(payload)}`);
    return { sent: true, reason: 'dryrun' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { sent: res.ok, reason: `http-${res.status}` };
  } catch (error) {
    return { sent: false, reason: String(error).slice(0, 80) };
  }
}

// CLI-gebruik
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(' ');
  if (text) {
    const result = await sendTelegram(text);
    console.log(`[notify] sent=${result.sent} (${result.reason})`);
  }
}
