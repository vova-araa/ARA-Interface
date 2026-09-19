import { useEffect } from 'react';
import { Scene } from './scene/Scene.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { ThreadPanel } from './ui/ThreadPanel.tsx';
import { DetailDrawer } from './ui/DetailDrawer.tsx';
import { NudgePulse, ReconnectBanner } from './ui/Banners.tsx';
import { Scrubber } from './ui/Scrubber.tsx';
import { Minimap } from './ui/Minimap.tsx';
import { BoardPanel } from './ui/BoardPanel.tsx';
import { ActionPanel } from './ui/ActionPanel.tsx';
import { OverviewPanel } from './ui/OverviewPanel.tsx';
import { Ticker } from './ui/Ticker.tsx';
import { SideTabs } from './ui/SideTabs.tsx';
import { SoundPlayer } from './ui/Sound.tsx';
import { ChatPanel } from './ui/ChatPanel.tsx';
import { ConnectPanel } from './ui/ConnectPanel.tsx';
import { ShowcaseNote } from './ui/ShowcaseNote.tsx';
import { PhonePanel } from './ui/PhonePanel.tsx';
import { OfficeOverlay } from './office/OfficeOverlay.tsx';
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
    // Diep-link: ?office=<project> opent dat kantoor meteen (handig op de
    // telefoon en om een kantoor te delen).
    const office = new URLSearchParams(location.search).get('office');
    if (office) useAra.getState().openOffice(office);
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
        else if (s.actionsOpen) s.setActionsOpen(false);
        else if (s.boardOpen) s.setBoardOpen(false);
        else if (s.selectedSessionId) s.select(null);
        (e.target as HTMLElement)?.blur?.();
        return;
      }
      if (typing) return;
      // Cmd/Ctrl+A/B/F/O zijn van de browser, niet van ons.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        s.setPanelOpen(true);
        setTimeout(() => document.querySelector<HTMLInputElement>('.panel .search')?.focus(), 50);
      } else if (e.key === 'f') s.toggleFollowLive();
      else if (e.key === 'b') s.setBoardOpen(!s.boardOpen);
      else if (e.key === 'a') s.setActionsOpen(!s.actionsOpen);
      else if (e.key === 'o') s.setOverviewOpen(!s.overviewOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Scene />
      <TopBar />
      <SideTabs />
      <ThreadPanel />
      <DetailDrawer />
      <Minimap />
      <BoardPanel />
      <ActionPanel />
      <OverviewPanel />
      <Ticker />
      <Scrubber />
      {/* Staat de viewer los van zijn collector (losse pagina op de telefoon),
          dan vraagt dit scherm één keer waar die draait. Zodra er verbinding
          is geweest neemt de reconnect-balk het over. */}
      <ConnectPanel />
      <ShowcaseNote />
      <PhonePanel />
      <ReconnectBanner />
      <NudgePulse />
      <SoundPlayer />
      <OfficeOverlay />
      {/* Overleg met de leiding zonder eerst een kantoor te zoeken. Brengt
          zijn eigen knop en sneltoets mee, en rendert niets boven een open
          kantoor — dat heeft zijn eigen chat. */}
      <ChatPanel />
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
