import { officeKindForVenture, type OfficeKind } from './office.ts';

/**
 * De organisatiestructuur per categorie.
 *
 * Eén generieke manager met één zin "focus" was te dun: een ritplanner, een
 * garagechef en een marktanalist doen fundamenteel ander werk, met andere
 * risico's en andere cijfers. Een playbook beschrijft per tak wie er werkt,
 * wat ze doen, wat altijd geëscaleerd moet worden en waar de échte cijfers
 * vandaan komen.
 *
 * De inhoud staat in `plugins/ara/org.json` (daar past de gebruiker 'm aan);
 * dit bestand geeft de vorm en een verdedigbaar standaard-playbook per
 * branche, zodat een nieuwe venture nooit met een leeg kantoor begint.
 */

export interface Specialist {
  /** Agent-definitie in plugins/ara/agents (zonder .md). */
  agent: string;
  /** Hoe deze rol in het kantoor heet. */
  name: string;
  /** Eén regel: wat doet deze rol hier concreet. */
  does: string;
  /** haiku voor eenvoudig, herhaalbaar werk; default waar oordeel nodig is. */
  model?: 'haiku' | 'default';
}

export interface DataSource {
  /** Welk cijfer dit voedt, bv. "Ritstatus per wagen". */
  label: string;
  /** Hoe je eraan komt — een bestand, een endpoint, een query. */
  how: string;
  /** false zolang de gebruiker dit nog moet invullen. */
  configured: boolean;
}

export interface Playbook {
  /** Naam van de manager in het kantoor, bv. "Manager Ritplanning". */
  managerName: string;
  /** Vaste rollen op de vloer, ook als er nu niemand draait. */
  specialists: Specialist[];
  /** Terugkerend werk van deze tak. */
  duties: string[];
  /** Wat NOOIT zelfstandig mag — altijd ESCALATE. */
  escalate: string[];
  /** Validatie vóór "done" (naast de projectchecks). */
  checks: string[];
  /** Waar de echte werkplek-cijfers vandaan (moeten) komen. */
  dataSources: DataSource[];
}

const worker = (name: string, does: string): Specialist => ({
  agent: 'ara-worker',
  name,
  does,
  model: 'default',
});
const scout = (name: string, does: string): Specialist => ({
  agent: 'ara-web-scout',
  name,
  does,
  model: 'haiku',
});
const reporter: Specialist = {
  agent: 'ara-reporter',
  name: 'Cijferaanvoer',
  does: 'zet de echte werkplek-cijfers in het kantoor (POST /office/:project/station)',
  model: 'haiku',
};

/**
 * Standaard-playbooks per branche. Bewust concreet: een tak die niets
 * bijzonders nodig heeft draait hier prima op, en wie wél iets bijzonders
 * wil overschrijft 'm in org.json.
 */
const DEFAULTS: Record<OfficeKind, Omit<Playbook, 'managerName'>> = {
  tms: {
    specialists: [
      { agent: 'ara-planner', name: 'Ritplanner', does: 'ritten indelen en ETA-afwijkingen signaleren — levert voorstellen, wijzigt nooit', model: 'default' },
      { agent: 'ara-invoice-auditor', name: 'Facturatie-controleur', does: 'facturen naast de uitgevoerde ritten leggen en afwijkingen markeren', model: 'default' },
      { agent: 'ara-dispatch-comms', name: 'Chauffeur- en klantcontact', does: 'concepten schrijven bij vertraging of wijziging — verstuurt nooit zelf', model: 'default' },
      worker('Integratie-engineer', 'TMS-koppelingen en exports'),
      reporter,
    ],
    duties: [
      'Ritten van vandaag en morgen nalopen op gaten en dubbelboekingen',
      'ETA-afwijkingen en niet-gemelde vertragingen opsporen',
      'Facturen naast de uitgevoerde ritten leggen: niet gefactureerd, dubbel, verkeerd tarief',
      'Bij elke vertraging een concept klaarzetten voor chauffeur en klant',
    ],
    escalate: [
      'Databasemigraties op productie',
      'Wijzigingen aan een externe transport-API of koppelingssleutel',
      'Alles wat een rit of factuur bij een klant verandert',
      'Een bericht daadwerkelijk versturen naar een chauffeur of klant',
      'Crediteren of een tarief aanpassen',
    ],
    checks: ['planningstests', 'typecheck'],
    dataSources: [
      { label: 'Ritten en ETA per wagen', how: 'VUL-IN: query of export uit de TMS-database', configured: false },
      { label: 'Facturatiestand', how: 'VUL-IN: rapport of endpoint', configured: false },
    ],
  },
  fleet: {
    specialists: [
      { agent: 'ara-fleet-tech', name: 'Wagenparkbeheer', does: 'onderhoud, schades en garagepunten per voertuig bewaken', model: 'default' },
      { agent: 'ara-compliance-watch', name: 'Keuringsbewaking', does: 'wettelijke termijnen (APK, tachograaf, ADR, code 95) — alarmeert vóór de vervaldatum', model: 'default' },
      { agent: 'ara-fleet-cost', name: 'Kosten- en bandenanalist', does: 'kosten per kilometer per voertuig en uitschieters eruit halen', model: 'default' },
      { agent: 'ara-trailer-manager', name: 'Trailerbeheer', does: 'beschikbaarheid, stilstand en scheefstand van trailers', model: 'default' },
      worker('Data-engineer', 'Supabase-sync en data-integriteit'),
      reporter,
    ],
    duties: [
      'Wettelijke termijnen per voertuig en chauffeur bewaken — verlopen, 14, 30 en 60 dagen',
      'Onderhoudsinterval tegen de kilometerstand houden en garagepunten volgen tot afmelding',
      'Kosten per kilometer per voertuig volgen en uitschieters markeren',
      'Beschikbaarheid van trailers bewaken: tekorten, stilstand en scheefstand tussen locaties',
    ],
    escalate: [
      'Schrijfacties op de productie-database',
      'Een voertuig administratief uit dienst nemen',
      'Alles wat de wettelijke keuringsstatus raakt, inclusief afspraken bij een keuringsstation',
      'Een voertuig of trailer huren, kopen of afstoten',
    ],
    checks: ['typecheck', 'data-integriteitscheck'],
    dataSources: [
      { label: 'Kenteken, APK-datum, kilometerstand', how: 'VUL-IN: Supabase-tabel of export', configured: false },
      { label: 'Openstaande garagepunten', how: 'VUL-IN: werkplaatssysteem of lijst', configured: false },
      { label: 'Chauffeurstermijnen (rijbewijs, code 95, chauffeurskaart)', how: 'VUL-IN: personeelslijst of export', configured: false },
      { label: 'Kosten per voertuig (brandstof, banden, reparatie)', how: 'VUL-IN: boekhouding- of tankpas-export', configured: false },
      { label: 'Trailerlijst met standplaats en koppeling', how: 'VUL-IN: eigen lijst of werkplaatssysteem', configured: false },
    ],
  },
  trading: {
    specialists: [
      { agent: 'ara-market-analyst', name: 'Marktanalist', does: 'setups en risico lezen en signaleren — strikt read-only, voorstel nooit order', model: 'default' },
      { agent: 'ara-risk-guard', name: 'Risicobewaker', does: 'blootstelling, drawdown en positiegrootte tegen de limieten houden — alarmeert, grijpt nooit in', model: 'default' },
      { agent: 'ara-trade-journal', name: 'Handelsjournaal', does: 'elke afgesloten trade vastleggen met aanleiding en uitkomst, en periodiek evalueren', model: 'default' },
      { agent: 'ara-event-scout', name: 'Eventscout', does: 'agenda die het instrument raakt volgen en vóór het event waarschuwen', model: 'haiku' },
      { agent: 'ara-bot-maintainer', name: 'Bot-onderhoud', does: 'logging, backtests en infrastructuur rond de bot — nooit de orderlogica', model: 'default' },
      reporter,
    ],
    duties: [
      'Openstaande posities en risico aflezen uit wat de bot zelf wegschrijft',
      'Blootstelling, drawdown en posities zonder stop toetsen aan de limieten',
      'Elke afgesloten trade in het journaal zetten en periodiek evalueren',
      'De agenda voor de komende dagen nalopen op events die XAU/USD raken',
      'Afwijkingen tussen backtest en live signaleren; logging en storingen bewaken',
    ],
    escalate: [
      'ELKE wijziging aan orderlogica, positiegrootte of stops',
      'ELKE aanraking van API-sleutels of broker-instellingen',
      'Alles wat een order kan plaatsen, wijzigen of annuleren',
      'Een positie sluiten of verkleinen, ook bij een overschreden risicolimiet',
    ],
    checks: ['backtest draait met uitkomst vóór/ná', 'typecheck'],
    dataSources: [
      {
        label: 'Posities, P&L, stops',
        how: 'VUL-IN: het statusbestand dat de bot zélf schrijft — ARA leest, nooit de broker',
        configured: false,
      },
      { label: 'Risicolimieten (max inzet per trade, drawdown)', how: 'VUL-IN: jouw grenzen, bv. een limits.json naast de bot', configured: false },
      { label: 'Handelslogboek van afgesloten trades', how: 'VUL-IN: exportfile of logboek van de bot', configured: false },
    ],
  },
  crypto: {
    specialists: [
      { agent: 'ara-market-analyst', name: 'Marktanalist', does: 'munten en setups volgen — strikt read-only, voorstel nooit order', model: 'default' },
      { agent: 'ara-risk-guard', name: 'Risicobewaker', does: 'blootstelling en drawdown tegen de limieten houden — alarmeert, grijpt nooit in', model: 'default' },
      { agent: 'ara-trade-journal', name: 'Handelsjournaal', does: 'afgesloten posities vastleggen met aanleiding en uitkomst', model: 'default' },
      { agent: 'ara-event-scout', name: 'Eventscout', does: 'unlocks, listings en netwerkupgrades volgen en vooraf waarschuwen', model: 'haiku' },
      { agent: 'ara-allocation-guard', name: 'Allocatiebewaker', does: 'concentratie per munt en per sector bewaken — stelt voor, herbalanceert nooit', model: 'default' },
      { agent: 'ara-token-safety', name: 'Veiligheidscheck', does: 'contract, liquiditeit en verdeling op rode vlaggen controleren vóór een munt op de volglijst komt', model: 'default' },
      { agent: 'ara-narrative-scout', name: 'Narratiefscout', does: 'volgen waar de aandacht heen gaat per sector — beschrijft, voorspelt nooit', model: 'haiku' },
      scout('On-chain scout', 'publieke koersen en on-chain data ophalen'),
      reporter,
    ],
    duties: [
      'Bewaakte munten volgen op de afgesproken niveaus',
      'Concentratie per munt en per sector toetsen aan de streefverdeling',
      'Elke nieuwe munt langs de veiligheidscheck vóór hij op de volglijst komt',
      'Volgen waar de aandacht heen gaat per sector, en wat juist uit beeld raakt',
      'On-chain signalen, unlocks en listings bij de portefeuille zoeken',
      'Setups documenteren met ingang, stop en doel — als voorstel, niet als order',
    ],
    escalate: [
      'ELKE wijziging aan orderlogica of positiegrootte',
      'ELKE aanraking van exchange-sleutels',
      'Elke handeling die geld verplaatst',
      'Een positie sluiten of verkleinen, ook bij een overschreden risicolimiet',
    ],
    checks: ['typecheck'],
    dataSources: [
      {
        label: 'Koersen',
        // Publiek en sleutelloos; gekozen door de eigenaar. Niet vanuit de
        // container te bereiken (egress-proxy), wél vanaf de Mac.
        how: 'CoinGecko: https://api.coingecko.com/api/v3/simple/price?ids=<munten>&vs_currencies=usd — publiek, geen sleutel',
        configured: true,
      },
      { label: 'Portefeuille en posities', how: 'VUL-IN: eigen statusbestand dat je bot of wallet-export wegschrijft', configured: false },
      { label: 'Streefverdeling en concentratiegrenzen', how: 'VUL-IN: jouw doelallocatie per munt/sector', configured: false },
    ],
  },
  design: {
    specialists: [
      { agent: 'ara-creative', name: 'Ontwerper', does: 'campagnes en assets maken, altijd met screenshot in het resultaat', model: 'default' },
      scout('Research-scout', 'referenties en concurrentie bekijken'),
      reporter,
    ],
    duties: [
      'Lopende campagnes en deliverables bijhouden',
      'Assets consistent houden met de huisstijl',
      'Sites controleren op gebroken pagina\'s en trage laadtijden',
    ],
    escalate: ['Publiceren naar een live site of kanaal', 'Uitgaven aan advertenties of tooling'],
    checks: ['build', 'screenshot in het taakresultaat'],
    dataSources: [
      { label: 'Lopende opdrachten', how: 'VUL-IN: projectlijst of board-export', configured: false },
    ],
  },
  studio: {
    specialists: [
      { agent: 'ara-creative', name: 'Studio-productie', does: 'site, boekingen en audio-tooling', model: 'default' },
      worker('Web-engineer', 'site en boekingsflow'),
      reporter,
    ],
    duties: ['Boekingen en beschikbaarheid bijhouden', 'Site en boekingsflow werkend houden', 'Audio-tooling onderhouden'],
    escalate: ['Publiceren naar de live site', 'Wijzigingen in de boekingsflow die klanten raken'],
    checks: ['build', 'screenshot in het taakresultaat'],
    dataSources: [{ label: 'Boekingen', how: 'VUL-IN: agenda of boekingssysteem', configured: false }],
  },
  music: {
    specialists: [
      { agent: 'ara-creative', name: 'Releasebeheer', does: 'releases, artwork en promotie', model: 'default' },
      scout('Promo-scout', 'playlists, blogs en kanalen bekijken'),
      reporter,
    ],
    duties: ['Releaseplanning bijhouden', 'Promotiekanalen volgen', 'Site en links actueel houden'],
    escalate: ['Publiceren van een release', 'Contact met labels of platforms namens de gebruiker'],
    checks: ['links werken', 'build'],
    dataSources: [{ label: 'Releases en streams', how: 'VUL-IN: distributeur-export', configured: false }],
  },
  generic: {
    specialists: [worker('Uitvoerder', 'de taken van deze tak uitvoeren'), scout('Scout', 'opzoekwerk op het web'), reporter],
    duties: ['Openstaande bordtaken van deze tak afwerken'],
    escalate: ['Alles wat naar buiten gaat, geld kost of onomkeerbaar is'],
    checks: ['de checks die het project zelf definieert'],
    dataSources: [],
  },
};

/** Ruwe (mogelijk onvolledige) playbook-invoer uit org.json. */
export type RawPlaybook = Partial<Playbook>;

/**
 * Maakt van een venture-id + eventuele org.json-invoer een compleet playbook.
 * Ontbrekende velden komen uit het branche-standaard; wat de gebruiker wél
 * invulde wint altijd.
 */
export function resolvePlaybook(
  ventureId: string,
  ventureLabel: string,
  raw?: RawPlaybook,
): Playbook {
  const base = DEFAULTS[officeKindForVenture(ventureId)];
  return {
    managerName: raw?.managerName ?? `Manager ${ventureLabel}`,
    specialists: raw?.specialists?.length ? raw.specialists : base.specialists,
    duties: raw?.duties?.length ? raw.duties : base.duties,
    escalate: raw?.escalate?.length ? raw.escalate : base.escalate,
    checks: raw?.checks?.length ? raw.checks : base.checks,
    dataSources: raw?.dataSources ?? base.dataSources,
  };
}

/**
 * Compacte tekst voor in een spawn-prompt. De manager krijgt zijn hele
 * playbook mee in plaats van één zin focus — dat scheelt hem uitzoekwerk
 * (en dus tokens) en maakt zijn grenzen expliciet.
 */
export function playbookPrompt(playbook: Playbook): string {
  const lines = [
    `Je bent ${playbook.managerName}.`,
    `Vaste rollen op jouw vloer: ${playbook.specialists
      .map((s) => `${s.name} (${s.agent}${s.model === 'haiku' ? ', haiku' : ''}) — ${s.does}`)
      .join('; ')}.`,
    `Terugkerend werk: ${playbook.duties.join('; ')}.`,
    `ALTIJD escaleren (taak failed met "ESCALATE: …"): ${playbook.escalate.join('; ')}.`,
    `Valideer vóór done: ${playbook.checks.join(', ')}.`,
  ];
  const open = playbook.dataSources.filter((d) => !d.configured);
  if (open.length > 0) {
    lines.push(
      `Nog niet aangesloten databronnen (niet zelf verzinnen — meld ze als open punt): ${open
        .map((d) => `${d.label} (${d.how})`)
        .join('; ')}.`,
    );
  }
  return lines.join('\n');
}
