import { useEffect, useState } from 'react';
import { loadUsage, type UsageRow } from '../api.ts';
import { useAra } from '../store.ts';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Klein token-overzicht (vandaag, per project). Cache-reads staan apart:
 * die zijn ~10× goedkoper en horen niet bij het "echte" verbruik opgeteld.
 */
export function UsageTable(): JSX.Element | null {
  const demo = useAra((s) => s.demo);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (demo) return;
    const refresh = (): void => void loadUsage().then(setRows);
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [demo]);

  if (demo || rows.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);

  return (
    <div className="usage">
      <button className="usage-toggle" onClick={() => setOpen(!open)}>
        ⚡ {fmt(total)} tokens vandaag {open ? '▾' : '▸'}
      </button>
      {open && (
        <table className="usage-table">
          <thead>
            <tr>
              <th>project</th>
              <th>in</th>
              <th>uit</th>
              <th>cache</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((row) => (
              <tr key={row.project}>
                <td>{row.project}</td>
                <td>{fmt(row.inputTokens)}</td>
                <td>{fmt(row.outputTokens)}</td>
                <td>{fmt(row.cacheReadTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
