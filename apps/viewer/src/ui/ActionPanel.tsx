import { useCallback, useEffect, useState } from 'react';
import { useAra } from '../store.ts';
import { withToken } from '../api.ts';
import { ageString } from '../util.ts';

/**
 * De actielijst: alles wat op jou wacht, met de knop erbij.
 *
 * Het paneel weet niets over welk endpoint bij welk soort werk hoort — dat
 * staat in de actie zelf, meegegeven door de collector. Zo kan er een nieuw
 * soort actie bijkomen zonder dat hier iets verandert.
 */

interface ActionButton {
  label: string;
  method: 'POST' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
  confirm?: boolean;
}

interface Action {
  id: string;
  kind: 'trade-approval' | 'needs-human' | 'escalation' | 'incident' | 'data-source' | 'config' | 'source-alert';
  urgency: 'blocking' | 'soon' | 'whenever';
  title: string;
  detail: string;
  project?: string;
  venture?: string;
  createdAt: number;
  buttons: ActionButton[];
}

const KIND_LABEL: Record<Action['kind'], string> = {
  'trade-approval': '💶 Handel',
  'needs-human': '🙋 Sessie',
  escalation: '⬆️ Escalatie',
  incident: '🔧 Storing',
  'data-source': '🔌 Databron',
  config: '⚙️ Instelling',
  'source-alert': '📋 Uit de bronnen',
};

/**
 * Kopjes boven de groepen. Alles stond in één lijst op volgorde van de
 * collector: een databron die ooit eens aangesloten moet worden zag er precies
 * zo dringend uit als een handel die op akkoord wacht.
 */
const URGENCY_SECTION: Record<Action['urgency'], { title: string; hint: string }> = {
  blocking: { title: 'Nu — hier loopt iets op vast', hint: 'zonder jou gebeurt er niets' },
  soon: { title: 'Binnenkort', hint: 'geen spoed, wel aandacht' },
  whenever: { title: 'Wanneer het uitkomt', hint: 'losse eindjes, geen haast' },
};

// Zelfde adres en zelfde token als de rest van de viewer (`withToken`): een
// eigen lezing van `?token=` uit de URL zag het opgeslagen token niet en
// gaf "actielijst niet bereikbaar" zodra je zonder ?token= binnenkwam.
async function call(button: ActionButton): Promise<boolean> {
  const res = await fetch(withToken(button.path), {
    method: button.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(button.body ?? {}),
  });
  return res.ok;
}

export function ActionPanel(): JSX.Element | null {
  const open = useAra((s) => s.actionsOpen);
  const setOpen = useAra((s) => s.setActionsOpen);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const tradeVersion = useAra((s) => s.tradeVersion);
  const demo = useAra((s) => s.demo);
  const [actions, setActions] = useState<Action[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (demo) {
      setActions([]);
      return;
    }
    try {
      const res = await fetch(withToken('/actions'));
      if (!res.ok) throw new Error(String(res.status));
      setActions(((await res.json()) as { actions: Action[] }).actions);
      setError('');
    } catch {
      setError('actielijst niet bereikbaar');
    }
  }, [demo]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh, tasksVersion, tradeVersion]);

  if (!open) return null;

  const run = async (action: Action, button: ActionButton): Promise<void> => {
    // Geld en onomkeerbare dingen krijgen altijd een tussenstap, ook als de
    // knop klein is en je op je telefoon staat.
    if (button.confirm && !window.confirm(`${button.label}: ${action.title}\n\nZeker weten?`)) return;
    setBusy(action.id);
    const ok = await call(button);
    setBusy(null);
    if (!ok) {
      setError(`"${button.label}" is niet gelukt — de stand kan intussen veranderd zijn`);
    }
    await refresh();
  };

  const blocking = actions.filter((a) => a.urgency === 'blocking').length;
  const order: Action['urgency'][] = ['blocking', 'soon', 'whenever'];
  const grouped = order
    .map((urgency) => ({ urgency, items: actions.filter((a) => a.urgency === urgency) }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="actions">
      <div className="actions-head">
        <strong>
          Wacht op jou {blocking > 0 && <span className="actions-badge">{blocking} nu</span>}
        </strong>
        <button type="button" className="btn" onClick={() => setOpen(false)} aria-label="Acties sluiten">
          ✕
        </button>
      </div>

      {error && <p className="actions-error">{error}</p>}

      <div className="actions-list">
        {actions.length === 0 && (
          <p className="actions-empty">
            {demo
              ? 'Demo-modus: dit paneel toont alleen echte acties, en die zijn er hier niet.'
              : 'Niets dat op jou wacht. Geen akkoorden, geen escalaties, geen storingen.'}
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.urgency} className="actions-group">
            <div className="actions-section">
              {URGENCY_SECTION[group.urgency].title}
              <em>{URGENCY_SECTION[group.urgency].hint}</em>
            </div>
            {group.items.map((action) => (
              <div key={action.id} className={`action action-${action.urgency}`}>
                <div className="action-top">
                  <span className="action-kind">{KIND_LABEL[action.kind]}</span>
                  {action.project && <span className="action-project">{action.project}</span>}
                  {action.createdAt > 0 && (
                    <span
                      className="action-age"
                      title={`Staat hier sinds ${new Date(action.createdAt).toLocaleString('nl-NL')}`}
                    >
                      {ageString(action.createdAt)} geleden
                    </span>
                  )}
                </div>
                <div className="action-title">{action.title}</div>
                <div className="action-detail">{action.detail}</div>
                {action.buttons.length > 0 && (
                  <div className="action-buttons">
                    {action.buttons.map((button) => (
                      <button
                        key={button.label}
                        type="button"
                        className={`btn ${button.confirm ? 'btn-strong' : ''}`}
                        disabled={busy === action.id}
                        title={button.confirm ? 'Vraagt eerst om bevestiging' : undefined}
                        onClick={() => void run(action, button)}
                      >
                        {busy === action.id ? '…' : button.label}
                      </button>
                    ))}
                  </div>
                )}
                {action.buttons.length === 0 && (
                  <div className="action-nobtn">Niets om hier te klikken — dit vraagt om een wijziging buiten ARA.</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
