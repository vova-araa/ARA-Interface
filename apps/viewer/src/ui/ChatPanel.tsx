import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VENTURES, ventureForProject, type StaffMember, type WorldSnapshot } from '@ara/shared';
import { loadTasks, withToken, type BoardTask } from '../api.ts';
import { useAra, type ChatMsg } from '../store.ts';

/**
 * Overleg-paneel: de leiding is overal aanspreekbaar, niet alleen wanneer je
 * toevallig in het juiste kantoor staat.
 *
 * Waarom een eigen paneel en niet "chat in elk kantoor": een manager hoort bij
 * een tak, niet bij één project, en de chief hoort nergens én overal. Wie alleen
 * via een kantoor te bereiken is, wordt in de praktijk niet bereikt.
 *
 * Waarom precies deze drie soorten gesprekspartners: org.json zegt dat de chief
 * het enige aanspreekpunt van de gebruiker is en dat werk via supervisor →
 * manager → worker loopt. Dit paneel is een venster op die keten, geen omweg
 * eromheen — daarom staat er geen enkele worker/scout in de kiezer. Een vraag
 * over een specialist gaat naar zijn manager, precies zoals in het kantoor.
 */

/** Board-assignee's die een mens rechtstreeks mag aanspreken. */
export type ChatTargetKind = 'chief' | 'supervisor' | 'manager';

export interface ChatTarget {
  /** Assignee op het takenbord — hier hangt de hele keten aan. */
  id: string;
  label: string;
  /** Eén regel: waarvoor je bij deze rol bent. */
  sub: string;
  /** Chatruimte; per gesprekspartner één, zodat geschiedenis gescheiden blijft. */
  room: string;
  kind: ChatTargetKind;
  venture?: string;
  color?: string;
}

/**
 * Roomnaam. `office:<project>` bestond al voor kantoren; `hq:<rol>` is dezelfde
 * gedachte voor het hoofdkantoor — een eigen naamruimte, zodat een tak die ooit
 * "chief" gaat heten nooit in het gesprek met de chief terechtkomt.
 */
export function hqRoom(targetId: string): string {
  return `hq:${targetId}`;
}

const FIXED_TARGETS: ChatTarget[] = [
  {
    id: 'chief',
    label: 'ARA Chief',
    sub: 'jouw vaste aanspreekpunt — intake, planning, org-wijzigingen',
    room: hqRoom('chief'),
    kind: 'chief',
    color: '#ff6b57',
  },
  {
    id: 'supervisor',
    label: 'Supervisor',
    sub: 'verdeelt het werk over de managers en bewaakt de keten',
    room: hqRoom('supervisor'),
    kind: 'supervisor',
    color: '#9b8cff',
  },
];

interface OrgVenture {
  id: string;
  label: string;
  color?: string;
  manager?: string;
  focus?: string;
  playbook?: { managerName?: string };
}

/** Managers uit /org; valt terug op VENTURES zodat de kiezer nooit leeg is. */
function targetsFromOrg(ventures: OrgVenture[]): ChatTarget[] {
  return [
    ...FIXED_TARGETS,
    ...ventures
      .filter((v) => v.id !== 'misc')
      .map((v) => {
        const id = v.manager ?? `manager:${v.id}`;
        return {
          id,
          label: v.playbook?.managerName ?? `Manager ${v.label}`,
          sub: v.focus?.split('.')[0] ?? v.label,
          room: hqRoom(id),
          kind: 'manager' as const,
          venture: v.id,
          color: v.color,
        };
      }),
  ];
}

const FALLBACK_TARGETS = targetsFromOrg(
  VENTURES.map((v) => ({ id: v.id, label: v.label, color: v.color })),
);

/**
 * Aanwezigheid. Een bericht in een leegte mag er niet uitzien als een bericht
 * dat aankomt, dus staat hier letterlijk wat we wél weten:
 *  live   — er draait nu een agent van deze rol (uit de sessie-stroom);
 *  waking — je vraag staat op het bord, de watchdog haalt hem op (tick = 5 min);
 *  away   — er draait niemand; het bericht wekt de rol, maar nu is er niemand.
 */
export type PresenceState = 'live' | 'waking' | 'away';

export interface Presence {
  state: PresenceState;
  note: string;
  /** Open vragen van jou die nog niet beantwoord zijn. */
  waiting: number;
}

/**
 * Welke leidinggevende rollen nú draaien, als één stabiele sleutel. Als string,
 * want dan hertekent dit paneel niet bij elk binnenkomend wereld-event — alleen
 * wanneer er echt iemand komt of gaat.
 */
export function liveRoleKey(snapshot: WorldSnapshot): string {
  const live = new Set<string>();
  for (const session of Object.values(snapshot.sessions)) {
    if (session.endedAt) continue;
    for (const agent of Object.values(session.agents)) {
      if (agent.stopped) continue;
      // Exact matchen: 'ara-ops-manager' is geen tak-manager, en een rol die
      // "ongeveer" lijkt te draaien is precies de leugen die dit moet voorkomen.
      if (agent.agentType === 'ara-chief') live.add('chief');
      else if (agent.agentType === 'ara-supervisor') live.add('supervisor');
      else if (agent.agentType === 'ara-manager')
        live.add(`manager:${ventureForProject(session.project).id}`);
    }
  }
  return [...live].sort().join('|');
}

export function presenceFor(target: ChatTarget, liveIds: Set<string>, tasks: BoardTask[]): Presence {
  const mine = tasks.filter(
    (t) => t.assignee === target.id && (t.status === 'open' || t.status === 'claimed'),
  );
  const waiting = mine.filter((t) => t.title.startsWith('CHAT:')).length;
  if (liveIds.has(target.id)) {
    return { state: 'live', note: 'draait nu — je bericht komt binnen bij een levende sessie.', waiting };
  }
  if (mine.some((t) => t.status === 'claimed')) {
    return { state: 'live', note: 'heeft werk van het bord opgepakt en is bezig.', waiting };
  }
  if (mine.length > 0) {
    return {
      state: 'waking',
      note: `staat ${mine.length}× op het bord; de watchdog start deze rol bij de volgende ronde (≤5 min).`,
      waiting,
    };
  }
  return {
    state: 'away',
    note: 'draait nu niet. Je bericht komt op het bord en wekt hem — reken op minuten, niet op seconden.',
    waiting,
  };
}

/**
 * Wie je in een kantoor mag aanspreken. Klikken op een specialist en dan
 * rechtstreeks een opdracht geven zou de manager overslaan; het bord zou die
 * taak wél aanmaken en de keten zou stilletjes stuk zijn. Dus: alles gaat naar
 * de manager van de tak (of de chief als je die expliciet kiest), met de naam
 * van de specialist erbij zodat de vraag niet vervlakt.
 */
export interface OfficeRecipient {
  id: string;
  name: string;
  /** Rol waar de vraag over gaat, als je iemand zonder eigen lijn aanklikte. */
  about?: string;
}

export function recipientForOffice(
  staff: StaffMember[] | undefined,
  selectedId: string | null,
): OfficeRecipient {
  const manager = staff?.find((s) => s.role === 'manager');
  const fallback: OfficeRecipient = manager
    ? { id: manager.id, name: manager.name }
    : { id: 'supervisor', name: 'Supervisor' };
  const person = staff?.find((s) => s.id === selectedId);
  if (!person) return fallback;
  // De chief staat in de bezetting met rol 'supervisor' (id 'chief') — dat is
  // de enige andere directe lijn die de gebruiker heeft.
  if (person.role === 'supervisor' || person.role === 'manager') {
    return { id: person.id, name: person.name };
  }
  return { ...fallback, about: person.name };
}

// ── Netwerk (dezelfde endpoints als de kantoorchat) ──────────────────────

async function fetchRoom(room: string): Promise<ChatMsg[]> {
  try {
    const res = await fetch(withToken(`/chat?room=${encodeURIComponent(room)}`));
    if (!res.ok) return [];
    return ((await res.json()) as { messages: ChatMsg[] }).messages;
  } catch {
    return [];
  }
}

async function fetchOrgTargets(): Promise<ChatTarget[] | null> {
  try {
    const res = await fetch(withToken('/org'));
    if (!res.ok) return null;
    const org = (await res.json()) as { ventures?: OrgVenture[] };
    if (!org.ventures?.length) return null;
    return targetsFromOrg(org.ventures);
  } catch {
    return null;
  }
}

/**
 * De collector zet een bericht van de gebruiker óók als taak op het bord bij
 * `to`. Dat taak-id is het enige harde bewijs dat er iemand gewekt wordt — dus
 * geven we het door aan de UI in plaats van het weg te gooien.
 */
async function postMessage(input: {
  room: string;
  text: string;
  to: string;
}): Promise<{ message: ChatMsg; taskId?: string } | null> {
  try {
    const res = await fetch(withToken('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, role: 'user', sender: 'jij', project: '' }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { message?: ChatMsg; taskId?: string };
    return body.message ? { message: body.message, taskId: body.taskId } : null;
  } catch {
    return null;
  }
}

export interface ChatPanelProps {
  /** Laat weg voor een paneel dat zijn eigen knop meebrengt. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Voorselectie, bv. 'chief' of 'manager:blex'. */
  target?: string;
}

export function ChatPanel({ open: openProp, onOpenChange, target: targetProp }: ChatPanelProps = {}): JSX.Element | null {
  const [selfOpen, setSelfOpen] = useState(false);
  const open = openProp ?? selfOpen;

  const officeProject = useAra((s) => s.officeProject);
  const panelOpen = useAra((s) => s.panelOpen);
  const boardOpen = useAra((s) => s.boardOpen);
  const actionsOpen = useAra((s) => s.actionsOpen);
  const overviewOpen = useAra((s) => s.overviewOpen);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const liveKey = useAra((s) => liveRoleKey(s.snapshot));

  const [targets, setTargets] = useState<ChatTarget[]>(FALLBACK_TARGETS);
  const [targetId, setTargetId] = useState(targetProp ?? 'chief');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [acks, setAcks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** De SSE-listener leeft langer dan één gesprek; hij leest de ruimte hieruit. */
  const roomRef = useRef('');

  const setOpen = useCallback(
    (value: boolean): void => {
      // Eén paneel tegelijk. De store doet dat al voor de andere vier; dit
      // paneel hoort bij dezelfde familie, dus ruimt het de rechterkolom op in
      // plaats van er bovenop te gaan staan.
      if (value) {
        const s = useAra.getState();
        s.setPanelOpen(false);
        s.setBoardOpen(false);
        s.setActionsOpen(false);
        s.setOverviewOpen(false);
      }
      if (openProp === undefined) setSelfOpen(value);
      onOpenChange?.(value);
    },
    [openProp, onOpenChange],
  );

  const target = useMemo(
    () => targets.find((t) => t.id === targetId) ?? targets[0]!,
    [targets, targetId],
  );
  const room = target.room;
  roomRef.current = room;

  const liveIds = useMemo(() => new Set(liveKey ? liveKey.split('|') : []), [liveKey]);
  const presence = useMemo(() => presenceFor(target, liveIds, tasks), [target, liveIds, tasks]);
  /** Badge op de knop: vragen van jou waar nog niemand op heeft geantwoord. */
  const waitingTotal = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.title.startsWith('CHAT:') &&
          t.createdBy === 'user' &&
          (t.status === 'open' || t.status === 'claimed'),
      ).length,
    [tasks],
  );

  useEffect(() => {
    if (targetProp) setTargetId(targetProp);
  }, [targetProp]);

  // En andersom: opent er via de balk een ander paneel, dan wijkt het gesprek.
  useEffect(() => {
    if (open && (panelOpen || boardOpen || actionsOpen || overviewOpen)) setOpen(false);
  }, [open, panelOpen, boardOpen, actionsOpen, overviewOpen, setOpen]);

  // Sneltoets 'c' (dezelfde familie als b/a/o in App.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c') setOpen(!open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // De echte organisatie ophalen (namen + takken), niet de VENTURES-lijst raden.
  useEffect(() => {
    if (!open) return;
    void fetchOrgTargets().then((list) => {
      if (list) setTargets(list);
    });
  }, [open]);

  // Bord: de bron voor "wacht er iets op deze rol". tasksVersion komt van SSE,
  // dus dit ververst zichzelf zodra er iets op het bord gebeurt.
  useEffect(() => {
    void loadTasks().then(setTasks);
  }, [tasksVersion]);

  // Geschiedenis van de gekozen ruimte.
  useEffect(() => {
    if (!open) return;
    let stop = false;
    void fetchRoom(room).then((list) => {
      if (!stop) setMessages(list);
    });
    return () => {
      stop = true;
    };
  }, [open, room]);

  /**
   * Antwoorden komen binnen zonder verversen. De store-kant van de SSE luistert
   * alleen naar de ruimte van een geopend kantoor (zie api.ts), en dat bestand
   * is van iemand anders — dus houdt dit paneel zijn eigen oor open, alleen
   * zolang het open staat. Een tweede /events-verbinding kost niets zolang hij
   * niet permanent openstaat.
   */
  useEffect(() => {
    if (!open) return;
    const source = new EventSource(withToken('/events'));
    const onChat = (msg: Event): void => {
      try {
        const message = JSON.parse((msg as MessageEvent).data) as ChatMsg;
        if (message.room !== roomRef.current) return;
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      } catch {
        /* kapot frame overslaan */
      }
    };
    source.addEventListener('chat', onChat);
    return () => {
      source.removeEventListener('chat', onChat);
      source.close();
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, open]);

  useEffect(() => {
    // Op de telefoon niet automatisch focussen: dan klapt het toetsenbord over
    // het gesprek heen voordat je het gelezen hebt.
    if (open && window.innerWidth > 800) inputRef.current?.focus();
  }, [open]);

  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError('');
    const sent = await postMessage({ room, text: value, to: target.id });
    if (!sent) {
      setError('Niet verstuurd — de collector antwoordde niet. Je tekst staat er nog.');
      setSending(false);
      return;
    }
    setText('');
    setMessages((prev) => (prev.some((m) => m.id === sent.message.id) ? prev : [...prev, sent.message]));
    setAcks((prev) => ({
      ...prev,
      [sent.message.id]: sent.taskId
        ? `op het bord bij ${target.label}`
        : 'verstuurd, maar niet op het bord — niemand wordt hiervoor gewekt',
    }));
    // Het bord is net veranderd: aanwezigheid meteen opnieuw bepalen, anders
    // blijft er "niemand aanwezig" staan terwijl je vraag al klaarligt.
    void loadTasks().then(setTasks);
    setSending(false);
  };

  // Het kantoor heeft zijn eigen chat en dekt het scherm (z-index 60); een
  // tweede gesprek eronder is alleen maar verwarrend.
  if (officeProject) return null;

  if (!open) {
    return (
      <>
        <PanelStyle />
        <button
          type="button"
          className="hq-fab"
          title="Overleg met de leiding (c)"
          aria-label="Overleg met de leiding"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">💬</span>
          {waitingTotal > 0 && <em className="hq-fab-badge">{waitingTotal}</em>}
        </button>
      </>
    );
  }

  return (
    <>
      <PanelStyle />
      <section className="hq-chat" aria-label="Overleg met de leiding">
        <header className="hq-chat-head">
          <div className="hq-chat-title">
            <strong>Overleg</strong>
            <span>je praat met de leiding; workers werken via hun manager</span>
          </div>
          <button type="button" className="hq-x" onClick={() => setOpen(false)} aria-label="Sluiten">
            ✕
          </button>
        </header>

        <div className="hq-targets" role="tablist" aria-label="Gesprekspartner">
          {targets.map((t) => {
            const p = presenceFor(t, liveIds, tasks);
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === target.id}
                className={`hq-target ${t.id === target.id ? 'hq-target-on' : ''}`}
                style={t.id === target.id && t.color ? { borderColor: t.color } : undefined}
                onClick={() => setTargetId(t.id)}
              >
                <span className={`hq-dot hq-dot-${p.state}`} />
                {t.label}
                {p.waiting > 0 && <em className="hq-target-wait">{p.waiting}</em>}
              </button>
            );
          })}
        </div>

        <p className={`hq-presence hq-presence-${presence.state}`}>
          <span className={`hq-dot hq-dot-${presence.state}`} />
          <span>
            <strong>{target.label}</strong> {presence.note}
          </span>
        </p>

        <div className="hq-list" ref={listRef}>
          {messages.length === 0 && (
            <p className="hq-empty">
              Nog geen gesprek met {target.label}. {target.sub}.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`hq-msg hq-msg-${m.role === 'user' ? 'me' : 'them'}`}>
              <span className="hq-msg-from">{m.sender}</span>
              <span className="hq-msg-text">{m.text}</span>
              {acks[m.id] && <span className="hq-msg-ack">{acks[m.id]}</span>}
            </div>
          ))}
        </div>

        {error && <p className="hq-error">{error}</p>}

        <div className="hq-input">
          <input
            ref={inputRef}
            value={text}
            placeholder={`Bericht aan ${target.label}…`}
            aria-label={`Bericht aan ${target.label}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <button type="button" onClick={() => void submit()} disabled={sending || !text.trim()}>
            Stuur
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * TIJDELIJK IN DE COMPONENT — dit blok hoort in theme.css.
 * Het staat hier omdat er nu iemand anders in theme.css werkt; verhuizen is
 * knippen-plakken, want alle klassen zijn genaamruimd (hq-*) en gebruiken
 * dezelfde variabelen als de rest van de interface.
 */
function PanelStyle(): JSX.Element {
  return (
    <style>{`
.hq-fab {
  position: fixed;
  right: calc(12px + var(--safe-r, 0px));
  bottom: calc(14px + var(--safe-b, 0px));
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; line-height: 1;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(22, 25, 31, 0.94);
  color: var(--text);
  backdrop-filter: blur(12px);
  cursor: pointer;
  z-index: 19;
}
.hq-fab:hover { border-color: var(--accent); }
.hq-fab-badge {
  position: absolute; top: -3px; right: -3px;
  background: var(--amber); color: #1a1a1a;
  border-radius: 999px; padding: 0 6px;
  font-size: 11px; font-style: normal; font-weight: 600;
}
.hq-chat {
  position: fixed;
  right: calc(12px + var(--safe-r, 0px));
  bottom: calc(12px + var(--safe-b, 0px));
  width: min(380px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  display: flex; flex-direction: column;
  background: rgba(22, 25, 31, 0.96);
  border: 1px solid var(--border);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  overflow: hidden;
  z-index: 19;
}
.hq-chat-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.hq-chat-title { display: flex; flex-direction: column; min-width: 0; }
.hq-chat-title span { color: var(--text-dim); font-size: 11px; }
.hq-x {
  flex: 0 0 auto; min-width: 34px; min-height: 34px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
}
.hq-x:hover { color: var(--text); border-color: var(--accent); }
/* Eén rij die je opzij veegt: tien gesprekspartners wrappen kost de halve
   hoogte van het paneel, en wrappen op een telefoon geeft horizontale drift. */
.hq-targets {
  display: flex; gap: 6px; padding: 8px 10px;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  border-bottom: 1px solid var(--border);
}
.hq-targets::-webkit-scrollbar { display: none; }
.hq-target {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 4px 10px;
  background: var(--surface-2); color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 999px;
  font-size: 12px; white-space: nowrap; cursor: pointer;
}
.hq-target-on { color: var(--text); background: var(--surface); }
.hq-target-wait {
  font-style: normal; background: var(--amber); color: #1a1a1a;
  border-radius: 999px; padding: 0 5px; font-size: 10px;
}
.hq-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
.hq-dot-live { background: #3ddc97; }
.hq-dot-waking { background: var(--amber); }
.hq-dot-away { background: #5d6675; }
.hq-presence {
  display: flex; align-items: flex-start; gap: 7px;
  margin: 0; padding: 8px 12px;
  font-size: 11.5px; line-height: 1.35; color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.hq-presence .hq-dot { margin-top: 4px; }
.hq-presence strong { color: var(--text); font-weight: 600; }
.hq-presence-away { color: #a9a08f; }
.hq-list { flex: 1; min-height: 90px; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.hq-empty { color: var(--text-dim); font-size: 12px; margin: 6px 0; }
.hq-msg {
  display: flex; flex-direction: column; gap: 2px;
  max-width: 88%; padding: 7px 10px; border-radius: 12px;
  font-size: 13px; overflow-wrap: anywhere;
}
.hq-msg-me { align-self: flex-end; background: rgba(255, 107, 87, 0.16); border: 1px solid rgba(255, 107, 87, 0.35); }
.hq-msg-them { align-self: flex-start; background: var(--surface-2); border: 1px solid var(--border); }
.hq-msg-from { color: var(--text-dim); font-size: 10.5px; text-transform: lowercase; }
.hq-msg-ack { color: var(--text-dim); font-size: 10.5px; font-style: italic; }
.hq-error { margin: 0; padding: 6px 12px; font-size: 12px; color: var(--amber); }
.hq-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); }
.hq-input input {
  flex: 1; min-width: 0; min-height: 36px; padding: 6px 10px;
  background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; font-size: 14px;
}
.hq-input input:focus { border-color: var(--accent); outline: none; }
.hq-input button {
  flex: 0 0 auto; min-height: 36px; padding: 6px 14px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; cursor: pointer;
}
.hq-input button:hover:not(:disabled) { border-color: var(--accent); }
.hq-input button:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 800px) {
  /* Duimmaat (--tap) voor alles wat je indrukt, en het paneel als bottom sheet
     over de volle breedte: rechts uitlijnen op 390px laat een strook wereld
     over waar je per ongeluk de camera mee versleept. */
  .hq-fab { width: var(--tap, 44px); height: var(--tap, 44px); right: calc(10px + var(--safe-r, 0px)); }
  .hq-chat {
    left: 0; right: 0; bottom: 0;
    width: auto; max-height: none;
    height: calc(72dvh + var(--safe-b, 0px));
    border-radius: 16px 16px 0 0;
    border-left: none; border-right: none; border-bottom: none;
    padding-bottom: var(--safe-b, 0px);
  }
  .hq-target { min-height: var(--tap, 44px); font-size: 13px; padding: 4px 12px; }
  .hq-x { min-width: var(--tap, 44px); min-height: var(--tap, 44px); }
  /* Onder 16px zoomt iOS het hele scherm in zodra je het veld aantikt. */
  .hq-input input { font-size: 16px; min-height: var(--tap, 44px); }
  .hq-input button { min-height: var(--tap, 44px); min-width: 72px; }
}

/* Telefoon liggend: breed genoeg voor de desktop-indeling, maar 390px hoog.
   Een sheet van 72dvh laat daar niets over, dus blijft het een kolom rechts —
   met de 40px die de rest van de interface in deze stand ook aanhoudt. */
@media (orientation: landscape) and (max-height: 520px) and (max-width: 1100px) {
  .hq-chat { width: min(340px, 44vw); max-height: calc(100dvh - 24px); }
  .hq-target, .hq-x, .hq-input input, .hq-input button { min-height: 40px; }
}
`}</style>
  );
}
