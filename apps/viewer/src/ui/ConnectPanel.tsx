import { useEffect, useState } from 'react';
import { apiBase, getToken, setApiBase, setToken } from '../api.ts';
import { useAra } from '../store.ts';

/**
 * Waar draait de collector?
 *
 * Normaal hoeft niemand deze vraag te beantwoorden: de collector serveert de
 * viewer, dus staan ze op dezelfde herkomst en klopt een pad zonder host. Maar
 * de viewer kan ook los staan — als pagina in de Claude-app op de telefoon,
 * terwijl de collector op de Mac draait. Dan is er niets om aan te kloppen en
 * blijft de wereld leeg.
 *
 * Een lege wereld die niets zegt is het ergste antwoord: je weet niet of er
 * niets gebeurt of dat de verbinding weg is. Vandaar dit scherm — het verschijnt
 * alleen als er nog nooit verbinding was, en zegt wat het nodig heeft.
 *
 * Wie de wereld alleen wil zien zonder collector, kan naar de demo. Die is
 * nadrukkelijk als demo gelabeld: verzonnen cijfers tonen alsof ze echt zijn is
 * precies wat dit systeem nergens doet.
 */
export function ConnectPanel(): JSX.Element | null {
  const connected = useAra((s) => s.connected);
  const demo = useAra((s) => s.demo);
  const world = useAra((s) => s.world);
  const [dismissed, setDismissed] = useState(false);
  const [host, setHost] = useState(apiBase());
  const [token, setTokenValue] = useState(getToken());
  // Even geduld voordat we dit scherm tonen: bij het laden staat `connected`
  // nog op false en een paneel dat een halve seconde opflitst bij elke start
  // is een storing die er geen is.
  const [ripe, setRipe] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRipe(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Zodra er ooit verbinding was, is dit scherm klaar: daarna neemt de
  // reconnect-balk het over, want dán is het een onderbreking en geen setup.
  if (demo || connected || world !== null || dismissed || !ripe) return null;

  const save = (): void => {
    setApiBase(host);
    setToken(token);
    // Herladen is hier eerlijker dan live omschakelen: de SSE-stroom, de
    // wereld en het kantoor hangen allemaal aan het oude adres.
    location.reload();
  };

  return (
    <div className="connect-wrap" role="dialog" aria-label="Verbinding met de collector">
      <div className="connect-card">
        <h2>Geen collector gevonden</h2>
        <p className="connect-lead">
          Deze pagina staat los van je collector. Zeg waar hij draait, dan haalt hij de wereld
          daarvandaan.
        </p>

        <label className="connect-field">
          <span>Adres van de collector</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://mac.jouw-tailnet.ts.net"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>

        <label className="connect-field">
          <span>
            Token <em>(ARA_TOKEN, als je die hebt gezet)</em>
          </span>
          <input
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
          />
        </label>

        <div className="connect-actions">
          <button type="button" className="btn primary" onClick={save} disabled={!host.trim()}>
            Verbinden
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const url = new URL(location.href);
              url.searchParams.set('demo', '1');
              location.href = url.toString();
            }}
          >
            Demo bekijken
          </button>
        </div>

        <p className="connect-note">
          Het adres en het token blijven op dit toestel staan. Buiten je eigen netwerk heb je
          Tailscale op je telefoon nodig — draait die niet, dan is de Mac niet te bereiken en helpt
          een adres invullen niet.
        </p>
        <button type="button" className="connect-skip" onClick={() => setDismissed(true)}>
          Sluiten en toch leeg kijken
        </button>
      </div>
    </div>
  );
}
