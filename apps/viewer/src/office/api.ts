import type { OfficeSnapshot } from '@ara/shared';
import { withToken } from '../api.ts';
import type { ChatMsg } from '../store.ts';

/** Haalt het kantoor van één project op (branche-specifiek samengesteld). */
export async function loadOffice(project: string): Promise<OfficeSnapshot | null> {
  try {
    const res = await fetch(withToken(`/office/${encodeURIComponent(project)}`));
    if (!res.ok) return null;
    return (await res.json()) as OfficeSnapshot;
  } catch {
    return null;
  }
}

export async function loadChat(room: string): Promise<ChatMsg[]> {
  try {
    const res = await fetch(withToken(`/chat?room=${encodeURIComponent(room)}`));
    if (!res.ok) return [];
    return ((await res.json()) as { messages: ChatMsg[] }).messages;
  } catch {
    return [];
  }
}

/**
 * Stuurt een bericht de kantoorruimte in. De collector zet hem óók als taak op
 * het bord bij `to`, zodat de watchdog die rol wakker maakt en er echt iemand
 * antwoordt.
 */
export async function sendChat(input: {
  room: string;
  text: string;
  to: string;
  project: string;
}): Promise<ChatMsg | null> {
  try {
    const res = await fetch(withToken('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, role: 'user', sender: 'jij' }),
    });
    if (!res.ok) return null;
    // Het bericht van de server heeft het echte id; de SSE-echo van datzelfde
    // bericht wordt daardoor door de id-dedupe genegeerd (geen dubbele regel).
    return ((await res.json()) as { message?: ChatMsg }).message ?? null;
  } catch {
    return null;
  }
}
