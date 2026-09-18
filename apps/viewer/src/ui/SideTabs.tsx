import { useAra, useViewSnapshot } from '../store.ts';

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
  const snapshot = useViewSnapshot();

  if (!panelOpen && !boardOpen && !actionsOpen && !overviewOpen) return null;

  const live = Object.values(snapshot.sessions).filter((s) => !s.endedAt).length;
  const waiting = snapshot.counters.needsHuman;

  const tabs: { key: string; label: string; on: boolean; set: (v: boolean) => void; badge?: number; urgent?: boolean }[] = [
    { key: 'threads', label: 'Sessies', on: panelOpen, set: setPanelOpen, badge: live },
    { key: 'board', label: 'Bord', on: boardOpen, set: setBoardOpen },
    { key: 'actions', label: 'Acties', on: actionsOpen, set: setActionsOpen, badge: waiting, urgent: waiting > 0 },
    { key: 'overview', label: 'Overzicht', on: overviewOpen, set: setOverviewOpen },
  ];

  return (
    <div className="sidetabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`sidetab ${tab.on ? 'sidetab-on' : ''} ${tab.urgent ? 'sidetab-urgent' : ''}`}
          onClick={() => tab.set(true)}
        >
          {tab.label}
          {tab.badge ? <span className="sidetab-badge">{tab.badge}</span> : null}
        </button>
      ))}
      <button
        type="button"
        className="sidetab sidetab-close"
        title="Sluiten (Esc)"
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
