import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { getToken, withToken } from '../api.ts';
import { useAra } from '../store.ts';

interface AccessInfo {
  tailnet: string | null;
  serving: boolean;
  port: number;
}

/**
 * Van het bureau naar de telefoon in één scan.
 *
 * De enige weg naar de echte wereld op de telefoon is de PWA die deze collector
 * zelf serveert, via Tailscale (`scripts/expose.sh tailnet`). Dat adres
 * overtypen op een telefoon is precies de stap waar het misgaat; een QR-code
 * niet. De collector zegt via `/access` welk adres dat is — en of Tailscale
 * poort 4747 wel doorgeeft. Is er geen adres, dan staat hier het commando dat
 * dat verhelpt, niet een lege QR.
 *
 * Het token reist mee in de code (`?token=`): de viewer kwam er zelf mee
 * binnen, dus hij heeft het al. Wie deze code scant, krijgt dezelfde toegang
 * als wie dit scherm kan zien.
 */
export function PhonePanel(): JSX.Element | null {
  const open = useAra((s) => s.phoneOpen);
  const setOpen = useAra((s) => s.setPhoneOpen);
  const demo = useAra((s) => s.demo);
  const [info, setInfo] = useState<AccessInfo | null | 'error'>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open || demo) return;
    let alive = true;
    fetch(withToken('/access'))
      .then((r) => (r.ok ? (r.json() as Promise<AccessInfo>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setInfo(data))
      .catch(() => alive && setInfo('error'));
    return () => {
      alive = false;
    };
  }, [open, demo]);

  const url =
    info && info !== 'error' && info.tailnet
      ? `${info.tailnet}${getToken() ? `?token=${encodeURIComponent(getToken())}` : ''}`
      : '';

  // Ook op `open`: de tweede keer openen mount een nieuwe canvas terwijl `url`
  // gelijk bleef, en dan tekende het effect niet en bleef het vlak leeg.
  useEffect(() => {
    if (!open || !url || !canvas.current) return;
    QRCode.toCanvas(canvas.current, url, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).catch(() => {
      /* een QR die niet tekent: het adres staat er ook in tekst */
    });
  }, [url, open]);

  if (!open) return null;

  return (
    <div className="phone-wrap" role="dialog" aria-label="Op je telefoon" onClick={() => setOpen(false)}>
      <div className="phone-card" onClick={(e) => e.stopPropagation()}>
        <div className="phone-head">
          <h2>📱 Op je telefoon</h2>
          <button type="button" className="btn" onClick={() => setOpen(false)} aria-label="Sluiten">
            ✕
          </button>
        </div>
        {demo ? (
          <p className="phone-note">
            Dit is de demo. De echte wereld staat op je Mac; open daar deze knop voor de code.
          </p>
        ) : info === null ? (
          <p className="phone-note">Adres opvragen…</p>
        ) : info === 'error' ? (
          <p className="phone-note">De collector antwoordt niet op <code>/access</code> — is hij bijgewerkt?</p>
        ) : url ? (
          <>
            <canvas ref={canvas} className="phone-qr" width={220} height={220} />
            <p className="phone-url">
              <code>{info.tailnet}</code>
            </p>
            {!info.serving && (
              <p className="phone-warn">
                Tailscale kent deze Mac, maar geeft poort {info.port} nog niet door. Draai eerst{' '}
                <code>./scripts/expose.sh tailnet</code>.
              </p>
            )}
            <ol className="phone-steps">
              <li>Tailscale-app op je telefoon, ingelogd met hetzelfde account.</li>
              <li>Scan de code (of typ het adres).</li>
              <li>Deelknop → <b>Zet op beginscherm</b>. Daarna opent hij als app.</li>
            </ol>
            {getToken() && <p className="phone-note">Het token zit in de code; wie hem scant, komt binnen.</p>}
          </>
        ) : (
          <>
            <p className="phone-note">
              Geen Tailscale-adres gevonden. Op de Mac, eenmalig:
            </p>
            <pre className="phone-cmd">./scripts/expose.sh tailnet</pre>
            <p className="phone-note">
              Dat geeft een <code>https://…ts.net</code>-adres dat alleen jouw eigen apparaten kunnen
              openen. Daarna verschijnt hier de QR-code.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
