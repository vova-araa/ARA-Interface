import { isEscalated, type SourceAlert, type WorldSnapshot } from '@ara/shared';
import type { EventStore } from './db.ts';

/**
 * De actie-inbox: alles wat op een mens wacht, op één plek, met de knop erbij.
 *
 * De reden dat dit bestaat: het systeem kan van alles zelf, maar de dingen die
 * het níét zelf mag zijn precies de dingen die blijven liggen. Een niet
 * aangesloten databron, een voorstel dat op akkoord wacht, een sessie die vast
 * zit — die stonden allemaal op een andere plek, of nergens.
 *
 * Elke actie draagt het verzoek dat 'm afhandelt. De viewer hoeft niets te
 * weten over welk endpoint bij welk soort werk hoort; hij tekent de knop en
 * stuurt wat hier staat.
 */

export type ActionUrgency = 'blocking' | 'soon' | 'whenever';

export interface ActionButton {
  label: string;
  method: 'POST' | 'PATCH';
  path: string;
  /** Vaste velden voor het verzoek; de viewer mag er niets aan toevoegen. */
  body?: Record<string, unknown>;
  /** true = vragen of de gebruiker het zeker weet (onomkeerbaar of geld). */
  confirm?: boolean;
}

export interface Action {
  id: string;
  kind: 'trade-approval' | 'needs-human' | 'escalation' | 'incident' | 'data-source' | 'config' | 'source-alert';
  urgency: ActionUrgency;
  title: string;
  detail: string;
  /** Waar dit vandaan komt, zodat je erheen kunt klikken. */
  project?: string;
  venture?: string;
  createdAt: number;
  buttons: ActionButton[];
}

const URGENCY_ORDER: Record<ActionUrgency, number> = { blocking: 0, soon: 1, whenever: 2 };

export interface ActionInput {
  store: EventStore;
  snapshot: WorldSnapshot;
  /** Takken met hun playbook, zoals /org ze teruggeeft. */
  ventures: {
    id: string;
    label: string;
    playbook: { dataSources: { label: string; how: string; configured: boolean }[] };
  }[];
  tradingProblems: string[];
  /** Uit de bronbestanden (`sourceAlerts()` in @ara/shared): verlopen termijnen, posities zonder stop, … */
  sourceAlerts?: SourceAlert[];
  tradingHalted: boolean;
  haltReason: string;
  now: number;
}

/**
 * Stelt de lijst samen. Puur op de meegegeven stand — geen I/O — zodat de
 * volgorde en de inhoud te testen zijn zonder een draaiend systeem.
 */
export function buildActions(input: ActionInput): Action[] {
  const { store, snapshot, ventures, now } = input;
  const actions: Action[] = [];

  // ── Handelsvoorstellen die op akkoord wachten ──────────────────────────
  // Deze staan bovenaan omdat ze verlopen: een setup van drie uur geleden is
  // geen setup meer, en een oud "ja" is gevaarlijker dan geen antwoord.
  for (const intent of store.listIntents({ status: 'awaiting', limit: 20 })) {
    const minutes = Math.round((now - intent.createdAt) / 60_000);
    actions.push({
      id: `trade-${intent.id}`,
      kind: 'trade-approval',
      urgency: 'blocking',
      title: `${intent.side === 'buy' ? 'Koop' : 'Verkoop'} ${intent.qty} ${intent.instrument} op ${intent.entry}`,
      detail:
        `Stop ${intent.stop}${intent.target ? `, doel ${intent.target}` : ''} · voorgesteld door ` +
        `${intent.proposedBy} · ${minutes} min geleden\n${intent.reason}`,
      venture: intent.venture,
      createdAt: intent.createdAt,
      buttons: [
        {
          label: 'Akkoord',
          method: 'POST',
          path: `/trade/intents/${intent.id}/approve`,
          body: { by: 'mens' },
          // Geld. Altijd bevestigen, ook als de knop klein is.
          confirm: true,
        },
        {
          label: 'Afwijzen',
          method: 'POST',
          path: `/trade/intents/${intent.id}/reject`,
          body: { by: 'mens', note: 'afgewezen vanuit de actielijst' },
        },
      ],
    });
  }

  // ── Noodstop actief ────────────────────────────────────────────────────
  if (input.tradingHalted) {
    actions.push({
      id: 'trade-halted',
      kind: 'config',
      urgency: 'blocking',
      title: 'Handel ligt stil',
      detail: input.haltReason || 'geen reden vastgelegd',
      createdAt: now,
      buttons: [
        {
          label: 'Hervatten (terug naar papier)',
          method: 'POST',
          path: '/trade/resume',
          body: { by: 'mens' },
          confirm: true,
        },
      ],
    });
  }

  // ── Sessies die vastzitten ─────────────────────────────────────────────
  for (const session of Object.values(snapshot.sessions)) {
    if (!session.needsHuman || session.endedAt) continue;
    actions.push({
      id: `needs-${session.sessionId}`,
      kind: 'needs-human',
      urgency: 'blocking',
      title: `${session.project} wacht op jou`,
      detail: session.message ?? 'sessie vraagt om een besluit',
      project: session.project,
      createdAt: session.lastSeenAt,
      // Hier hoort geen knop: dit los je op in de sessie zelf, niet van afstand.
      buttons: [],
    });
  }

  // ── Escalaties en incidenten van het bord ──────────────────────────────
  for (const task of store.listTasks({ status: 'open', limit: 100 })) {
    const escalated = isEscalated(task);
    const incident = task.assignee === 'manager:ops';
    if (!escalated && !incident) continue;
    actions.push({
      id: `task-${task.id}`,
      kind: escalated ? 'escalation' : 'incident',
      urgency: escalated ? 'blocking' : 'soon',
      title: task.title,
      detail: task.result || task.detail.slice(0, 300),
      project: task.project || undefined,
      createdAt: task.updatedAt,
      buttons: [
        {
          label: 'Afhandelen',
          method: 'PATCH',
          path: `/tasks/${task.id}`,
          body: { status: 'done', result: 'afgehandeld vanuit de actielijst' },
        },
      ],
    });
  }

  // ── Databronnen die nog niet aangesloten zijn ──────────────────────────
  // Geen knop: dit is werk in een bestand, geen verzoek. Maar het hoort wel
  // zichtbaar te zijn, anders blijft elk kantoor stilletjes op voorbeeldcijfers
  // draaien en merkt niemand dat dat zo is.
  for (const venture of ventures) {
    for (const source of venture.playbook.dataSources) {
      if (source.configured) continue;
      actions.push({
        id: `source-${venture.id}-${source.label}`,
        kind: 'data-source',
        urgency: 'whenever',
        title: `${venture.label}: ${source.label} nog niet aangesloten`,
        detail: `${source.how}\n\nZet dit in plugins/ara/org.json onder de playbook van deze tak, met "configured": true.`,
        venture: venture.id,
        createdAt: 0,
        buttons: [],
      });
    }
  }

  // ── Wat in de bronbestanden ligt ───────────────────────────────────────
  // Een verlopen APK of een positie zonder stop stond alleen in het kantoor
  // van die tak — een plek waar je toevallig wel of niet in kijkt. Hier staat
  // het naast de rest van wat op jou wacht. Geen knop: ARA plant geen keuring
  // en zet geen stop; de lijst zegt wát er ligt.
  for (const alert of input.sourceAlerts ?? []) {
    actions.push({
      id: `src-${alert.id}`,
      kind: 'source-alert',
      urgency: alert.urgency,
      title: `${ventures.find((v) => v.id === alert.venture)?.label ?? alert.venture}: ${alert.title}`,
      detail: `${alert.detail}\n\nBron: data/sources/${alert.venture}/${alert.source}`,
      venture: alert.venture,
      createdAt: 0,
      buttons: [],
    });
  }

  // ── Handelsconfiguratie die niet deugt ─────────────────────────────────
  for (const problem of input.tradingProblems) {
    actions.push({
      id: `trade-config-${problem.slice(0, 40)}`,
      kind: 'config',
      urgency: 'soon',
      title: 'Handelslimieten onbruikbaar',
      detail: `${problem}\n\nZolang dit zo staat komt er geen enkel voorstel doorheen — dat is met opzet.`,
      createdAt: 0,
      buttons: [],
    });
  }

  // Urgentie eerst, daarbinnen het oudste bovenaan: wat het langst wacht,
  // wacht meestal ergens op.
  return actions.sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.createdAt - b.createdAt,
  );
}
