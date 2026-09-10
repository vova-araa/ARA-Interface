import { useEffect } from 'react';
import { Scene } from './scene/Scene.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { ThreadPanel } from './ui/ThreadPanel.tsx';
import { DetailDrawer } from './ui/DetailDrawer.tsx';
import { NudgePulse, ReconnectBanner } from './ui/Banners.tsx';
import { Scrubber } from './ui/Scrubber.tsx';
import { Minimap } from './ui/Minimap.tsx';
import { BoardPanel } from './ui/BoardPanel.tsx';
import { OverviewPanel } from './ui/OverviewPanel.tsx';
import { Ticker } from './ui/Ticker.tsx';
import { SoundPlayer } from './ui/Sound.tsx';
import { useAra } from './store.ts';
import { connectLive } from './api.ts';
import { runDemo } from './demo.ts';

// React 18 StrictMode mount z'n effects dubbel in dev; zonder guard draaien er
// dan twee demo-loops / SSE-verbindingen naast elkaar (dubbele ticker-regels).
let wired = false;

export function App(): JSX.Element {
  const demo = useAra((s) => s.demo);
  const panelOpen = useAra((s) => s.panelOpen);
  const setPanelOpen = useAra((s) => s.setPanelOpen);

  useEffect(() => {
    if (wired) return;
    wired = true;
    if (demo) void runDemo();
    else connectLive();
    // Wiring is app-lifetime; never torn down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sneltoetsen (desktop): / zoeken · f follow · b bord · o overzicht · Esc sluiten
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      const s = useAra.getState();
      if (e.key === 'Escape') {
        if (s.overviewOpen) s.setOverviewOpen(false);
        else if (s.boardOpen) s.setBoardOpen(false);
        else if (s.selectedSessionId) s.select(null);
        (e.target as HTMLElement)?.blur?.();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        s.setPanelOpen(true);
        setTimeout(() => document.querySelector<HTMLInputElement>('.panel .search')?.focus(), 50);
      } else if (e.key === 'f') s.toggleFollowLive();
      else if (e.key === 'b') s.setBoardOpen(!s.boardOpen);
      else if (e.key === 'o') s.setOverviewOpen(!s.overviewOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Scene />
      <TopBar />
      <ThreadPanel />
      <DetailDrawer />
      <Minimap />
      <BoardPanel />
      <OverviewPanel />
      <Ticker />
      <Scrubber />
      <ReconnectBanner />
      <NudgePulse />
      <SoundPlayer />
      {/* Mobiel: veeg omhoog vanaf de onderrand om de threadlijst te openen */}
      {!panelOpen && (
        <div
          className="sheet-opener"
          onClick={() => setPanelOpen(true)}
          onTouchStart={(e) => {
            const startY = e.touches[0]?.clientY ?? 0;
            const onMove = (move: TouchEvent): void => {
              const y = move.touches[0]?.clientY ?? startY;
              if (startY - y > 30) {
                setPanelOpen(true);
                window.removeEventListener('touchmove', onMove);
              }
            };
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend', () => window.removeEventListener('touchmove', onMove), { once: true });
          }}
        >
          <span className="grip-bar" />
        </div>
      )}
    </div>
  );
}
