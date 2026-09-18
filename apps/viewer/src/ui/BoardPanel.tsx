import { useEffect, useState } from 'react';
import { QA_VERIFIER, QA_VERIFY_PREFIX, type Finding } from '@ara/shared';
import { createUserTask, loadTasks, type BoardTask } from '../api.ts';
import { useAra } from '../store.ts';
import { ageString } from '../util.ts';
import { openLeadershipChat, roleLabel } from './ChatPanel.tsx';
import { loadTaskById, RetroPanel } from './RetroPanel.tsx';

const STATUS_LABEL: Record<BoardTask['status'], string> = {
  open: '🟡 Open',
  claimed: '🔵 Wordt aan gewerkt',
  done: '🟢 Af',
  failed: '🔴 Mislukt',
};

function isEscalation(task: BoardTask): boolean {
  return (
    task.title.startsWith('ESCALATIE') ||
    task.result.startsWith('ESCALATE') ||
    (task.assignee === 'supervisor' && task.createdBy === 'manager:ops' && task.status === 'open')
  );
}

/**
 * Een controletaak: een tweede oordeel over andermans werk.
 *
 * Op het bord was dit een gewone regel die toevallig met "CONTROLE:" begon —
 * je zag niet dat het over een ándere taak ging, en dat is nu net het enige
 * wat een controle betekenis geeft. De twee kenmerken komen uit @ara/shared
 * (`shouldVerify`/`verificationTask` zetten ze), dus staan hier de constanten
 * en niet de letterlijke tekst: verandert het voorvoegsel daar, dan verandert
 * het hier mee.
 */
function isReview(task: BoardTask): boolean {
  return task.title.startsWith(QA_VERIFY_PREFIX) && task.assignee === QA_VERIFIER;
}

/**
 * Het bord met de terugblik erin openen, van buiten dit bestand.
 *
 * Zelfde truc als bij het overleg (zie ChatPanel): een gebeurtenis op window,
 * zodat het overzicht naar de terugblik kan wijzen zonder dat er een vlag bij
 * moet in de gedeelde store.
 */
const BOARD_VIEW_EVENT = 'ara:board-view';

export function openBoardRetro(): void {
  window.dispatchEvent(new CustomEvent(BOARD_VIEW_EVENT, { detail: { view: 'retro' } }));
}

type View = 'bord' | 'terugblik';

/**
 * Wat je nu bekijkt als je een bevinding hebt aangetikt.
 *
 * `items` komt uit de terugblik zelf (id + titel, gemeten), `resolved` is de
 * volledige taak zoals het bord hem kent. Die twee staan los van elkaar omdat
 * een taak uit het bewijs ouder kan zijn dan de laatste 100 regels op het bord
 * — of inmiddels weg. Dan tonen we wat we wél hebben en zeggen we dat erbij.
 */
interface EvidenceView {
  heading: string;
  note?: string;
  back: View;
  items: { id: string; title: string }[];
}

/** Takenbord: live overzicht, nieuwe taak (tap-to-prompt) en de terugblik. */
export function BoardPanel(): JSX.Element | null {
  const boardOpen = useAra((s) => s.boardOpen);
  const setBoardOpen = useAra((s) => s.setBoardOpen);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const demo = useAra((s) => s.demo);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [sent, setSent] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [view, setView] = useState<View>('bord');
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  // id → taak, of null als hij niet meer op te halen was.
  const [resolved, setResolved] = useState<Record<string, BoardTask | null>>({});

  useEffect(() => {
    if (!boardOpen || demo) return;
    const refresh = (): void => void loadTasks().then(setTasks);
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [boardOpen, demo, tasksVersion]);

  // Staat bewust vóór de vroege return: het bord moet ook naar de terugblik
  // kunnen springen terwijl het paneel nog dicht is (het overzicht opent beide
  // in één tik).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ view: string }>).detail;
      if (detail.view === 'retro') {
        setEvidence(null);
        setView('terugblik');
      }
    };
    window.addEventListener(BOARD_VIEW_EVENT, handler);
    return () => window.removeEventListener(BOARD_VIEW_EVENT, handler);
  }, []);

  if (!boardOpen) return null;

  const escalations = tasks.filter(isEscalation).filter((t) => t.status !== 'done');
  const active = tasks.filter((t) => (t.status === 'open' || t.status === 'claimed') && !isEscalation(t));
  const finished = tasks.filter((t) => t.status === 'done' || t.status === 'failed').slice(0, 12);
  const reviewsOpen = tasks.filter((t) => isReview(t) && t.status !== 'done').length;

  /**
   * De taken achter een bevinding erbij zoeken. Wat het bord al geladen heeft
   * gebruiken we direct; de rest halen we op id op. Een bevinding waarvan je
   * het bewijs niet kunt openen is een mening, en dat is precies het verschil
   * dat dit scherm moet laten zien.
   */
  const resolve = (items: { id: string }[]): void => {
    const known = new Map(tasks.map((t) => [t.id, t]));
    const hit: Record<string, BoardTask | null> = {};
    for (const item of items) {
      const found = known.get(item.id);
      if (found) hit[item.id] = found;
    }
    setResolved(hit);
    for (const item of items) {
      if (hit[item.id]) continue;
      void loadTaskById(item.id).then((task) =>
        setResolved((prev) => ({ ...prev, [item.id]: task })),
      );
    }
  };

  const showFinding = (finding: Finding): void => {
    const missing = finding.evidenceTotal - finding.evidence.length;
    setEvidence({
      heading: finding.text,
      note:
        missing > 0
          ? `${finding.evidence.length} van ${finding.evidenceTotal} taken — de terugblik draagt er hoogstens ${finding.evidence.length} mee.`
          : undefined,
      back: 'terugblik',
      items: finding.evidence,
    });
    resolve(finding.evidence);
    setView('bord');
  };

  const showParent = (task: BoardTask): void => {
    if (!task.parentId) return;
    const items = [{ id: task.parentId, title: '' }];
    setEvidence({
      heading: `Het werk dat "${task.title.slice(QA_VERIFY_PREFIX.length).trim()}" beoordeelt`,
      back: 'bord',
      items,
    });
    resolve(items);
  };

  const submit = async (): Promise<void> => {
    if (!title.trim()) return;
    const ok = await createUserTask(title.trim(), project.trim());
    setSent(ok ? 'ok' : 'fail');
    if (ok) {
      setTitle('');
      setProject('');
      setTasks(await loadTasks());
      setTimeout(() => setSent('idle'), 4000);
    }
  };

  const row = (task: BoardTask): JSX.Element => (
    <div
      key={task.id}
      className={`board-row ${isEscalation(task) ? 'board-escalation' : ''} ${isReview(task) ? 'board-review' : ''}`}
    >
      <div className="board-row-top">
        <span className="board-title">
          {isReview(task) ? (
            <>
              <span className="board-review-chip">controle</span>
              {task.title.slice(QA_VERIFY_PREFIX.length).trim()}
            </>
          ) : (
            task.title
          )}
        </span>
        <span className="board-meta" title={new Date(task.updatedAt).toLocaleString('nl-NL')}>
          {ageString(task.updatedAt)} geleden
        </span>
      </div>
      {/* Stond hier als agent-id: "ara-fleet-cost · blex". Wie dat niet uit zijn
          hoofd kent leest een sleutel in plaats van een naam. */}
      <div className="board-sub">
        {STATUS_LABEL[task.status]} · bij <b>{roleLabel(task.assignee)}</b>
        {task.project ? ` · ${task.project}` : ''}
      </div>
      {isReview(task) && (
        <div className="board-review-note">
          Tweede oordeel over andermans werk — niet het werk zelf.
          {task.parentId && (
            <button type="button" className="board-link" onClick={() => showParent(task)}>
              toon de beoordeelde taak
            </button>
          )}
        </div>
      )}
      {task.result && <div className="board-result">{task.result.slice(0, 160)}</div>}
    </div>
  );

  /** Een taak uit het bewijs die niet (meer) op te halen was. */
  const stub = (item: { id: string; title: string }): JSX.Element => (
    <div key={item.id} className="board-row board-row-stub">
      <div className="board-row-top">
        <span className="board-title">{item.title || item.id}</span>
      </div>
      <div className="board-sub">
        Staat niet meer op het bord — alleen id en titel zijn bekend, uit de terugblik zelf.
      </div>
      <div className="board-result">{item.id}</div>
    </div>
  );

  return (
    <div className="board">
      <div className="board-header">
        <b>Takenbord</b>
        <span className="board-head-sub">
          {escalations.length > 0 ? `${escalations.length} wacht op jou · ` : ''}
          {active.length} in behandeling
          {reviewsOpen > 0 ? ` · ${reviewsOpen} controle` : ''}
        </span>
        <button className="btn" onClick={() => setBoardOpen(false)} aria-label="Takenbord sluiten">
          ✕
        </button>
      </div>

      {/* Twee weergaven van hetzelfde bord: wat er nu op staat, en wat het
          spoor erachter zegt. Bewust geen zesde tab in de strook — op 390px is
          die strook al vol, en de terugblik gáát over dit bord: het bewijs bij
          een bevinding is een regel hier, geen nieuw scherm. */}
      <div className="board-views" role="tablist" aria-label="Weergave">
        {(['bord', 'terugblik'] as View[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            // Bewijs hoort bij de weergave waar je vandaan kwam: sta je in de
            // taken achter een bevinding, dan blijft "Terugblik" aan. Anders
            // lijkt het bord actief terwijl je naar iets anders kijkt.
            aria-selected={(evidence?.back ?? view) === key}
            className={`board-view ${(evidence?.back ?? view) === key ? 'board-view-on' : ''}`}
            onClick={() => {
              setEvidence(null);
              setView(key);
            }}
          >
            {key === 'bord' ? 'Bord' : 'Terugblik'}
          </button>
        ))}
      </div>

      {view === 'terugblik' && !evidence ? (
        <div className="board-list">
          <RetroPanel onEvidence={showFinding} />
        </div>
      ) : evidence ? (
        <div className="board-list">
          <div className="board-evidence">
            <button
              type="button"
              className="board-link"
              onClick={() => {
                setEvidence(null);
                setView(evidence.back);
              }}
            >
              ← terug naar {evidence.back === 'terugblik' ? 'de terugblik' : 'het bord'}
            </button>
            <div className="board-evidence-head">{evidence.heading}</div>
            {evidence.note && <div className="board-evidence-note">{evidence.note}</div>}
          </div>
          {evidence.items.map((item) => {
            const found = resolved[item.id];
            if (found) return row(found);
            // undefined = nog onderweg, null = niet gevonden.
            if (found === null) return stub(item);
            return (
              <div key={item.id} className="board-row board-row-stub">
                <div className="board-sub">{item.title || item.id} — ophalen…</div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="board-form">
            <input
              className="search"
              placeholder="Nieuwe taak voor de supervisor…"
              aria-label="Nieuwe taak voor de supervisor"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
            <div className="board-form-row">
              <input
                className="search board-project"
                placeholder="project (optioneel)"
                aria-label="Project (optioneel)"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
              <button className="btn btn-active" onClick={() => void submit()}>Plaats</button>
            </div>
            {/* Waar dit heen gaat, vóór je het plaatst — en waar je heen moet als je
                liever eerst iets wilt vrágen dan iets wilt opdragen. */}
            <div className="board-form-note">
              Komt op het bord bij de <b>supervisor</b>, die het over de managers verdeelt.{' '}
              <button type="button" className="board-link" onClick={() => openLeadershipChat('supervisor')}>
                Liever eerst overleggen?
              </button>
            </div>
            {sent === 'ok' && <div className="board-sent">✓ Geplaatst — supervisor pakt dit binnen ±5 min op.</div>}
            {sent === 'fail' && <div className="board-sent stat-urgent">✗ Plaatsen mislukt — collector bereikbaar?</div>}
          </div>

          <div className="board-list">
            {escalations.length > 0 && (
              <>
                <div className="board-section stat-urgent">⚠ Wacht op jou — een agent weigerde</div>
                {escalations.map(row)}
              </>
            )}
            <div className="board-section">Open en in behandeling</div>
            {active.length === 0 && (
              <div className="empty">
                <div className="empty-title">Geen open taken</div>
                <div className="empty-hint">
                  Alles wat binnenkwam is afgerond. Nieuw werk zet je hierboven op het bord.
                </div>
              </div>
            )}
            {active.map(row)}
            {finished.length > 0 && <div className="board-section">Afgerond (laatste {finished.length})</div>}
            {finished.map(row)}
          </div>
        </>
      )}
    </div>
  );
}
