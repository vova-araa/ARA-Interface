import { useEffect, useState } from 'react';
import { createUserTask, loadTasks, type BoardTask } from '../api.ts';
import { useAra } from '../store.ts';
import { ageString } from '../util.ts';

const STATUS_LABEL: Record<BoardTask['status'], string> = {
  open: '🟡 Open',
  claimed: '🔵 Bezig',
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

/** Takenbord: live overzicht + nieuwe taak vanaf telefoon/laptop (tap-to-prompt). */
export function BoardPanel(): JSX.Element | null {
  const boardOpen = useAra((s) => s.boardOpen);
  const setBoardOpen = useAra((s) => s.setBoardOpen);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const demo = useAra((s) => s.demo);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [sent, setSent] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (!boardOpen || demo) return;
    const refresh = (): void => void loadTasks().then(setTasks);
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [boardOpen, demo, tasksVersion]);

  if (!boardOpen) return null;

  const escalations = tasks.filter(isEscalation).filter((t) => t.status !== 'done');
  const active = tasks.filter((t) => (t.status === 'open' || t.status === 'claimed') && !isEscalation(t));
  const finished = tasks.filter((t) => t.status === 'done' || t.status === 'failed').slice(0, 12);

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
    <div key={task.id} className={`board-row ${isEscalation(task) ? 'board-escalation' : ''}`}>
      <div className="board-row-top">
        <span className="board-title">{task.title}</span>
        <span className="board-meta">{ageString(task.updatedAt)}</span>
      </div>
      <div className="board-sub">
        {STATUS_LABEL[task.status]} · {task.assignee || '—'}
        {task.project ? ` · ${task.project}` : ''}
        {task.result ? ` — ${task.result.slice(0, 80)}` : ''}
      </div>
    </div>
  );

  return (
    <div className="board">
      <div className="board-header">
        <b>Takenbord</b>
        <button className="btn" onClick={() => setBoardOpen(false)}>✕</button>
      </div>

      <div className="board-form">
        <input
          className="search"
          placeholder="Nieuwe taak voor de supervisor…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <div className="board-form-row">
          <input
            className="search board-project"
            placeholder="project (optioneel)"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
          <button className="btn btn-active" onClick={() => void submit()}>Plaats</button>
        </div>
        {sent === 'ok' && <div className="board-sent">✓ Geplaatst — supervisor pakt dit binnen ±5 min op.</div>}
        {sent === 'fail' && <div className="board-sent stat-urgent">✗ Plaatsen mislukt — collector bereikbaar?</div>}
      </div>

      <div className="board-list">
        {escalations.length > 0 && (
          <>
            <div className="board-section stat-urgent">⚠ Escalaties</div>
            {escalations.map(row)}
          </>
        )}
        <div className="board-section">Actief</div>
        {active.length === 0 && <div className="empty">Geen open taken.</div>}
        {active.map(row)}
        <div className="board-section">Afgerond</div>
        {finished.map(row)}
      </div>
    </div>
  );
}
