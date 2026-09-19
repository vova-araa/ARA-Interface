import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import {
  VENTURES,
  type Metric,
  type OfficeTask,
  type OfficeWork,
  type Station,
  type StaffMember,
} from '@ara/shared';
import { useAra } from '../store.ts';
import { ageString } from '../util.ts';
import { OfficeScene } from './OfficeScene.tsx';
import { recipientForOffice, roleLabel } from '../ui/ChatPanel.tsx';
import { loadChat, loadOffice, sendChat } from './api.ts';
import { TONE_COLORS } from './textures.ts';

/**
 * Waar iemand in de keten staat, in woorden.
 *
 * `role` zei dit niet: de chief én de supervisor hebben allebei rol
 * 'supervisor', dus stond er bij de supervisor letterlijk "chief". `tier` zegt
 * wél waar iemand hangt, dus die gaat voor; `role` is het vangnet.
 */
const TIER_LABEL: Record<string, string> = {
  chief: 'hoofd',
  supervisor: 'supervisor',
  manager: 'manager',
  ops: 'ops-manager',
  specialist: 'vaste rol',
  floor: 'draait nu hier',
};

const ROLE_LABEL: Record<StaffMember['role'], string> = {
  supervisor: 'leiding',
  manager: 'manager',
  agent: 'vaste rol',
  scout: 'scout',
  ops: 'ops-manager',
};

/** Eén woord voor wat iemand is — nooit het agent-id, dat leest niemand. */
function tierLabel(person: StaffMember): string {
  return (person.tier && TIER_LABEL[person.tier]) ?? ROLE_LABEL[person.role];
}

/** Iemand met een eigen lijn: de gebruiker mag hier rechtstreeks heen. */
function isLeadership(person: StaffMember): boolean {
  return person.role === 'supervisor' || person.role === 'manager' || person.tier === 'ops';
}

/**
 * De drie groepen waarin een kantoor zijn mensen kent.
 *
 * Een platte lijst zette de chief, een vaste rol die niet draait en een agent
 * die toevallig nu werkt onder elkaar zonder verschil. Dat zijn drie soorten
 * aanwezigheid met drie verschillende verwachtingen, dus staan ze apart.
 */
const STAFF_GROUPS: { key: string; title: string; hint: string }[] = [
  { key: 'leiding', title: 'Leiding', hint: 'hier schrijf je rechtstreeks heen' },
  { key: 'vast', title: 'Vaste rollen in deze tak', hint: 'uit het playbook — ook zonder sessie' },
  { key: 'nu', title: 'Draait nu in dit project', hint: 'sessies van dit moment' },
];

function staffGroup(person: StaffMember): string {
  if (person.tier === 'specialist') return 'vast';
  if (person.tier === 'floor') return 'nu';
  if (isLeadership(person)) return 'leiding';
  return person.tier ? 'vast' : 'nu';
}

/** Hoe het bord zijn statussen noemt — zelfde woorden als het takenbord. */
const TASK_STATUS_LABEL: Record<string, string> = {
  open: 'open',
  claimed: 'wordt aan gewerkt',
  done: 'af',
  failed: 'mislukt',
};

/**
 * Herkomst van een cijfer, in een woord in plaats van een teken.
 *
 * Er stond "≈" voor een ingevuld cijfer. Dat is geen taal: wie het niet weet
 * leest een wiskundeteken, en wie het wél weet moet het zich elke keer weer
 * herinneren. Drie woorden, overal dezelfde, met de uitleg in de tooltip —
 * `voorbeeld` (niemand levert dit aan), `verouderd` (wel echt, maar oud) en
 * `gemeten` (geteld, geen invulling).
 */
function Tag({
  kind,
  children,
  title,
}: {
  kind: 'est' | 'stale' | 'real';
  children: ReactNode;
  title?: string;
}): JSX.Element {
  const fallback =
    kind === 'est'
      ? 'Voorbeeldcijfer: er is geen bron aan gekoppeld, ARA heeft dit zelf ingevuld.'
      : kind === 'stale'
        ? 'De koppeling stuurde al een tijd niets meer — dit cijfer kan achterlopen.'
        : 'Geteld, geen invulling.';
  return (
    <span className={`office-tag office-tag-${kind}`} title={title ?? fallback}>
      {children}
    </span>
  );
}

/** Tijdstip van een meting/levering, in de taal van de rest van de interface. */
function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function Sparkline({ values, color }: { values: number[]; color: string }): JSX.Element | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`)
    .join(' ');
  return (
    <svg className="office-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function MetricRow({ metric }: { metric: Metric }): JSX.Element {
  return (
    <div className="office-metric">
      <span>{metric.label}</span>
      <strong
        className={metric.estimated ? 'office-est' : undefined}
        style={metric.tone && !metric.estimated ? { color: TONE_COLORS[metric.tone] } : undefined}
      >
        {metric.value}
        {metric.estimated && <Tag kind="est">voorbeeld</Tag>}
      </strong>
    </div>
  );
}

/**
 * Eén bordtaak.
 *
 * Draagt de taak een rol die in dit kantoor zit, dan is de hele regel een
 * knop naar die rol: één tik brengt je bij de bezetting én zet het gesprek
 * onderin op diezelfde rol. Kent het kantoor de rol niet, dan blijft het een
 * regel — een knop die nergens heen gaat is erger dan geen knop.
 */
function TaskRow({
  task,
  now,
  ownerName,
  onOwner,
  flag,
}: {
  task: OfficeTask;
  now: number;
  ownerName?: string;
  onOwner?: () => void;
  /** Buiten de escalatiesectie draagt de regel zelf dat hij op een mens wacht. */
  flag?: boolean;
}): JSX.Element {
  const className = `office-task ${task.escalated ? 'office-task-esc' : ''}`;
  // Het markeerwoord waarmee de keten een weigering herkent hoeft niet ook nog
  // de halve regel te vullen: de sectie of de vlag zegt al dat dit op jou
  // wacht. Alleen het voorvoegsel gaat eraf — de reden blijft woordelijk staan.
  const note = task.escalated ? task.note?.replace(/^ESCALATE[:\s—-]*/i, '') : task.note;
  const body = (
    <>
      <span className="office-task-main">
        <span className="office-task-title">{task.title}</span>
        <span className="office-task-meta">
          {task.escalated && flag && <b className="office-task-flag">⚠ wacht op jou · </b>}
          {TASK_STATUS_LABEL[task.status] ?? task.status} · {roleLabel(task.assignee)} ·{' '}
          {ageString(task.updatedAt, now)} geleden
        </span>
        {note && <em className="office-task-note">{note}</em>}
      </span>
      {ownerName && <span className="office-task-owner">→ {ownerName}</span>}
    </>
  );
  if (!onOwner) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={className} onClick={onOwner} title={`Naar ${ownerName ?? 'de rol'}`}>
      {body}
    </button>
  );
}

/**
 * Het bord van dit ene project.
 *
 * Alles hier is geteld, niets ingevuld: een leeg bord blijft leeg. Werd de
 * uitvraag afgekapt, dan staat er "≥" — precies zoals de districtborden op de
 * kaart, want een ondergrens die zich voordoet als een getal is een leugen met
 * een cijfer erbij.
 */
function BoardTab({
  work,
  staff,
  now,
  onOwner,
}: {
  work: OfficeWork | undefined;
  staff: StaffMember[];
  now: number;
  onOwner: (staffId: string) => void;
}): JSX.Element {
  const escalations = work?.escalations ?? [];
  const open = work?.open ?? [];
  const truncated = work?.truncated === true;
  const doneToday = typeof work?.doneToday === 'number' ? work.doneToday : null;
  const nameFor = (id: string | undefined): string | undefined =>
    id ? staff.find((s) => s.id === id)?.name : undefined;

  const row = (task: OfficeTask): JSX.Element => {
    const owner = nameFor(task.staffId);
    return (
      <TaskRow
        key={task.id}
        task={task}
        now={now}
        ownerName={owner}
        onOwner={task.staffId && owner ? () => onOwner(task.staffId!) : undefined}
      />
    );
  };

  return (
    <div className="office-list">
      <div className="office-board-sum">
        <div className="office-board-stat" title="Taken die op een mens wachten (een agent weigerde met ESCALATE).">
          <span>wacht op jou</span>
          <strong className={escalations.length > 0 ? 'office-board-hot' : undefined}>
            {escalations.length}
          </strong>
        </div>
        <div className="office-board-stat" title="Taken die openstaan of waaraan gewerkt wordt.">
          <span>open taken</span>
          <strong>
            {truncated ? 'minstens ' : ''}
            {open.length}
          </strong>
        </div>
        {doneToday !== null && (
          <div className="office-board-stat" title="Vandaag afgerond, geteld op het moment van afronden.">
            <span>vandaag af</span>
            <strong>{doneToday}</strong>
          </div>
        )}
      </div>
      <p className="office-note office-note-lead">
        Alle drie geteld van het bord van dit project — geen voorbeeldcijfers.
      </p>

      {truncated && (
        <p className="office-note">
          De uitvraag zat aan zijn plafond — dit is een ondergrens, er kan meer openstaan.
        </p>
      )}

      {escalations.length > 0 && (
        <>
          <h4 className="office-sub-head office-sub-head-warn">⚠ Wacht op jou</h4>
          <div className="office-tasks">{escalations.map(row)}</div>
        </>
      )}

      {open.length > 0 && (
        <>
          <h4 className="office-sub-head">Open werk</h4>
          <div className="office-tasks">{open.map(row)}</div>
        </>
      )}

      {escalations.length === 0 && open.length === 0 && (
        <p className="office-empty-note">
          <b>Niets open op het bord van dit project.</b>
          {doneToday !== null && doneToday > 0
            ? ' Wat vandaag binnenkwam is af.'
            : ' Er staat ook niets in de wacht — dit kantoor heeft nu geen werk liggen.'}
          <br />
          Werk erbij? Vraag het de manager in het gesprek hieronder; zijn antwoord komt hier als taak
          op het bord.
        </p>
      )}
    </div>
  );
}

/**
 * Van kantoor naar kantoor zonder eerst de wereld te moeten terugvinden.
 *
 * De lijst is die van de kaart zelf (`world.districts`), per tak gegroepeerd en
 * in de kleur van die tak — hetzelfde ordeningsprincipe als buiten, zodat je
 * niet twee verschillende indelingen uit je hoofd hoeft te kennen.
 */
function OfficePicker({
  current,
  onPick,
}: {
  current: string;
  onPick: (project: string) => void;
}): JSX.Element {
  const world = useAra((s) => s.world);
  const districts = world?.districts ?? [];
  const total = districts.reduce((n, d) => n + d.projects.length, 0);

  return (
    <div className="office-pick" role="menu">
      {total === 0 && (
        <p className="office-note">Geen kantoren bekend — de wereldkaart is nog niet geladen.</p>
      )}
      {districts.map((d) => (
        <div key={d.venture.id} className="office-pick-group">
          <h5 style={{ color: d.venture.color }}>{d.venture.label}</h5>
          {d.projects.map((p) => (
            <button
              key={p.name}
              type="button"
              className={`office-pick-row ${p.name === current ? 'active' : ''}`}
              onClick={() => onPick(p.name)}
            >
              <span className="office-pick-dot" style={{ background: d.venture.color }} />
              {p.name}
              {p.name === current && <em>hier</em>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Werkplekstatus in woorden; het Engelse sleutelwoord blijft in de code. */
const STATION_STATUS_LABEL: Record<string, string> = {
  working: 'bezig',
  idle: 'stil',
  alert: 'storing',
  done: 'klaar',
};

/**
 * Waar een echt cijfer vandaan komt, in één regel: `uit vehicles.csv · 3d oud`
 * voor een bureau uit een bronbestand, `door agent · 12m geleden` voor een
 * push. Een bestand veroudert in dagen, een push in minuten — vandaar "oud"
 * tegenover "geleden". Zonder `updatedAt` staat er geen leeftijd: een
 * leeftijd die niet gemeten is wordt weggelaten, niet ingevuld.
 */
function provenance(station: Station, now: number): string {
  const origin = station.source ? `uit ${station.source}` : 'door agent';
  if (station.updatedAt === undefined) return origin;
  return `${origin} · ${ageString(station.updatedAt, now)} ${station.source ? 'oud' : 'geleden'}`;
}

/** Detailpaneel van een werkplek: cijfers, belofte × geleverd en de curve. */
function StationDetail({ station, valueKind, now }: { station: Station; valueKind: string; now: number }): JSX.Element {
  const d = station.detail;
  return (
    <div className="office-detail">
      <div className="office-detail-head">
        <div>
          <h3>{d.title}</h3>
          <p>{d.subtitle}</p>
        </div>
        <span className={`office-status office-status-${station.status}`}>
          {STATION_STATUS_LABEL[station.status] ?? station.status}
        </span>
      </div>

      {/* Eén keer bovenaan: waar de cijfers hieronder vandaan komen en hoe
          oud ze zijn. Er stond "aangeleverd door de agent" — ook boven een
          bureau dat uit vehicles.csv kwam zonder dat er ooit een agent aan te
          pas was. Nu noemt de regel het bestand, of anders de agent. */}
      {station.simulated ? (
        <p className="office-warn office-provenance">
          <Tag kind="est">voorbeeld</Tag>
          <span>
            voorbeeldcijfers — geen bron gekoppeld, ARA vulde dit zelf in; om te zien hóe het eruitziet,
            niet om op te sturen.
          </span>
        </p>
      ) : station.stale ? (
        <p className="office-warn office-provenance">
          <Tag kind="stale">verouderd</Tag>
          <span>
            {provenance(station, now)}
            {station.source ? ' — sindsdien niet ververst.' : ' — sindsdien kwam er niets meer binnen.'}
          </span>
        </p>
      ) : (
        <p className="office-note office-note-real office-provenance">
          <Tag kind="real">gemeten</Tag>
          <span>{provenance(station, now)}</span>
        </p>
      )}

      <div className="office-kpis">
        {d.kpis.map((k) => (
          <div key={k.label} className="office-kpi">
            <span>{k.label}</span>
            <strong
              className={k.estimated ? 'office-est' : undefined}
              style={k.tone && !k.estimated ? { color: TONE_COLORS[k.tone] } : undefined}
            >
              {k.value}
            </strong>
          </div>
        ))}
      </div>

      <h4>Gegevens van deze werkplek</h4>
      <div className="office-metrics">
        {station.metrics.map((m) => (
          <MetricRow key={m.label} metric={m} />
        ))}
      </div>

      {/* "plan" en "echt" waren twee kolomkopjes van vier letters boven
          getallen die over geld en tijd kunnen gaan. De hele woorden passen. */}
      <h4>
        Belofte tegenover geleverd {d.estimated && <Tag kind="est">voorbeeld</Tag>}
      </h4>
      <table className="office-table">
        <thead>
          <tr>
            <th />
            <th>belofte</th>
            <th>geleverd</th>
          </tr>
        </thead>
        <tbody>
          {d.plannedVsActual.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.planned}</td>
              <td>{row.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>
        Verloop van deze werkplek {d.estimated && <Tag kind="est">voorbeeld</Tag>}
      </h4>
      <Sparkline values={d.curve} color={valueKind === 'money' ? '#6ee7ff' : '#c07cff'} />
      <p className="office-note office-spark-legend">
        Oudste links, meest recente rechts — een vorm, geen schaal.
      </p>
      {station.agentName && (
        <p className="office-note">
          Aan het werk op deze plek: <strong>{station.agentName}</strong>
        </p>
      )}
    </div>
  );
}

/** Kantoorchat: praat met de manager van deze tak (of de chief). */
function OfficeChat({ project, room }: { project: string; room: string }): JSX.Element {
  const messages = useAra((s) => s.chatMessages);
  const office = useAra((s) => s.office);
  const setChatMessages = useAra((s) => s.setChatMessages);
  const addChatMessage = useAra((s) => s.addChatMessage);
  const selected = useAra((s) => s.officeSelected);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Standaard open. Dichtklappen was eerst de standaard bij een leeg gesprek,
  // maar dan moet je eerst een balk aanklikken voor je iets kunt vragen — en
  // vragen is precies waar dit voor is. Het probleem was nooit dat het open
  // stond; het was dat het 46vh pakte en meegroeide. Het plafond lost dat op,
  // de knop is er voor wie de cijfers even helemaal wil zien.
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Wie spreek je aan. Dit ging vroeger naar wie je ook maar aanklikte — ook
  // een worker of een scout, en dan stond er een opdracht op het bord met de
  // manager overgeslagen. De keten is geen suggestie: de vraag gaat naar de
  // manager (of de chief), mét de naam van de rol waar hij over gaat.
  const target = useMemo(() => recipientForOffice(office?.staff, selected), [office, selected]);

  /**
   * Of er nu iemand is. Een leeg gesprek met een rol die niet draait ziet er
   * precies hetzelfde uit als een gesprek dat aankomt, en dat is het verschil
   * tussen wachten op een antwoord en wachten op niets. Wat we weten: draait
   * deze rol (`live`/`busyWith` uit de bezetting), of staat je vraag al als
   * taak op het bord van dit kantoor.
   */
  const presence = useMemo(() => {
    const person = office?.staff.find((p) => p.id === target.id);
    const waiting = (office?.work.open ?? []).filter(
      (t) => t.title.startsWith('CHAT:') && t.staffId === target.id,
    ).length;
    if (person?.busyWith || person?.live) {
      return { state: 'live', note: 'is nu aan het werk — je bericht komt binnen bij een levende sessie.', waiting };
    }
    if (waiting > 0) {
      return {
        state: 'waking',
        note: `heeft ${waiting === 1 ? 'je vraag' : `${waiting} vragen`} op het bord staan; de watchdog wekt hem bij de volgende ronde (≤5 min).`,
        waiting,
      };
    }
    return {
      state: 'away',
      note: 'draait nu niet. Je bericht komt op het bord en wekt hem — reken op minuten, niet op seconden.',
      waiting,
    };
  }, [office, target.id]);

  useEffect(() => {
    void loadChat(room).then(setChatMessages);
  }, [room, setChatMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText('');
    // Klikte je een specialist aan, dan blijft dát in de vraag staan — de
    // manager moet weten waar het over gaat, ook al is hij de ontvanger.
    const body = target.about ? `Over ${target.about}: ${value}` : value;
    const saved = await sendChat({ room, text: body, to: target.id, project });
    // Het opgeslagen bericht (met server-id) toevoegen; de SSE-echo van
    // hetzelfde bericht valt daarna weg tegen de id-dedupe.
    if (saved) addChatMessage(saved);
    setSending(false);
  };

  return (
    <div className={`office-chat ${open ? '' : 'office-chat-shut'}`}>
      {/* Het gesprek stond permanent onderin en groeide mee met het aantal
          berichten, dus het duwde de stationlijst en de cijfers weg — twee
          dingen die om dezelfde kolom vochten. Nu is het inklapbaar en heeft
          het een plafond: je ziet dat er een gesprek is, en je kiest zelf of
          het ruimte krijgt. */}
      <button
        type="button"
        className="office-chat-head"
        onClick={() => setOpen(!open)}
        title={open ? 'Gesprek inklappen' : 'Gesprek openklappen'}
      >
        <span className="office-chat-who">
          <span className={`hq-dot hq-dot-${presence.state}`} />
          <span>
            Vraag het <strong>{target.name}</strong>
            {/* Zichtbaar maken dat de vraag via de manager loopt — anders lijkt
                het alsof je de specialist zelf te pakken hebt. */}
            {target.about && <em> · over {target.about}</em>}
          </span>
        </span>
        <span className="office-chat-count">
          {messages.length > 0 && <em>{messages.length}</em>}
          {open ? '▾' : '▴'}
        </span>
      </button>
      {/* Wat er met je bericht gebeurt, vóór je het stuurt. */}
      <p className={`office-chat-presence office-presence-${presence.state}`}>
        <strong>{target.name}</strong> {presence.note}
      </p>
      <div className="office-chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="office-note">
            Nog geen berichten. Stel je vraag hieronder — hij komt als taak op het bord van deze
            tak, zodat er ook echt iemand op afkomt.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`office-msg office-msg-${m.role === 'user' ? 'me' : 'them'}`}>
            <span className="office-msg-from">{m.sender}</span>
            {m.text}
          </div>
        ))}
      </div>
      <div className="office-chat-input">
        <input
          value={text}
          placeholder={`Bericht aan ${target.name}…`}
          aria-label={`Bericht aan ${target.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <button type="button" onClick={() => void submit()} disabled={sending}>
          Stuur
        </button>
      </div>
    </div>
  );
}

export function OfficeOverlay(): JSX.Element | null {
  const project = useAra((s) => s.officeProject);
  const office = useAra((s) => s.office);
  const loading = useAra((s) => s.officeLoading);
  const selected = useAra((s) => s.officeSelected);
  const setOffice = useAra((s) => s.setOffice);
  const selectStation = useAra((s) => s.selectStation);
  const closeOffice = useAra((s) => s.closeOffice);
  const openOffice = useAra((s) => s.openOffice);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const [tab, setTab] = useState<'werk' | 'bord' | 'team' | 'meting'>('werk');
  const [picking, setPicking] = useState(false);

  // Kantoor ophalen en live bijhouden zolang het open staat.
  useEffect(() => {
    if (!project) return;
    let stop = false;
    const refresh = (): void => {
      void loadOffice(project).then((snapshot) => {
        if (!stop) setOffice(snapshot);
      });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [project, setOffice, tasksVersion]);

  // Van buiten gewisseld van kantoor (kaart, diep-link)? Dan hoort de kiezer
  // dicht te zijn; hij hangt aan de titel van het kantoor waar je nú bent.
  useEffect(() => {
    setPicking(false);
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && project) {
        // Van binnen naar buiten afpellen: eerst de kiezer, dan de selectie,
        // dan pas het kantoor. Escape hoort nooit méér weg te halen dan de
        // bovenste laag die openstaat.
        if (picking) setPicking(false);
        else if (useAra.getState().officeSelected) selectStation(null);
        else closeOffice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, picking, closeOffice, selectStation]);

  if (!project) return null;

  const accent = VENTURES.find((v) => v.id === office?.venture)?.color ?? '#9b8cff';
  const station = office?.stations.find((s) => s.id === selected) ?? null;
  const person = office?.staff.find((s) => s.id === selected) ?? null;
  const room = `office:${project}`;

  const work = office?.work;
  const escalations = work?.escalations ?? [];
  const openTasks = work?.open ?? [];
  const now = office?.now ?? Date.now();
  // De taken van de aangeklikte rol: escalaties eerst, want die wachten op jou.
  const personTasks = person
    ? [...escalations, ...openTasks].filter((t) => t.staffId === person.id)
    : [];

  /** Wie de tak aanstuurt — het antwoord op "en wie gaat hier dan over". */
  const managerName = office?.staff.find((m) => m.role === 'manager')?.name ?? 'de manager';
  /** Naam van de leidinggevende van iemand, via `reportsTo` in dezelfde lijst. */
  const chiefOf = (member: StaffMember): string | undefined =>
    member.reportsTo ? office?.staff.find((m) => m.id === member.reportsTo)?.name : undefined;
  /** Wie een terugkerende taak draagt; leeg in het playbook = de manager. */
  const dutyOwner = (who: string | undefined): string => {
    if (!who) return managerName;
    const match = office?.playbook?.specialists.find((sp) => sp.agent === who);
    return match?.name ?? roleLabel(who);
  };

  /** Van een taak naar de rol die hem draagt: bezetting én gesprek in één tik. */
  const goToOwner = (staffId: string): void => {
    selectStation(staffId);
    setTab('team');
  };

  return (
    <div className="office-overlay">
      <div className="office-topbar">
        <button type="button" className="btn" onClick={closeOffice}>
          ← Kaart
        </button>
        {/* De titel is de kantoorwissel. Voorheen was een ander kantoor drie
            handelingen ver: terug naar de kaart, het district zoeken, klikken.
            De lijst die je daar aanklikt staat gewoon in de store. */}
        <div className="office-switch-wrap">
          <button
            type="button"
            className="office-switch"
            aria-haspopup="menu"
            aria-expanded={picking}
            title="Ander kantoor openen"
            onClick={() => setPicking(!picking)}
          >
            <span className="office-title">
              <strong>{project}</strong>
              <span style={{ color: accent }}>{office?.ventureLabel ?? '…'}</span>
            </span>
            <span className="office-switch-caret">{picking ? '▴' : '▾'}</span>
          </button>
          {picking && (
            <OfficePicker
              current={project}
              onPick={(next) => {
                setPicking(false);
                if (next !== project) openOffice(next);
              }}
            />
          )}
        </div>
        {picking && (
          // Buiten de kiezer klikken sluit hem — anders blijft hij over het
          // kantoor hangen zodra je van gedachten verandert.
          <div
            className="office-pick-scrim"
            onClick={() => setPicking(false)}
            onPointerDown={() => setPicking(false)}
          />
        )}
        {office && office.realStations < office.stations.length && (
          <span
            className="office-sim"
            title="Een werkplek zonder bron toont geen cijfer; ARA vult niets stilzwijgend in."
          >
            <b className="office-chip-long">
              {office.realStations === 0
                ? 'alles voorbeeld — geen bron gekoppeld'
                : `${office.realStations} van ${office.stations.length} werkplekken op echte data`}
            </b>
            <b className="office-chip-short">
              {office.realStations === 0 ? 'alles voorbeeld' : `${office.realStations}/${office.stations.length} met bron`}
            </b>
          </span>
        )}
        {office && office.staleStations > 0 && (
          <span
            className="office-stale"
            title="Deze koppelingen stuurden al meer dan een half uur niets meer."
          >
            {office.staleStations} verouderd
          </span>
        )}
        <div className="office-headline">
          <span>{office?.headline.label}</span>
          <strong className={office?.headline.estimated ? 'office-est' : undefined}>
            {office?.headline.value ?? '—'}
          </strong>
          {office?.headline.delta && (
            <em style={{ color: TONE_COLORS[office.headline.tone ?? 'info'] }}>{office.headline.delta}</em>
          )}
          {/* De grote teller op de balk kon ingevuld zijn zonder dat er iets
              bij stond — juist het cijfer waar je het eerst naar kijkt. */}
          {office?.headline.estimated && <Tag kind="est">voorbeeld</Tag>}
        </div>
      </div>

      <div className="office-canvas">
        {office ? (
          <Canvas
            orthographic
            shadows
            dpr={[1, 2]}
            camera={{ position: [20, 21, 20], zoom: 30, near: -200, far: 400 }}
            gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
            onPointerMissed={() => selectStation(null)}
            style={{ touchAction: 'none' }}
          >
            <color attach="background" args={['#150e2e']} />
            <OfficeScene office={office} accent={accent} selectedId={selected} onSelect={selectStation} />
            <MapControls
              makeDefault
              target={[0, 1.4, 0]}
              enableRotate
              enableDamping
              dampingFactor={0.1}
              minZoom={14}
              maxZoom={90}
              maxPolarAngle={Math.PI / 2.6}
              minPolarAngle={Math.PI / 6}
              screenSpacePanning={false}
            />
            <EffectComposer multisampling={0}>
              <Bloom intensity={0.55} luminanceThreshold={0.68} mipmapBlur radius={0.7} />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
              <Vignette eskil={false} offset={0.28} darkness={0.5} />
            </EffectComposer>
          </Canvas>
        ) : (
          <div className="office-loading">{loading ? 'Kantoor wordt geopend…' : 'Geen kantoorgegevens'}</div>
        )}
      </div>

      <aside className="office-side">
        <div className="office-tabs">
          <button
            type="button"
            className={tab === 'werk' ? 'active' : ''}
            onClick={() => setTab('werk')}
            title="De werkplekken van dit kantoor en hun cijfers"
          >
            Werkvloer
          </button>
          <button
            type="button"
            className={`office-tab-bord ${tab === 'bord' ? 'active' : ''}`}
            onClick={() => setTab('bord')}
          >
            Bord
            {escalations.length > 0 && <span className="office-tab-badge">{escalations.length}</span>}
          </button>
          <button
            type="button"
            className={tab === 'team' ? 'active' : ''}
            onClick={() => setTab('team')}
            title="Wie hier werkt, wat hun functie is en wie je mag aanspreken"
          >
            Team
          </button>
          <button
            type="button"
            className={tab === 'meting' ? 'active' : ''}
            onClick={() => setTab('meting')}
            title="Alleen gemeten cijfers — nooit voorbeeldcijfers"
          >
            Gemeten
          </button>
        </div>

        <div className="office-side-body">
          {/* Een escalatie wacht op een mens, niet op een agent. Hij blijft dus
              op elk tabblad staan: verstopt achter een tab is hij er in de
              praktijk niet. */}
          {escalations.length > 0 && tab !== 'bord' && (
            <button type="button" className="office-esc-strip" onClick={() => setTab('bord')}>
              ⚠{' '}
              {escalations.length === 1
                ? '1 taak wacht op jou'
                : `${escalations.length} taken wachten op jou`}
              <em>bord →</em>
            </button>
          )}

          {tab === 'werk' && station && (
            <StationDetail station={station} valueKind={office?.valueKind ?? 'count'} now={now} />
          )}
          {tab === 'werk' && !station && (
            <div className="office-list">
              {/* Eén regel die uitlegt hoe je de kolom rechts moet lezen. Stond
                  er niet, en toen was elke regel een getal zonder eenheid. */}
              <p className="office-note office-note-lead">
                {office && office.realStations > 0
                  ? 'Rechts staat het cijfer zoals de agent van die werkplek het aanleverde, met het tijdstip erbij. Werkplekken zonder agent tonen geen cijfer.'
                  : 'Nog geen enkele werkplek levert cijfers aan, dus er staat rechts ook niets — een ingevuld getal zou hier niets betekenen.'}
              </p>
              {office?.stations.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`office-row ${s.simulated ? 'office-row-sim' : ''}`}
                  onClick={() => selectStation(s.id)}
                  title={
                    s.simulated
                      ? `${s.label} — voorbeeldwerkplek; open hem om te zien welke cijfers hier zouden staan.`
                      : `${s.label} — ${provenance(s, now)}${s.agentName ? ` · ${s.agentName} zit hier` : ''}`
                  }
                >
                  {/* Gevuld = een echte status, hol = een voorbeeld. Een volle
                      gekleurde stip op een verzonnen werkplek leest als een
                      meting, en dat is precies wat het niet is. */}
                  <span
                    className={`office-dot office-status-${s.status} ${s.simulated ? 'office-dot-sim' : ''}`}
                  />
                  <span className="office-row-label">
                    {s.label}
                    {/* Bij een voorbeeldwerkplek staat er niets onder de naam:
                        het label rechts zegt het al, en acht keer dezelfde
                        zin onder elkaar leest niemand meer. */}
                    {!s.simulated && <em>{s.sub || STATION_STATUS_LABEL[s.status] || s.status}</em>}
                  </span>
                  {s.simulated ? (
                    <Tag kind="est">voorbeeld</Tag>
                  ) : (
                    <span className="office-figure">
                      <strong
                        style={
                          office.valueKind === 'money'
                            ? { color: s.value >= 0 ? TONE_COLORS.good : TONE_COLORS.bad }
                            : undefined
                        }
                      >
                        {office.valueKind === 'money'
                          ? `${s.value >= 0 ? '+' : '−'}$${Math.abs(s.value).toFixed(2)}`
                          : Math.round(s.value)}
                      </strong>
                      {/* Het tijdstip is het enige dat dit cijfer duidt: van wie
                          en van wanneer. Een eenheid erbij verzinnen zou een
                          betekenis geven die ARA niet kent. */}
                      <em className={s.stale ? 'office-figure-stale' : undefined}>
                        {s.stale
                          ? `verouderd · ${clockTime(s.updatedAt ?? 0)}`
                          : s.updatedAt
                            ? `${ageString(s.updatedAt, now)} geleden`
                            : 'gemeld'}
                      </em>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {tab === 'bord' && (
            <BoardTab work={work} staff={office?.staff ?? []} now={now} onOwner={goToOwner} />
          )}

          {tab === 'team' && (
            <div className="office-list">
              {person && (
                <div className="office-person">
                  <h3>{person.name}</h3>
                  <p>
                    <b>{tierLabel(person)}</b>
                    {chiefOf(person) ? ` · valt onder ${chiefOf(person)}` : ''} · {person.status}
                  </p>
                  {person.does && <p className="office-note">{person.does}</p>}
                  {person.busyWith && <p className="office-note">Bezig met: {person.busyWith}</p>}
                  {/* De keten is geen suggestie: wie geen eigen lijn heeft,
                      spreek je aan via zijn manager. Dat stond alleen in de
                      chatkop, waar je het pas zag nadat je had getypt. */}
                  <p className="office-note">
                    {isLeadership(person)
                      ? `Het gesprek onderin staat op ${person.name} — schrijf hem direct.`
                      : `Vragen hierover lopen via ${managerName}; het gesprek onderin zet dat voor je klaar.`}
                  </p>
                  {/* Wat er voor deze rol op het bord staat, hier en niet op een
                      ander tabblad: de vraag "wie gaat hierover" en de vraag
                      "wat ligt er voor hem" zijn dezelfde vraag. */}
                  {personTasks.length > 0 ? (
                    <div className="office-person-tasks">
                      {personTasks.map((t) => (
                        <TaskRow key={t.id} task={t} now={now} flag />
                      ))}
                    </div>
                  ) : (
                    <p className="office-note">
                      Geen open taken op het bord{work?.truncated ? ' (afgekapte lijst)' : ''}.
                    </p>
                  )}
                </div>
              )}

              {/* De bezetting was één rij namen: "Wagenparkbeheer" naast
                  "ARA Supervisor" naast een agent die toevallig draait, zonder
                  dat je zag wie waarvoor is of wie boven wie staat. Nu staan ze
                  in de drie groepen die de organisatie zelf kent, en draagt elke
                  regel zijn functie in plaats van alleen zijn naam. */}
              {STAFF_GROUPS.map(({ key, title, hint }) => {
                const members = (office?.staff ?? []).filter((m) => staffGroup(m) === key);
                if (members.length === 0) return null;
                return (
                  <div key={key} className="office-staff-group">
                    <h4 className="office-sub-head">
                      {title} <span className="office-sub-hint">{hint}</span>
                    </h4>
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`office-row ${selected === m.id ? 'active' : ''} ${
                          m.live === false ? 'office-row-vacant' : ''
                        }`}
                        onClick={() => selectStation(m.id)}
                        title={m.does ?? m.status}
                      >
                        <span
                          className={`office-dot ${
                            m.busyWith || m.live ? 'office-status-working' : 'office-status-idle'
                          }`}
                        />
                        <span className="office-row-label">
                          {m.name}
                          {/* De functie erbij, niet alleen de naam: "Manager
                              Wagenpark" zei wél wat iemand deed, "Boeking DE"
                              niet. `does` komt uit het playbook van de tak. */}
                          <em>{m.does ?? `${tierLabel(m)} · ${m.status}`}</em>
                        </span>
                        {isLeadership(m) ? (
                          <span className="office-row-cta">schrijf hem →</span>
                        ) : m.live === false ? (
                          <span className="office-row-state">onbezet</span>
                        ) : (
                          <span className="office-row-state office-row-state-on">actief</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}

              {/* De grenzen van deze tak horen zichtbaar te zijn, niet alleen
                  in een promptregel die alleen de manager leest. */}
              {office?.playbook && (
                <>
                  <h4 className="office-sub-head">
                    Terugkerend werk <span className="office-sub-hint">met ritme en eigenaar</span>
                  </h4>
                  <ul className="office-bullets">
                    {office.playbook.duties.map((d) => (
                      <li key={d.text}>
                        {d.text} <span className="office-cadence">{d.every}</span>
                        {/* Wie dit doet. Zonder dit is terugkerend werk een
                            lijst wensen zonder eigenaar. */}
                        <span className="office-duty-who">{dutyOwner(d.who)}</span>
                      </li>
                    ))}
                  </ul>

                  <h4 className="office-sub-head">Altijd escaleren</h4>
                  <ul className="office-bullets office-bullets-warn">
                    {office.playbook.escalate.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>

                  {office.playbook.dataSources.length > 0 && (
                    <>
                      <h4 className="office-sub-head">Databronnen</h4>
                      <ul className="office-bullets">
                        {office.playbook.dataSources.map((d) => (
                          <li key={d.label} className={d.configured ? undefined : 'office-bullet-open'}>
                            <strong>{d.label}</strong> — {d.configured ? d.how : `nog niet aangesloten: ${d.how}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'meting' && (
            <div className="office-list">
              {/* Het enige paneel zonder voorbeeldcijfers: wat hier staat is
                  gemeten (git op schijf, het bord, de usage-tabel). Meet iets
                  niet, dan staat de regel er niet — nooit een invulling. */}
              <p className="office-note office-note-real">
                Alles hieronder is gemeten: git leest de repo, het bord telt zijn taken, de
                tokentabel telt tokens
                {office?.pulse?.measuredAt ? ` — bijgewerkt om ${clockTime(office.pulse.measuredAt)}` : ''}
                . Wat niet te meten is, staat er niet.
              </p>
              {office?.measured?.length ? (
                office.measured.map((m) => (
                  <div key={m.label} className="office-row office-row-static">
                    <span className="office-row-label">{m.label}</span>
                    <strong style={{ color: TONE_COLORS[m.tone ?? 'info'] }}>{m.value}</strong>
                  </div>
                ))
              ) : (
                <p className="office-note">
                  Nog niets te meten voor dit project. Zet een <code>path</code> bij dit project in
                  projects.json, dan leest ARA de repo zelf uit.
                </p>
              )}
              {office?.pulse?.lastCommitSubject && (
                <p className="office-note">Laatste commit: “{office.pulse.lastCommitSubject}”</p>
              )}
            </div>
          )}
        </div>

        <OfficeChat project={project} room={room} />
      </aside>
    </div>
  );
}
