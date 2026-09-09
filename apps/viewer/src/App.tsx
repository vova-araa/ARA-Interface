import { useEffect } from 'react';
import { Scene } from './scene/Scene.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { ThreadPanel } from './ui/ThreadPanel.tsx';
import { DetailDrawer } from './ui/DetailDrawer.tsx';
import { NudgePulse, ReconnectBanner } from './ui/Banners.tsx';
import { Scrubber } from './ui/Scrubber.tsx';
import { Minimap } from './ui/Minimap.tsx';
import { BoardPanel } from './ui/BoardPanel.tsx';
import { useAra } from './store.ts';
import { connectLive } from './api.ts';
import { runDemo } from './demo.ts';

export function App(): JSX.Element {
  const demo = useAra((s) => s.demo);
  const panelOpen = useAra((s) => s.panelOpen);
  const setPanelOpen = useAra((s) => s.setPanelOpen);

  useEffect(() => {
    if (demo) void runDemo();
    else connectLive();
    // Wiring is app-lifetime; never torn down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <Scene />
      <TopBar />
      <ThreadPanel />
      <DetailDrawer />
      <Minimap />
      <BoardPanel />
      <Scrubber />
      <ReconnectBanner />
      <NudgePulse />
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
