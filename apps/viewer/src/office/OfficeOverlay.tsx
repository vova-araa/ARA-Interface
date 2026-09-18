import { useEffect, useMemo, useRef, useState } from 'react';
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
import { recipientForOffice } from '../ui/ChatPanel.tsx';
import { loadChat, loadOffice, sendChat } from './api.ts';
import { TONE_COLORS } from './textures.ts';

/**
 * CSS die t.z.t. in theme.css hoort, in het blok
 * "Kantoren: interieur per project" — hij staat hier omdat theme.css buiten
 * deze wijziging valt. Alles is `.office-`-genaamd en gebruikt de bestaande
 * variabelen (--tap, --safe-*), zodat verhuizen straks knippen en plakken is.
 */
const OFFICE_WORK_CSS = `
/* Balk die op élk tabblad blijft staan zolang er iets op een mens wacht.
   Een escalatie achter een tabblad is een escalatie die niemand ziet. */
.office-esc-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--tap);
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 107, 107, 0.45);
  background: rgba(255, 107, 107, 0.14);
  color: #ffd5d5;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.office-esc-strip:hover { background: rgba(255, 107, 107, 0.22); }
.office-esc-strip em { margin-left: auto; font-style: normal; opacity: 0.75; font-size: 12px; }

/* Tellers van het bord. Alle drie geteld, geen ervan ingevuld. */
.office-board-sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
.office-board-stat {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.office-board-stat span { font-size: 10px; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.05em; }
.office-board-stat strong { font-size: 17px; }
.office-board-hot { color: #ff8b8b; }

.office-tasks { display: flex; flex-direction: column; gap: 4px; }
.office-task {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
  text-align: left;
}
button.office-task { cursor: pointer; }
button.office-task:hover { background: rgba(150, 120, 255, 0.16); border-color: rgba(150, 120, 255, 0.35); }
.office-task-esc { border-color: rgba(255, 107, 107, 0.4); background: rgba(255, 107, 107, 0.1); }
button.office-task-esc:hover { background: rgba(255, 107, 107, 0.18); border-color: rgba(255, 107, 107, 0.6); }
.office-task-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.office-task-title { font-size: 13px; line-height: 1.25; }
.office-task-meta { font-size: 11px; opacity: 0.55; }
/* Twee regels toelichting is genoeg om te weten waar het over gaat; daarna
   duwt één lange regel de rest van het bord van het scherm. */
.office-task-note {
  font-style: normal;
  font-size: 11.5px;
  opacity: 0.75;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* De eigenaar van de taak is de knop: hem aanklikken zet de bezetting én het
   gesprek op die rol, zodat "wie gaat hierover" geen tweede zoektocht is. */
.office-task-owner {
  flex: none;
  max-width: 45%;
  font-size: 11.5px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(150, 120, 255, 0.2);
  color: #ded5ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.office-person-tasks { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.office-sub-head-warn { color: #ff9b9b; opacity: 0.9; }
.office-task-flag { color: #ff9b9b; font-weight: 600; opacity: 0.95; }

/* Vier tabbladen passen alleen als ze niet afbreken. */
.office-tabs button { white-space: nowrap; padding-left: 6px; padding-right: 6px; }
.office-tab-badge {
  display: inline-block;
  margin-left: 5px;
  min-width: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ff6b6b;
  color: #2a0d14;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

/* Kantoorwissel: de titel in de balk is de knop. */
.office-switch-wrap { position: relative; display: flex; }
.office-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 4px 8px;
  border: 1px solid rgba(150, 120, 255, 0.25);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.office-switch:hover { background: rgba(150, 120, 255, 0.14); }
.office-switch-caret { opacity: 0.6; font-size: 11px; }
.office-pick-scrim { position: fixed; inset: 0; z-index: 1; }
.office-pick {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 2;
  width: max(220px, min(78vw, 300px));
  max-height: 60vh;
  overflow-y: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(150, 120, 255, 0.35);
  background: rgba(26, 17, 56, 0.99);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}
.office-pick-group + .office-pick-group { margin-top: 6px; }
.office-pick-group h5 {
  margin: 6px 4px 3px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
}
.office-pick-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: var(--tap);
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.office-pick-row:hover { background: rgba(150, 120, 255, 0.16); }
.office-pick-row.active { background: rgba(150, 120, 255, 0.22); border-color: rgba(150, 120, 255, 0.4); }
.office-pick-row em { margin-left: auto; font-style: normal; font-size: 11px; opacity: 0.6; }
.office-pick-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }

/* Hoogte van de kopbalk, als getal dat de kiezer kan gebruiken. Op de telefoon
   hangt hij namelijk niet onder de knop maar onder de héle balk: onder de knop
   begint hij op ~100px van links en loopt hij het scherm uit. */
.office-overlay { --office-pick-top: calc(var(--safe-t) + 62px); }

@media (max-width: 900px) {
  .office-overlay { --office-pick-top: calc(var(--safe-t) + 58px); }
  /* Statisch: dan is de kiezer t.o.v. het hele kantoor geplaatst, niet t.o.v.
     de titelknop — en past hij tussen de twee schermranden. */
  .office-switch-wrap { position: static; }
  .office-pick {
    top: var(--office-pick-top);
    left: calc(12px + var(--safe-l));
    right: calc(12px + var(--safe-r));
    width: auto;
    max-height: 52vh;
  }
  .office-board-sum { gap: 6px; }
  .office-board-stat { padding: 7px 8px; }
  .office-board-stat strong { font-size: 15px; }
  /* Op een telefoon houdt het kantoor (42vh) en het gesprek de zijkolom kort;
     krap gezette regels zijn hier het verschil tussen één en drie taken in
     beeld. De tikdoelen blijven var(--tap). */
  .office-task { padding: 7px 9px; gap: 8px; }
  .office-task-title { font-size: 12.5px; }
  .office-task-owner { max-width: 42%; }
}

/* Liggend op een telefoon is de balk 46px hoog in plaats van 52. */
@media (orientation: landscape) and (max-height: 520px) and (max-width: 1100px) {
  .office-overlay { --office-pick-top: calc(var(--safe-t) + 52px); }
}
`;

const ROLE_LABEL: Record<StaffMember['role'], string> = {
  supervisor: 'chief',
  manager: 'manager',
  agent: 'agent',
  scout: 'scout',
  ops: 'ops',
};

/** Hoe het bord zijn statussen noemt — zelfde woorden als het takenbord. */
const TASK_STATUS_LABEL: Record<string, string> = {
  open: 'open',
  claimed: 'bezig',
  done: 'af',
  failed: 'mislukt',
};

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
        title={metric.estimated ? 'Voorbeeldcijfer — geen bron gekoppeld' : undefined}
        style={metric.tone && !metric.estimated ? { color: TONE_COLORS[metric.tone] } : undefined}
      >
        {metric.estimated ? '≈ ' : ''}
        {metric.value}
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
          {TASK_STATUS_LABEL[task.status] ?? task.status} · {task.assignee || '—'} ·{' '}
          {ageString(task.updatedAt, now)}
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
        <div className="office-board-stat">
          <span>wacht op jou</span>
          <strong className={escalations.length > 0 ? 'office-board-hot' : undefined}>
            {escalations.length}
          </strong>
        </div>
        <div className="office-board-stat">
          <span>open</span>
          <strong>
            {truncated ? '≥' : ''}
            {open.length}
          </strong>
        </div>
        {doneToday !== null && (
          <div className="office-board-stat">
            <span>vandaag af</span>
            <strong>{doneToday}</strong>
          </div>
        )}
      </div>

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
        <p className="office-note">
          Niets open op het bord van dit project.
          {doneToday !== null && doneToday > 0 ? ' Wat vandaag binnenkwam is af.' : ''}
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

/** Detailpaneel van een werkplek: cijfers, belofte × geleverd en de curve. */
function StationDetail({ station, valueKind }: { station: Station; valueKind: string }): JSX.Element {
  const d = station.detail;
  return (
    <div className="office-detail">
      <div className="office-detail-head">
        <div>
          <h3>{d.title}</h3>
          <p>{d.subtitle}</p>
        </div>
        <span className={`office-status office-status-${station.status}`}>{station.status}</span>
      </div>

      {station.simulated && (
        <p className="office-warn">
          Voorbeeldcijfers — geen agent levert data voor deze werkplek. Alles met ≈ is ingevuld.
        </p>
      )}
      {station.stale && (
        <p className="office-warn">
          Verouderd — de koppeling stuurde voor het laatst iets om{' '}
          {new Date(station.updatedAt ?? 0).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}.
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
              {k.estimated ? '≈ ' : ''}
              {k.value}
            </strong>
          </div>
        ))}
      </div>

      <h4>Gegevens</h4>
      <div className="office-metrics">
        {station.metrics.map((m) => (
          <MetricRow key={m.label} metric={m} />
        ))}
      </div>

      <h4>Belofte × geleverd {d.estimated && <span className="office-est">≈ voorbeeld</span>}</h4>
      <table className="office-table">
        <thead>
          <tr>
            <th />
            <th>plan</th>
            <th>echt</th>
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

      <h4>Verloop {d.estimated && <span className="office-est">≈ voorbeeld</span>}</h4>
      <Sparkline values={d.curve} color={valueKind === 'money' ? '#6ee7ff' : '#c07cff'} />
      {station.agentName && (
        <p className="office-note">
          Aan het werk: <strong>{station.agentName}</strong>
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
      <button type="button" className="office-chat-head" onClick={() => setOpen(!open)}>
        <span>
          Gesprek met <strong>{target.name}</strong>
          {/* Zichtbaar maken dat de vraag via de manager loopt — anders lijkt
              het alsof je de specialist zelf te pakken hebt. */}
          {target.about && <em style={{ opacity: 0.6 }}> · over {target.about}</em>}
        </span>
        <span className="office-chat-count">
          {messages.length > 0 && <em>{messages.length}</em>}
          {open ? '▾' : '▴'}
        </span>
      </button>
      <div className="office-chat-list" ref={listRef}>
        {messages.length === 0 && <p className="office-note">Nog geen berichten. Stel een vraag.</p>}
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

  /** Van een taak naar de rol die hem draagt: bezetting én gesprek in één tik. */
  const goToOwner = (staffId: string): void => {
    selectStation(staffId);
    setTab('team');
  };

  return (
    <div className="office-overlay">
      <style>{OFFICE_WORK_CSS}</style>
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
            title="Cijfers met ≈ zijn ingevuld omdat er nog geen bron aan gekoppeld is."
          >
            {office.realStations === 0
              ? 'voorbeeldcijfers'
              : `${office.realStations}/${office.stations.length} op echte data`}
          </span>
        )}
        {office && office.staleStations > 0 && (
          <span className="office-stale" title="Deze koppelingen stuurden al een tijd niets meer.">
            {office.staleStations} verouderd
          </span>
        )}
        <div className="office-headline">
          <span>{office?.headline.label}</span>
          <strong>{office?.headline.value ?? '—'}</strong>
          {office?.headline.delta && (
            <em style={{ color: TONE_COLORS[office.headline.tone ?? 'info'] }}>{office.headline.delta}</em>
          )}
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
          <button type="button" className={tab === 'werk' ? 'active' : ''} onClick={() => setTab('werk')}>
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
          <button type="button" className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
            Team
          </button>
          <button type="button" className={tab === 'meting' ? 'active' : ''} onClick={() => setTab('meting')}>
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

          {tab === 'werk' && station && <StationDetail station={station} valueKind={office?.valueKind ?? 'count'} />}
          {tab === 'werk' && !station && (
            <div className="office-list">
              <p className="office-note">Klik op een bureau in het kantoor, of kies hier.</p>
              {office?.stations.map((s) => (
                <button key={s.id} type="button" className="office-row" onClick={() => selectStation(s.id)}>
                  <span className={`office-dot office-status-${s.status}`} />
                  <span className="office-row-label">
                    {s.label}
                    <em>
                      {s.sub}
                      {s.stale ? ' · verouderd' : s.simulated ? ' · ≈' : ''}
                    </em>
                  </span>
                  <strong
                    className={s.simulated ? 'office-est' : undefined}
                    style={s.simulated ? undefined : { color: s.value >= 0 ? TONE_COLORS.good : TONE_COLORS.bad }}
                  >
                    {office.valueKind === 'money'
                      ? `${s.value >= 0 ? '+' : '-'}$${Math.abs(s.value).toFixed(2)}`
                      : Math.round(s.value)}
                  </strong>
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
                    {ROLE_LABEL[person.role]} · {person.status}
                  </p>
                  {person.does && <p className="office-note">{person.does}</p>}
                  {person.busyWith && <p className="office-note">Bezig met: {person.busyWith}</p>}
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
              {office?.staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`office-row ${selected === s.id ? 'active' : ''} ${
                    s.live === false ? 'office-row-vacant' : ''
                  }`}
                  onClick={() => selectStation(s.id)}
                >
                  <span
                    className={`office-dot ${
                      s.busyWith || s.live ? 'office-status-working' : 'office-status-idle'
                    }`}
                  />
                  <span className="office-row-label">
                    {s.name}
                    <em>
                      {ROLE_LABEL[s.role]} · {s.status}
                    </em>
                  </span>
                </button>
              ))}

              {/* De grenzen van deze tak horen zichtbaar te zijn, niet alleen
                  in een promptregel die alleen de manager leest. */}
              {office?.playbook && (
                <>
                  <h4 className="office-sub-head">Terugkerend werk</h4>
                  <ul className="office-bullets">
                    {office.playbook.duties.map((d) => (
                      <li key={d.text}>
                        {d.text} <span className="office-cadence">{d.every}</span>
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
                Alles hieronder is gemeten. Geen voorbeeldcijfers.
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
