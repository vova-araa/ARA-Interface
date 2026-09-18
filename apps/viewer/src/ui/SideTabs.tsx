import { useEffect, useState } from 'react';
import { loadTasks } from '../api.ts';
import { useAra, useViewSnapshot } from '../store.ts';

interface Tab {
  key: string;
  label: string;
  hint: string;
  on: boolean;
  set: (v: boolean) => void;
  badge?: number;
  urgent?: boolean;
}

/**
 * De tabstrook boven de rechterkolom.
 *
 * De vier panelen (sessies, bord, acties, overzicht) deelden die kolom al,
 * maar konden alle vier tegelijk open staan en hadden elk hun eigen knop
 * ergens in de balk. Dan is wisselen: sluiten, zoeken, openen. Nu staat de
 * keuze boven het paneel waar hij hoort, en toont elke tab meteen of er iets
 * op je wacht — een tab zonder teller dwingt je erheen te klikken om te zien
 * dat er niets is.
 *
 * Hij verschijnt alleen als er iets open staat: is alles dicht, dan is de
 * wereld het scherm.
 */
export function SideTabs(): JSX.Element | null {
  const panelOpen = useAra((s) => s.panelOpen);
  const boardOpen = useAra((s) => s.boardOpen);
  const actionsOpen = useAra((s) => s.actionsOpen);
  const overviewOpen = useAra((s) => s.overviewOpen);
  const setPanelOpen = useAra((s) => s.setPanelOpen);
  const setBoardOpen = useAra((s) => s.setBoardOpen);
  const setActionsOpen = useAra((s) => s.setActionsOpen);
  const setOverviewOpen = useAra((s) => s.setOverviewOpen);
  const tasksVersion = useAra((s) => s.tasksVersion);
  const demo = useAra((s) => s.demo);
  const snapshot = useViewSnapshot();
  const [openTasks, setOpenTasks] = useState(0);

  const anyOpen = panelOpen || boardOpen || actionsOpen || overviewOpen;

  // Het bord was de enige tab zonder teller, en dat is precies de tab waarvan
  // je wilt weten of er iets op staat zonder ernaartoe te klikken. Alleen
  // ophalen zolang de strook zichtbaar is; de lijst zelf haalt BoardPanel op.
  useEffect(() => {
    if (!anyOpen || demo) return;
    let alive = true;
    const refresh = (): void =>
      void loadTasks().then((tasks) => {
        if (alive) setOpenTasks(tasks.filter((t) => t.status === 'open' || t.status === 'claimed').length);
      });
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [anyOpen, demo, tasksVersion]);

  if (!anyOpen) return null;

  const live = Object.values(snapshot.sessions).filter((s) => !s.endedAt).length;
  const waiting = snapshot.counters.needsHuman;

  const tabs: Tab[] = [
    { key: 'threads', label: 'Sessies', hint: 'Sessies (/)', on: panelOpen, set: setPanelOpen, badge: live },
    { key: 'board', label: 'Bord', hint: 'Takenbord (b)', on: boardOpen, set: setBoardOpen, badge: openTasks },
    {
      key: 'actions',
      label: 'Acties',
      hint: 'Wat op jou wacht (a)',
      on: actionsOpen,
      set: setActionsOpen,
      badge: waiting,
      urgent: waiting > 0,
    },
    { key: 'overview', label: 'Overzicht', hint: 'Overzicht per tak (o)', on: overviewOpen, set: setOverviewOpen },
  ];

  return (
    <div className="sidetabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.on}
          title={tab.hint}
          className={`sidetab ${tab.on ? 'sidetab-on' : ''} ${tab.urgent ? 'sidetab-urgent' : ''}`}
          onClick={() => tab.set(true)}
        >
          <span className="sidetab-label">{tab.label}</span>
          {tab.badge ? <span className="sidetab-badge">{tab.badge}</span> : null}
        </button>
      ))}
      <button
        type="button"
        className="sidetab sidetab-close"
        title="Sluiten (Esc)"
        aria-label="Paneel sluiten"
        onClick={() => {
          setPanelOpen(false);
          setBoardOpen(false);
          setActionsOpen(false);
          setOverviewOpen(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}
