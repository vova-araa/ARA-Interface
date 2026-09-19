import { useState } from 'react';
import { useAra } from '../store.ts';

/**
 * De artifact op claude.ai is een etalage, geen venster op je Mac.
 *
 * Een pagina die claude.ai host mag van de browser geen verbinding naar
 * buiten maken — fetch, SSE en WebSocket naar elke andere host worden
 * geblokkeerd, zonder foutmelding. Deze pagina kan de collector dus nooit
 * bereiken, ook niet via Tailscale. Het oude verbindingsscherm vroeg om een
 * adres dat nooit had kunnen werken; dat is precies het soort vraag dat een
 * gebruiker tien minuten kost en niets oplevert.
 *
 * Dus: de demo-wereld draait meteen, en één keer staat erbij waar de echte
 * staat. Niet als blokkerend scherm — de wereld is er al — maar als kaart die
 * je weglegt.
 */
export function ShowcaseNote(): JSX.Element | null {
  const demo = useAra((s) => s.demo);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('ara.showcase.seen') === '1';
    } catch {
      return false;
    }
  });
  if (import.meta.env.MODE !== 'showcase' || !demo || dismissed) return null;

  const close = (): void => {
    setDismissed(true);
    try {
      localStorage.setItem('ara.showcase.seen', '1');
    } catch {
      /* privévenster: dan zie je de kaart de volgende keer nog eens */
    }
  };

  return (
    <div className="showcase-note" role="note" aria-label="Over deze demo">
      <div className="showcase-card">
        <p className="showcase-lead">
          <b>Dit is de demo-wereld.</b> Alles wat je hier ziet is voorbeeld — geen sessie, cijfer
          of taak van jou.
        </p>
        <p className="showcase-body">
          Je echte ARA draait op je Mac. Op je telefoon: Tailscale-app aan, dan het adres uit{' '}
          <code>./scripts/expose.sh tailnet</code> openen en met de deelknop op je beginscherm
          zetten. Deze pagina kan je Mac niet bereiken — claude.ai staat een pagina geen
          verbinding naar buiten toe.
        </p>
        <button type="button" className="btn primary" onClick={close}>
          Begrepen, laat de demo zien
        </button>
      </div>
    </div>
  );
}
