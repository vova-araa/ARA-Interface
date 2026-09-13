import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { VENTURES, type Metric, type Station, type StaffMember } from '@ara/shared';
import { useAra } from '../store.ts';
import { OfficeScene } from './OfficeScene.tsx';
import { loadChat, loadOffice, sendChat } from './api.ts';
import { TONE_COLORS } from './textures.ts';

const ROLE_LABEL: Record<StaffMember['role'], string> = {
  supervisor: 'chief',
  manager: 'manager',
  agent: 'agent',
  scout: 'scout',
  ops: 'ops',
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

/** Kantoorchat: praat direct met een agent, de manager of de chief. */
function ChatPanel({ project, room }: { project: string; room: string }): JSX.Element {
  const messages = useAra((s) => s.chatMessages);
  const office = useAra((s) => s.office);
  const setChatMessages = useAra((s) => s.setChatMessages);
  const addChatMessage = useAra((s) => s.addChatMessage);
  const selected = useAra((s) => s.officeSelected);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Wie spreek je aan: de gekozen persoon, anders de manager van deze tak.
  const target = useMemo(() => {
    const person = office?.staff.find((s) => s.id === selected);
    if (person) return { id: person.id, name: person.name };
    const manager = office?.staff.find((s) => s.role === 'manager');
    return { id: manager?.id ?? 'supervisor', name: manager?.name ?? 'supervisor' };
  }, [office, selected]);

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
    const saved = await sendChat({ room, text: value, to: target.id, project });
    // Het opgeslagen bericht (met server-id) toevoegen; de SSE-echo van
    // hetzelfde bericht valt daarna weg tegen de id-dedupe.
    if (saved) addChatMessage(saved);
    setSending(false);
  };

  return (
    <div className="office-chat">
      <div className="office-chat-head">
        Gesprek met <strong>{target.name}</strong>
      </div>
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
  const tasksVersion = useAra((s) => s.tasksVersion);
  const [tab, setTab] = useState<'werk' | 'team'>('werk');

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && project) {
        if (useAra.getState().officeSelected) selectStation(null);
        else closeOffice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, closeOffice, selectStation]);

  if (!project) return null;

  const accent = VENTURES.find((v) => v.id === office?.venture)?.color ?? '#9b8cff';
  const station = office?.stations.find((s) => s.id === selected) ?? null;
  const person = office?.staff.find((s) => s.id === selected) ?? null;
  const room = `office:${project}`;

  return (
    <div className="office-overlay">
      <div className="office-topbar">
        <button type="button" className="btn" onClick={closeOffice}>
          ← Kaart
        </button>
        <div className="office-title">
          <strong>{project}</strong>
          <span style={{ color: accent }}>{office?.ventureLabel ?? '…'}</span>
        </div>
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
          <button type="button" className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
            Team
          </button>
        </div>

        <div className="office-side-body">
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

          {tab === 'team' && (
            <div className="office-list">
              {person && (
                <div className="office-person">
                  <h3>{person.name}</h3>
                  <p>
                    {ROLE_LABEL[person.role]} · {person.status}
                  </p>
                  {person.busyWith && <p className="office-note">Bezig met: {person.busyWith}</p>}
                </div>
              )}
              {office?.staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`office-row ${selected === s.id ? 'active' : ''}`}
                  onClick={() => selectStation(s.id)}
                >
                  <span className={`office-dot ${s.busyWith ? 'office-status-working' : 'office-status-idle'}`} />
                  <span className="office-row-label">
                    {s.name}
                    <em>{ROLE_LABEL[s.role]} · {s.status}</em>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ChatPanel project={project} room={room} />
      </aside>
    </div>
  );
}
