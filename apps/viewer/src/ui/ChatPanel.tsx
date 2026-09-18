import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
 * Een bord-assignee in mensentaal.
 *
 * Op het bord staat een agent-id: `ara-fleet-cost`, `manager:blex`, `worker-7`.
 * Dat is precies genoeg om een agent te wekken en precies te weinig om te weten
 * wie dat is. Hier wordt het een naam met een functie erin — en waar het id een
 * tak noemt, de naam van die tak, want "blex" staat nergens op de kaart.
 */
export function roleLabel(assignee: string | undefined): string {
  const id = (assignee ?? '').trim();
  if (!id) return 'nog niemand';
  if (id === 'chief') return 'ARA Chief';
  if (id === 'supervisor') return 'Supervisor';
  if (id === 'user' || id === 'jij') return 'jij';
  if (id === 'manager:ops') return 'Ops-manager';
  if (id.startsWith('manager:')) {
    const venture = id.slice('manager:'.length);
    const match = VENTURES.find((v) => v.id === venture);
    return match ? `Manager ${match.label}` : `Manager ${venture}`;
  }
  // `ara-fleet-cost` → "Fleet cost". Het voorvoegsel zegt alleen dat het een
  // ARA-rol is, en dat weet je al omdat je naar ARA kijkt.
  const bare = id.replace(/^ara-/, '').replace(/[-_]/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
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

/**
 * Het overleg openen van buiten dit bestand.
 *
 * Het paneel houdt zijn eigen open-stand bij (App.tsx geeft hem niets mee), en
 * dat was prima toen de enige ingang de knop rechtsonder was. Maar die knop is
 * één klein rondje op een wereldkaart: wie de leiding zoekt, zoekt hem in de
 * strook waar de andere panelen ook staan. Een gebeurtenis op window is genoeg
 * om die twee te verbinden zonder de gedeelde store te hoeven aanpassen.
 */
const CHAT_OPEN_EVENT = 'ara:chat-open';
const CHAT_STATE_EVENT = 'ara:chat-state';
let chatIsOpen = false;

export function openLeadershipChat(target?: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { target, open: true } }));
}

export function closeLeadershipChat(): void {
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { open: false } }));
}

export function isLeadershipChatOpen(): boolean {
  return chatIsOpen;
}

/** Abonneer op open/dicht; geeft de opzegger terug. */
export function onLeadershipChatState(fn: (open: boolean) => void): () => void {
  const handler = (e: Event): void => fn((e as CustomEvent<{ open: boolean }>).detail.open);
  window.addEventListener(CHAT_STATE_EVENT, handler);
  return () => window.removeEventListener(CHAT_STATE_EVENT, handler);
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

  // Van buiten geopend (de tabstrook, of een knop die een rol meegeeft).
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ target?: string; open?: boolean }>).detail ?? {};
      if (detail.open === false) {
        setOpen(false);
        return;
      }
      if (detail.target) setTargetId(detail.target);
      setOpen(true);
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
  }, [setOpen]);

  // En terug: de strook tekent zijn tab actief zolang dit paneel open staat.
  // Boven een kantoor telt het als dicht — daar rendert dit paneel niets.
  const visible = open && !officeProject;
  useEffect(() => {
    chatIsOpen = visible;
    window.dispatchEvent(new CustomEvent(CHAT_STATE_EVENT, { detail: { open: visible } }));
    return () => {
      if (visible) {
        chatIsOpen = false;
        window.dispatchEvent(new CustomEvent(CHAT_STATE_EVENT, { detail: { open: false } }));
      }
    };
  }, [visible]);

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
      <button
        type="button"
        className="hq-fab"
        title="Overleg met de leiding — chief, supervisor en de acht managers (toets c)"
        aria-label="Overleg met de leiding"
        onClick={() => setOpen(true)}
      >
        <span className="hq-fab-icon" aria-hidden="true">
          💬
        </span>
        {/* Een rondje met een emoji vertelt niet wie eronder zit. Op een scherm
            dat breed genoeg is staat er gewoon wat het is; op een telefoon
            blijft het het rondje, want daar telt elke duimbreedte. */}
        <span className="hq-fab-label">Overleg met de leiding</span>
        {waitingTotal > 0 && (
          <em className="hq-fab-badge" title={`${waitingTotal} vraag/vragen van jou nog onbeantwoord`}>
            {waitingTotal}
          </em>
        )}
      </button>
    );
  }

  const leaders = targets.filter((t) => t.kind !== 'manager');
  const managers = targets.filter((t) => t.kind === 'manager');

  const targetButton = (t: ChatTarget): JSX.Element => {
    const p = presenceFor(t, liveIds, tasks);
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={t.id === target.id}
        className={`hq-target ${t.id === target.id ? 'hq-target-on' : ''}`}
        style={{ '--venture': t.color ?? 'var(--accent)' } as CSSProperties}
        title={`${t.label} — ${t.sub}. ${p.note}`}
        onClick={() => setTargetId(t.id)}
      >
        <span className={`hq-dot hq-dot-${p.state}`} />
        {t.label}
        {p.waiting > 0 && <em className="hq-target-wait">{p.waiting}</em>}
      </button>
    );
  };

  return (
    <>
      <section className="hq-chat" aria-label="Overleg met de leiding">
        <header className="hq-chat-head">
          <div className="hq-chat-title">
            <strong>Overleg met de leiding</strong>
            <span>chief, supervisor en de manager van elke tak — workers werken via hun manager</span>
          </div>
          <button type="button" className="hq-x" onClick={() => setOpen(false)} aria-label="Sluiten">
            ✕
          </button>
        </header>

        {/* Eén veegstrook met tien namen betekende dat zeven managers buiten
            beeld stonden zonder dat iets dat verklapte. Ze passen gewoon, in
            twee groepen: wie overal over gaat, en wie over één tak gaat. */}
        <div className="hq-targets" role="tablist" aria-label="Gesprekspartner">
          <span className="hq-targets-head">altijd bereikbaar</span>
          <div className="hq-targets-row">{leaders.map(targetButton)}</div>
          {managers.length > 0 && (
            <>
              <span className="hq-targets-head">per tak</span>
              <div className="hq-targets-row">{managers.map(targetButton)}</div>
            </>
          )}
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
              Nog geen gesprek met {target.label} — {target.sub}. Wat je stuurt komt als taak op zijn
              bord, dus het blijft staan tot hij het oppakt.
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
