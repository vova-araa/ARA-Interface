/**
 * Elke databron uit de playbooks als bestand.
 *
 * Tweeëntwintig bronnen stonden op `configured: false`, elk met een "VUL-IN"
 * erbij en niemand die wist wát hij dan moest invullen. Dit is het antwoord:
 * per bron één bestandsnaam en één kolomlijst. Zet het bestand neer onder
 * `data/sources/<tak>/`, en de collector ziet de bron als aangesloten zodra
 * er ten minste één regel in staat — een lege kop is géén bron (regel 4: een
 * getal dat niet gemeten is, wordt weggelaten).
 *
 * Wat hier met opzet niet in staat: een sleutel. Posities, koersen en
 * portefeuilles komen uit een export of het statusbestand dat de bot zelf
 * schrijft. ARA leest; ARA vraagt nooit zelf de broker of de exchange.
 *
 * `trading-limits.json` is de uitzondering op het CSV-formaat: dat bestand is
 * van de risicomotor zelf en telt hier alleen mee als aanwezig-of-niet.
 */
import { parseCsv, parseDate, parseNumber } from './fleet.ts';

export interface SourceSpec {
  venture: string;
  /** Exact het label uit het playbook (`dataSources[].label`). */
  label: string;
  /** Bestandsnaam onder data/sources/<venture>/. */
  file: string;
  /** Kolommen die in de kop moeten staan; ontbreekt er één, dan is de tabel onleesbaar. */
  required: string[];
  /**
   * Cellen die per rij gevuld moeten zijn (leeg = de eerste van `required`):
   * de sleutel van de rij. Een lege stop bij een positie is juist het alarm,
   * dus die is verplicht als kolom en niet als cel.
   */
  key?: string[];
  /** Kolommen die als datum gelezen worden (leeg of onleesbaar ⇒ undefined, nooit "vandaag"). */
  dates?: string[];
  /** Kolommen die als getal gelezen worden (1.250,50 en 1250.50 allebei). */
  numbers?: string[];
  note?: string;
  /** Eigen verversingstermijn; leeg = een week (plus een dag speling). */
  staleAfterMs?: number;
}

const MONTH_MS = 40 * 24 * 60 * 60 * 1000;

export const SOURCE_SPECS: SourceSpec[] = [
  { venture: 'traject', label: "Ritten en ETA per wagen", file: 'ritten.csv', required: ['rit', 'kenteken', 'van', 'naar', 'eta', 'status'], dates: ['eta'], note: "status: gepland | onderweg | geleverd | vertraagd" },
  { venture: 'traject', label: "Facturatiestand", file: 'facturen.csv', required: ['factuur', 'klant', 'bedrag', 'verstuurd', 'vervalt'], dates: ['verstuurd', 'vervalt', 'betaald'], numbers: ['bedrag'], note: "kolom betaald leeg = openstaand" },
  { venture: 'blex', label: "Kenteken, APK-datum, kilometerstand", file: 'vehicles.csv', required: ['kenteken'], dates: ['apk', 'tachograaf', 'adr', 'verzekering'], numbers: ['km'], note: "termijnen die niet gelden: kolom weglaten" },
  { venture: 'blex', label: "Openstaande garagepunten", file: 'garage.csv', required: ['kenteken', 'punt', 'gemeld'], dates: ['gemeld', 'afgemeld'], note: "afgemeld leeg = staat nog open" },
  { venture: 'blex', label: "Chauffeurstermijnen (rijbewijs, code 95, chauffeurskaart)", file: 'drivers.csv', required: ['naam'], dates: ['rijbewijs', 'code95', 'chauffeurskaart'] },
  { venture: 'blex', label: "Kosten per voertuig (brandstof, banden, reparatie)", file: 'kosten.csv', required: ['kenteken', 'maand', 'brandstof', 'banden', 'reparatie', 'km'], numbers: ['brandstof', 'banden', 'reparatie', 'km'], note: "maand als 2026-09; \u00e9\u00e9n regel per wagen per maand" },
  { venture: 'blex', label: "Trailerlijst met standplaats en koppeling", file: 'trailers.csv', required: ['trailer', 'standplaats', 'status'], dates: ['sinds'], note: "gekoppeld_aan = kenteken van de trekker, leeg = los; status: inzetbaar | defect | verhuurd" },
  { venture: 'trading', label: "Posities, P&L, stops", file: 'posities.csv', required: ['instrument', 'richting', 'inzet', 'entry', 'stop'], dates: ['geopend'], numbers: ['inzet', 'entry', 'stop', 'pnl'], note: "het statusbestand dat de bot z\u00e9lf schrijft \u2014 ARA leest, nooit de broker" },
  { venture: 'trading', label: "Risicolimieten (max inzet per trade, drawdown)", file: 'trading-limits.json', required: [], note: "dit is data/trading-limits.json van de risicomotor zelf; de actielijst zegt of hij bruikbaar is" },
  { venture: 'trading', label: "Handelslogboek van afgesloten trades", file: 'trades.csv', required: ['datum', 'instrument', 'richting', 'resultaat_r'], dates: ['datum'], numbers: ['resultaat_r', 'inzet'], note: "resultaat in R (winst gedeeld door risico), niet in geld" },
  { venture: 'crypto', label: "Portefeuille en posities", file: 'portefeuille.csv', required: ['munt', 'aantal'], dates: ['peildatum'], numbers: ['aantal', 'waarde_usd'], note: "wallet-export of het statusbestand van je bot \u2014 geen exchange-sleutel" },
  { venture: 'crypto', label: "Streefverdeling en concentratiegrenzen", file: 'allocatie.csv', required: ['munt_of_sector', 'doel_pct', 'max_pct'], numbers: ['doel_pct', 'max_pct'] },
  { venture: 'elevate', label: "Lopende opdrachten", file: 'opdrachten.csv', required: ['klant', 'opdracht', 'status'], dates: ['deadline'], note: "status: offerte | lopend | review | af" },
  { venture: 'elevate', label: "Te bewaken sites", file: 'sites.csv', required: ['url', 'klant'], note: "de site-watch leest alleen; niets gaat naar buiten" },
  { venture: 'uprising', label: "Agenda en boekingen", file: 'boekingen.csv', required: ['datum', 'klant', 'ruimte', 'status'], dates: ['datum'], numbers: ['uren'], note: "status: aanvraag | bevestigd | geannuleerd" },
  { venture: 'uprising', label: "Openstaande aanvragen", file: 'aanvragen.csv', required: ['ontvangen', 'van', 'onderwerp', 'status'], dates: ['ontvangen'], note: "status: nieuw | beantwoord | gesloten" },
  { venture: 'vovara', label: "Releases en streams", file: 'releases.csv', staleAfterMs: MONTH_MS, required: ['titel', 'datum'], dates: ['datum'], numbers: ['streams'], note: "distributeur-export, streams als getal" },
  { venture: 'vovara', label: "Releaseplanning en metadata", file: 'releaseplanning.csv', required: ['titel', 'geplande_datum', 'status'], dates: ['geplande_datum'], note: "status: idee | productie | ingeleverd | uit \u2014 uitbrengen doet ARA nooit" },
  { venture: 'equities', label: "Koersen en portefeuille", file: 'portefeuille.csv', required: ['ticker', 'aantal'], dates: ['peildatum'], numbers: ['aantal', 'koers', 'waarde'], note: "broker-export \u2014 ARA vraagt nooit zelf de broker; kolom sector erbij en de streefverdeling per sector wordt bewaakt" },
  { venture: 'equities', label: "Kwartaalagenda", file: 'kwartaalagenda.csv', required: ['ticker', 'datum', 'soort'], dates: ['datum'], note: "soort: kwartaalcijfers | jaarcijfers | ava | ex-dividend" },
  { venture: 'equities', label: "Jaarverslagen en kwartaalcijfers", file: 'cijfers.csv', staleAfterMs: MONTH_MS, required: ['ticker', 'periode', 'bron_url'], numbers: ['omzet', 'winst'], note: "bron_url = de primaire bron (IR-site), niet een samenvatting" },
  { venture: 'equities', label: "Streefverdeling per sector", file: 'sectorallocatie.csv', required: ['sector', 'doel_pct', 'max_pct'], numbers: ['doel_pct', 'max_pct'] },
];

export function sourceSpec(venture: string, label: string): SourceSpec | undefined {
  return SOURCE_SPECS.find((s) => s.venture === venture && s.label === label);
}

export function sourceSpecs(venture: string): SourceSpec[] {
  return SOURCE_SPECS.filter((s) => s.venture === venture);
}

export type SourceCell = string | number | undefined;
export type SourceRow = Record<string, SourceCell>;

export interface SourceTable {
  rows: SourceRow[];
  errors: string[];
}

/**
 * Een CSV volgens zijn spec: verplichte kolommen aanwezig, datums en getallen
 * getypeerd, al het andere als tekst. Onbekende kolommen blijven gewoon
 * staan — een bron mag meer weten dan wij vragen.
 */
export function readTable(text: string, spec: SourceSpec): SourceTable {
  const { header, records, errors } = parseCsv(text);
  if (header.length === 0) return { rows: [], errors };
  const missing = spec.required.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [...errors, `kolom(men) ontbreken in de kop: ${missing.join(', ')}`] };
  }
  const dates = new Set(spec.dates ?? []);
  const numbers = new Set(spec.numbers ?? []);
  const rows: SourceRow[] = [];
  records.forEach((rec, i) => {
    // Een lege sleutelcel (een Excel-export eindigt graag op ";;") is geen rij
    // maar een fout: melden en overslaan, niet doorgeven als "".
    const empty = (spec.key ?? spec.required.slice(0, 1)).filter((c) => !(rec[c] ?? '').trim());
    if (empty.length > 0) {
      errors.push(`regel ${i + 2}: verplichte kolom leeg: ${empty.join(', ')}`);
      return;
    }
    const row: SourceRow = {};
    for (const [key, raw] of Object.entries(rec)) {
      if (dates.has(key)) row[key] = parseDate(raw);
      else if (numbers.has(key)) row[key] = parseNumber(raw);
      else row[key] = raw;
    }
    rows.push(row);
  });
  return { rows, errors };
}
