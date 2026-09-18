import { useEffect, useState } from 'react';
import {
  RETRO_THRESHOLDS,
  type Finding,
  type FindingKind,
  type Retro,
  type RoleRow,
} from '@ara/shared';
import { withToken, type BoardTask } from '../api.ts';
import { useAra } from '../store.ts';
import { roleLabel } from './ChatPanel.tsx';

/**
 * De terugblik in beeld — de organisatie die naar zichzelf kijkt.
 *
 * De cijfers komen uit `buildRetro()` in @ara/shared via `GET /retro`; dit
 * bestand tekent ze en telt zelf niets. Dezelfde afspraak als bij het
 * handelsrapport en de Gemeten-tab: wat hier staat is geteld, of het staat er
 * niet. Er wordt nergens een gat opgevuld.
 *
 * Twee dingen uit de payload zijn het hele punt van deze weergave:
 *
 * **`tooQuiet`** is geen storing en ook geen "het gaat goed": er is te weinig
 * gebeurd om iets uit te lezen. Een lege bevindingenlijst tonen alsof de
 * organisatie gezond is, is precies de leugen die dit scherm moet vermijden.
 *
 * **`enoughData: false`** bij een rol betekent: geen percentage. Eén escalatie
 * op twee taken is geen patroon van 50%. De terminal zet er "te weinig om iets
 * van te zeggen" naast; hier staat hetzelfde, op dezelfde plek waar anders het
 * percentage zou staan.
 */

/** De drie vragen waar deze data antwoord op geeft; alles hangt eronder. */
const GROUPS: { key: string; question: string; kinds: FindingKind[]; quiet: string }[] = [
  {
    key: 'vast',
    question: 'Waar loopt dit vast?',
    kinds: ['vastgelopen', 'escaleert-vaak', 'mislukt', 'geen-resultaat'],
    quiet: `Geen werk dat langer dan ${Math.round(RETRO_THRESHOLDS.stuckMs / 3_600_000)} uur stilstond, en geen rol die opviel met escalaties, mislukkingen of lege resultaten.`,
  },
  {
    key: 'terug',
    question: 'Wat blijft terugkomen?',
    kinds: ['herhaalt'],
    quiet: `Geen taak die in dit venster ${RETRO_THRESHOLDS.repeatCount}× of vaker terugkwam. Werk uit het ritme (dagelijks, wekelijks, maandelijks) telt hier niet mee — dat hóórt terug te komen.`,
  },
  {
    key: 'last',
    question: 'Wie draagt te veel?',
    kinds: ['scheve-verdeling'],
    quiet: `Geen rol die in zijn eentje meer dan ${Math.round(RETRO_THRESHOLDS.dominantShare * 100)}% van het werk draagt.`,
  },
];

const KIND_LABEL: Record<FindingKind, string> = {
  vastgelopen: 'blijft liggen',
  'escaleert-vaak': 'escaleert vaak',
  mislukt: 'mislukt',
  herhaalt: 'keert terug',
  'geen-resultaat': 'geen resultaat',
  'scheve-verdeling': 'scheve verdeling',
};

const DAY_CHOICES = [7, 30, 90];

function pct(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Mediaan doorlooptijd leesbaar. Eén cijfer achter de komma, zoals `pnpm retro`. */
function durationString(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `${hours.toFixed(1).replace('.', ',')} uur`;
  return `${(hours / 24).toFixed(1).replace('.', ',')} dagen`;
}

/** Het rapport ophalen. `null` = niet gelukt; dan tonen we géén oude cijfers. */
export async function loadRetro(days: number): Promise<Retro | null> {
  try {
    const res = await fetch(withToken(`/retro?days=${days}`));
    if (!res.ok) return null;
    return (await res.json()) as Retro;
  } catch {
    return null;
  }
}

/**
 * Eén taak ophalen op id. Het bord laadt de laatste 100 taken, maar bewijs
 * wijst juist vaak naar ouder werk — dat is nu precies het werk dat blijft
 * liggen. Zonder deze ophaler zou "tik op een bevinding" de helft van de tijd
 * op een lege lijst uitkomen.
 */
export async function loadTaskById(id: string): Promise<BoardTask | null> {
  try {
    const res = await fetch(withToken(`/tasks/${encodeURIComponent(id)}`));
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; task?: BoardTask };
    return body.task ?? null;
  } catch {
    return null;
  }
}

function RoleLine({ row, considered }: { row: RoleRow; considered: number }): JSX.Element {
  const share = row.total / considered;
  return (
    <div className="retro-role">
      <div className="retro-role-top">
        <b>{roleLabel(row.who)}</b>
        {/* Het aandeel van één rol in het geheel is gemeten tegen alle taken in
            het venster, en dat venster is groot genoeg (anders was tooQuiet
            waar). Dit percentage mag dus wél, ook bij een kleine rol. */}
        <span className="retro-role-share">
          {row.total} {row.total === 1 ? 'taak' : 'taken'} · {pct(row.total, considered)} van al het
          werk
        </span>
      </div>
      <div className="retro-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <div className="retro-role-sub">
        <span>{row.done} af</span>
        {row.failed > 0 && <span className="stat-urgent">{row.failed} mislukt</span>}
        {row.escalated > 0 && <span>{row.escalated} escalatie(s)</span>}
        {row.pending > 0 && <span>{row.pending} open</span>}
        {row.medianMs !== undefined && <span>mediaan {durationString(row.medianMs)}</span>}
      </div>
      {/* Hier staat anders het percentage. Onder de drempel staat er waarom er
          geen staat — niet een getal dat toevallig 50% heet. */}
      {row.enoughData ? (
        <div className="retro-role-rate">
          {pct(row.escalated, row.total)} escaleert · {pct(row.done, row.total)} afgerond
        </div>
      ) : (
        <div className="retro-role-thin">te weinig om iets van te zeggen</div>
      )}
    </div>
  );
}

export interface RetroPanelProps {
  /** Tik op een bevinding → de taken eronder, als echte bordregels. */
  onEvidence: (finding: Finding) => void;
}

export function RetroPanel({ onEvidence }: RetroPanelProps): JSX.Element {
  const demo = useAra((s) => s.demo);
  const connected = useAra((s) => s.connected);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const [days, setDays] = useState(7);
  const [state, setState] = useState<'laden' | 'stuk' | 'ok'>('laden');
  const [retro, setRetro] = useState<Retro | null>(null);

  // Demo en een weggevallen verbinding tonen geen cijfers — net als de
  // tokenzuilen en de districtcijfers in de wereld. Oude getallen laten staan
  // is erger dan niets tonen: dan lees je een meting van een uur geleden als
  // de stand van nu.
  const live = !demo && connected;

  useEffect(() => {
    if (!live) {
      setRetro(null);
      return;
    }
    let alive = true;
    setState('laden');
    const refresh = (): void =>
      void loadRetro(days).then((result) => {
        if (!alive) return;
        setRetro(result);
        setState(result ? 'ok' : 'stuk');
      });
    refresh();
    const timer = setInterval(refresh, 120_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [live, days, tasksVersion]);

  /**
   * De kop draagt het venster en de belofte, en verder niets: "Terugblik"
   * stond er twee keer (de weergavekeuze erboven zegt het al) en dat kostte op
   * een telefoon een regel van een sheet die maar half het scherm is.
   */
  const head = (scope: JSX.Element | string): JSX.Element => (
    <div className="retro-head">
      <div className="retro-head-top">
        <span className="retro-scope">{scope}</span>
        <div className="retro-days" role="group" aria-label="Venster in dagen">
          {DAY_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`retro-day ${choice === days ? 'retro-day-on' : ''}`}
              aria-pressed={choice === days}
              onClick={() => setDays(choice)}
            >
              {choice}d
            </button>
          ))}
        </div>
      </div>
      <div className="retro-head-sub">
        Geteld uit het bord — nul tokens. Elke bevinding draagt de taken waarop hij rust.
      </div>
    </div>
  );

  if (!live) {
    return (
      <div className="retro">
        {head(demo ? 'demomodus' : 'geen verbinding')}
        <div className="empty">
          <div className="empty-title">{demo ? 'Demomodus' : 'Geen verbinding'}</div>
          <div className="empty-hint">
            {demo
              ? 'De demo speelt een verzonnen verhaal af; daar valt niets aan te meten. Zet ?demo=1 uit voor de echte terugblik.'
              : 'De collector is niet bereikbaar. Er staan hier met opzet geen cijfers van daarnet: die zouden de stand van nu lijken.'}
          </div>
        </div>
      </div>
    );
  }

  if (state === 'laden' && !retro) {
    return (
      <div className="retro">
        {head('bezig met tellen…')}
      </div>
    );
  }

  if (!retro) {
    return (
      <div className="retro">
        {head('niet gemeten')}
        <div className="empty">
          <div className="empty-title">Terugblik niet op te halen</div>
          <div className="empty-hint">
            /retro gaf geen antwoord. Draait de collector, en klopt het token?
          </div>
        </div>
      </div>
    );
  }

  const windowDays = Math.max(1, Math.round((retro.to - retro.from) / (24 * 60 * 60 * 1000)));

  return (
    <div className="retro">
      {head(
        `${retro.considered} ${retro.considered === 1 ? 'taak' : 'taken'} geraakt in ${windowDays} ${windowDays === 1 ? 'dag' : 'dagen'} · ${retro.roles.length} ${retro.roles.length === 1 ? 'rol' : 'rollen'} actief`,
      )}

      {retro.tooQuiet ? (
        // Niet leeg, niet groen: te stil. Dit is een uitspraak, geen gebrek aan
        // uitspraak — daarom een eigen blok en niet een lege lijst.
        <div className="retro-quiet">
          <div className="retro-quiet-title">Te weinig werk om iets uit te lezen</div>
          <p>
            Er zijn {retro.considered} {retro.considered === 1 ? 'taak' : 'taken'} geraakt in dit
            venster; vanaf {RETRO_THRESHOLDS.minTotal} durft de terugblik pas iets te zeggen.
          </p>
          <p>
            Dat is <b>geen</b> storing en ook <b>niet</b> "alles gaat goed" — het is niet gemeten.
            Een verbeterronde zou hier iets moeten verzinnen, dus die draait niet.
          </p>
          <p className="retro-quiet-hint">
            Neem een ruimer venster (30d of 90d) als je verder terug wilt kijken.
          </p>
        </div>
      ) : (
        GROUPS.map((group) => {
          const hits = retro.findings.filter((f) => group.kinds.includes(f.kind));
          return (
            <section key={group.key} className="retro-group">
              <h3 className="retro-question">{group.question}</h3>
              {hits.length === 0 ? (
                <div className="retro-none">{group.quiet}</div>
              ) : (
                hits.map((finding, i) => (
                  <button
                    key={`${finding.kind}-${finding.who ?? ''}-${i}`}
                    type="button"
                    className="retro-finding"
                    onClick={() => onEvidence(finding)}
                    title="Toon de taken waarop dit rust"
                  >
                    <span className={`retro-kind retro-kind-${finding.kind}`}>
                      {KIND_LABEL[finding.kind]}
                    </span>
                    <span className="retro-text">{finding.text}</span>
                    <span className="retro-evidence-cta">
                      {finding.evidenceTotal > finding.evidence.length
                        ? `rust op ${finding.evidenceTotal} taken, ${finding.evidence.length} ervan zijn hier op te zoeken →`
                        : `rust op ${finding.evidenceTotal} ${finding.evidenceTotal === 1 ? 'taak' : 'taken'} — bekijk ze →`}
                    </span>
                  </button>
                ))
              )}
              {/* De verdeling hoort bij de derde vraag: de bevinding zegt of
                  het scheef is, de lijst laat zien hoe scheef. */}
              {group.key === 'last' && (
                <div className="retro-roles">
                  <div className="retro-roles-note">
                    Verdeling van al het gemeten werk. Onder {RETRO_THRESHOLDS.minSample} taken
                    staat er geen percentage bij een rol: één escalatie op twee taken is geen
                    patroon van 50%.
                  </div>
                  {retro.roles.map((row) => (
                    <RoleLine key={row.who} row={row} considered={retro.considered} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
