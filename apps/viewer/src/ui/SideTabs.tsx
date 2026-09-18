import { useEffect, useState } from 'react';
import { loadTasks } from '../api.ts';
import { useAra, useViewSnapshot } from '../store.ts';
import {
  closeLeadershipChat,
  isLeadershipChatOpen,
  onLeadershipChatState,
  openLeadershipChat,
} from './ChatPanel.tsx';

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
  const [waitingChats, setWaitingChats] = useState(0);
  // Het overleg heeft geen plek in de gedeelde store (het paneel regelt zijn
  // eigen stand), dus luistert de strook mee. Zonder dit zou de tab die je net
  // indrukte meteen weer inactief lijken.
  const [chatOpen, setChatOpen] = useState(isLeadershipChatOpen);
  useEffect(() => onLeadershipChatState(setChatOpen), []);

  const anyOpen = panelOpen || boardOpen || actionsOpen || overviewOpen || chatOpen;

  // Het bord was de enige tab zonder teller, en dat is precies de tab waarvan
  // je wilt weten of er iets op staat zonder ernaartoe te klikken. Alleen
  // ophalen zolang de strook zichtbaar is; de lijst zelf haalt BoardPanel op.
  useEffect(() => {
    if (!anyOpen || demo) return;
    let alive = true;
    const refresh = (): void =>
      void loadTasks().then((tasks) => {
        if (!alive) return;
        setOpenTasks(tasks.filter((t) => t.status === 'open' || t.status === 'claimed').length);
        // Vragen van jou aan de leiding waar nog niemand op antwoordde: dat is
        // het enige getal dat de Overleg-tab hoort te dragen.
        setWaitingChats(
          tasks.filter(
            (t) =>
              t.title.startsWith('CHAT:') &&
              t.createdBy === 'user' &&
              (t.status === 'open' || t.status === 'claimed'),
          ).length,
        );
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
    {
      key: 'threads',
      label: 'Sessies',
      hint: `Sessies — ${live} draaien er nu (toets /)`,
      on: panelOpen,
      set: setPanelOpen,
      badge: live,
    },
    {
      key: 'board',
      label: 'Bord',
      // De terugblik is een weergave ván het bord en heeft daarom geen eigen
      // tab (vijf plus een kruisje is op 390px al vol). Dan moet de hint wel
      // zeggen dat hij daar zit, anders vindt niemand hem.
      hint: `Takenbord — ${openTasks} taken open of in behandeling; met de terugblik op het werkspoor (toets b)`,
      on: boardOpen,
      set: setBoardOpen,
      badge: openTasks,
    },
    {
      key: 'actions',
      label: 'Acties',
      hint: 'Alles wat op jou wacht (toets a)',
      on: actionsOpen,
      set: setActionsOpen,
      badge: waiting,
      urgent: waiting > 0,
    },
    {
      key: 'overview',
      label: 'Overzicht',
      hint: 'Overzicht per tak (toets o)',
      on: overviewOpen,
      set: setOverviewOpen,
    },
    // Vijfde tab, en dat is geen sier: de leiding was alleen te vinden achter
    // een rondje met een emoji rechtsonder. Nu staat "Overleg" naast de andere
    // panelen, met het aantal onbeantwoorde vragen erop.
    {
      key: 'chat',
      label: 'Overleg',
      hint: 'Praat met de chief, de supervisor of een manager (toets c)',
      on: chatOpen,
      set: (v) => {
        if (v) openLeadershipChat();
      },
      badge: waitingChats,
      urgent: waitingChats > 0,
    },
  ];

  return (
    <div className={`sidetabs ${chatOpen ? 'sidetabs-chat' : ''}`} role="tablist">
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
          // Het overleg hoort bij dezelfde familie: één kruisje ruimt de hele
          // rechterkolom op, anders blijft er één paneel achter.
          closeLeadershipChat();
        }}
      >
        ✕
      </button>
    </div>
  );
}
