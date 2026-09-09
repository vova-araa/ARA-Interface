import { useEffect } from 'react';
import { Scene } from './scene/Scene.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { ThreadPanel } from './ui/ThreadPanel.tsx';
import { DetailDrawer } from './ui/DetailDrawer.tsx';
import { NudgePulse, ReconnectBanner } from './ui/Banners.tsx';
import { Scrubber } from './ui/Scrubber.tsx';
import { Minimap } from './ui/Minimap.tsx';
import { useAra } from './store.ts';
import { connectLive } from './api.ts';
import { runDemo } from './demo.ts';

export function App(): JSX.Element {
  const demo = useAra((s) => s.demo);

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
      <Scrubber />
      <ReconnectBanner />
      <NudgePulse />
    </div>
  );
}
