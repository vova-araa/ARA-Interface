import { useAra } from '../store.ts';

/** Live event-ticker linksonder: de laatste betekenisvolle gebeurtenissen. */
export function Ticker(): JSX.Element | null {
  const ticker = useAra((s) => s.ticker);
  const drawerOpen = useAra((s) => s.selectedSessionId !== null);
  if (ticker.length === 0 || drawerOpen) return null;
  return (
    <div className="ticker">
      {ticker.map((item) => (
        <div key={item.id} className={`ticker-row ${item.error ? 'ticker-error' : ''}`}>
          {item.text}
        </div>
      ))}
    </div>
  );
}
