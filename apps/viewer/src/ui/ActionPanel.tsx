import { useCallback, useEffect, useState } from 'react';
import { useAra } from '../store.ts';
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
  kind: 'trade-approval' | 'needs-human' | 'escalation' | 'incident' | 'data-source' | 'config';
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
};

const URGENCY_LABEL: Record<Action['urgency'], string> = {
  blocking: 'Nu',
  soon: 'Binnenkort',
  whenever: 'Wanneer het uitkomt',
};

function token(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

async function call(button: ActionButton): Promise<boolean> {
  const t = token();
  const res = await fetch(`${button.path}${t ? `?token=${encodeURIComponent(t)}` : ''}`, {
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
      const t = token();
      const res = await fetch(`/actions${t ? `?token=${encodeURIComponent(t)}` : ''}`);
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

  return (
    <aside className="actions">
      <div className="actions-head">
        <strong>
          Acties {blocking > 0 && <span className="actions-badge">{blocking}</span>}
        </strong>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          sluiten
        </button>
      </div>

      {error && <p className="actions-error">{error}</p>}

      <div className="actions-list">
        {actions.length === 0 && (
          <p className="actions-empty">
            {demo ? 'Demo-modus: geen echte acties.' : 'Niets dat op jou wacht.'}
          </p>
        )}
        {actions.map((action) => (
          <div key={action.id} className={`action action-${action.urgency}`}>
            <div className="action-top">
              <span className="action-kind">{KIND_LABEL[action.kind]}</span>
              <span className="action-urgency">{URGENCY_LABEL[action.urgency]}</span>
              {action.createdAt > 0 && (
                <span className="action-age">{ageString(action.createdAt)}</span>
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
                    onClick={() => void run(action, button)}
                  >
                    {busy === action.id ? '…' : button.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
