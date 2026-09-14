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
 * Elke tak heeft code, sleutels en endpoints — dus elke tak heeft dit nodig.
 * Eén vergeten `.env` of een te ruime CORS is geen brancheprobleem.
 */
const security: Specialist = {
  agent: 'ara-security-auditor',
  name: 'Beveiligingsaudit',
  does: 'secrets, kwetsbare dependencies en onbeschermde endpoints opsporen — meldt met bewijs, herstelt nooit',
  model: 'default',
};
/**
 * De enige rol die een handelsvoorstel indient. Hij beslist niets: de
 * risicomotor in de collector doet dat, en die staat buiten zijn bereik.
 */
const executionTrader: Specialist = {
  agent: 'ara-execution-trader',
  name: 'Uitvoering',
  does: 'dient voorstellen in bij de risicomotor — kan zelf geen order plaatsen en houdt geen sleutel',
  model: 'default',
};
/**
 * Tot nu toe keurde elke worker zijn eigen werk. Deze rol bouwt niets en
 * repareert niets; hij stelt vast. Elke tak heeft 'm nodig, want elke tak
 * levert werk op waarvan iemand zegt dat het af is.
 */
const qa: Specialist = {
  agent: 'ara-qa-verifier',
  name: 'Controle',
  does: 'draait de checks zelf en leest de diff tegen de opdracht — repareert nooit',
  model: 'default',
};
/** Afhankelijkheden bijwerken is ander werk dan ze melden. */
const deps: Specialist = {
  agent: 'ara-dependency-warden',
  name: 'Afhankelijkheden',
  does: 'changelog lezen, één bump per commit op een branch, volledige checks — merget nooit',
  model: 'default',
};
const docs: Specialist = {
  agent: 'ara-doc-writer',
  name: 'Documentatie',
  does: 'docs synchroon houden met de code — verzint nooit gedrag dat hij niet las',
  model: 'haiku',
};
const dataEngineer: Specialist = {
  agent: 'ara-data-engineer',
  name: 'Data-engineer',
  does: 'sync, migraties en integriteitschecks — test tegen een kopie, voert nooit uit op productie',
  model: 'default',
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
      dataEngineer,
      qa,
      deps,
      docs,
      security,
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
      dataEngineer,
      qa,
      deps,
      docs,
      security,
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
      executionTrader,
      { agent: 'ara-bot-maintainer', name: 'Bot-onderhoud', does: 'logging, backtests en infrastructuur rond de bot — nooit de orderlogica', model: 'default' },
      qa,
      deps,
      docs,
      security,
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
      executionTrader,
      scout('On-chain scout', 'publieke koersen en on-chain data ophalen'),
      qa,
      deps,
      docs,
      security,
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
  // De drie creatieve takken delen geen rol meer: klantwerk, eigen zaak en een
  // onomkeerbare release hebben elk andere publicatiegrenzen.
  design: {
    specialists: [
      { agent: 'ara-designer', name: 'Ontwerper', does: 'campagnes en assets voor klanten, altijd met screenshot — staging mag, klantkanalen nooit', model: 'default' },
      { agent: 'ara-copywriter', name: 'Copywriter', does: 'teksten in twee varianten als concept in drafts/ — publiceert nooit', model: 'default' },
      { agent: 'ara-site-watch', name: 'Sitebewaker', does: 'links, snelheid, afbeeldingen en SEO-basis nalopen — repareert nooit zelf', model: 'haiku' },
      { agent: 'ara-social-scheduler', name: 'Contentplanning', does: 'contentkalender als concept in drafts/ — plaatst nooit', model: 'default' },
      scout('Research-scout', 'referenties en concurrentie bekijken'),
      qa,
      deps,
      docs,
      security,
      reporter,
    ],
    duties: [
      'Lopende campagnes en deliverables bijhouden',
      'Assets consistent houden met de huisstijl van de klant',
      'Klantsites periodiek nalopen op gebroken links, trage pagina\'s en SEO-gebreken',
    ],
    escalate: [
      'Publiceren naar productie van een klant, of naar een kanaal, mail of advertentie',
      'Uitgaven aan advertenties, stockmateriaal, licenties of tooling',
      'Beeld gebruiken waarvan de herkomst onbekend is',
    ],
    checks: ['build', 'screenshot in het taakresultaat'],
    dataSources: [
      { label: 'Lopende opdrachten', how: 'VUL-IN: projectlijst of board-export', configured: false },
      { label: 'Te bewaken sites', how: 'VUL-IN: lijst met URL\'s per klant', configured: false },
    ],
  },
  studio: {
    specialists: [
      { agent: 'ara-studio-producer', name: 'Studio-productie', does: 'site en audio-tooling; mag naar productie behalve de boekingsflow', model: 'default' },
      { agent: 'ara-booking-watch', name: 'Agendabewaking', does: 'dubbele boekingen, te lang openstaande aanvragen en gaten in de agenda', model: 'default' },
      { agent: 'ara-copywriter', name: 'Copywriter', does: 'site- en boekingsteksten als concept — publiceert nooit', model: 'default' },
      { agent: 'ara-site-watch', name: 'Sitebewaker', does: 'links, snelheid en SEO-basis nalopen — repareert nooit zelf', model: 'haiku' },
      { agent: 'ara-social-scheduler', name: 'Contentplanning', does: 'contentkalender als concept in drafts/ — plaatst nooit', model: 'default' },
      worker('Web-engineer', 'site en boekingsflow'),
      qa,
      deps,
      docs,
      security,
      reporter,
    ],
    duties: [
      'Aanvragen volgen: niets langer dan 24 uur onbeantwoord',
      'Agenda bewaken op dubbele boekingen en op verkoopbare gaten',
      'Site en boekingsflow werkend houden, boekingsflow altijd eerst op staging',
      'Audio-tooling onderhouden',
    ],
    escalate: [
      'Productie-deploy van de boekingsflow zelf',
      'Een boeking bevestigen, verzetten of annuleren',
      'Contact met een klant, in welke vorm dan ook',
      'Uitgaven aan tooling of hosting',
    ],
    checks: ['build', 'boekingsflow end-to-end op staging', 'screenshot in het taakresultaat'],
    dataSources: [
      { label: 'Agenda en boekingen', how: 'VUL-IN: agenda of boekingssysteem', configured: false },
      { label: 'Openstaande aanvragen', how: 'VUL-IN: mailbox-export of formulier-backend', configured: false },
    ],
  },
  music: {
    specialists: [
      { agent: 'ara-release-manager', name: 'Releasebeheer', does: 'releasepakket en metadata compleet maken; site mag live, de release uitbrengen nooit', model: 'default' },
      { agent: 'ara-copywriter', name: 'Copywriter', does: 'release- en promotieteksten als concept — publiceert nooit', model: 'default' },
      { agent: 'ara-site-watch', name: 'Sitebewaker', does: 'links en streamingknoppen controleren — een dode link op releasedag is een verloren dag', model: 'haiku' },
      { agent: 'ara-social-scheduler', name: 'Contentplanning', does: 'contentkalender als concept in drafts/ — plaatst nooit', model: 'default' },
      scout('Promo-scout', 'playlists, blogs en kanalen bekijken'),
      qa,
      deps,
      docs,
      security,
      reporter,
    ],
    duties: [
      'Releaseplanning bijhouden en het pakket compleet maken tot aan de knop',
      'Metadata driemaal controleren: credits, schrijvers, ISRC, releasedatum',
      'Site en streaminglinks actueel houden, zeker rond een releasedatum',
      'Promotiekanalen volgen en materiaal als concept klaarzetten',
    ],
    escalate: [
      'Een release daadwerkelijk uitbrengen bij een distributeur of platform',
      'Een releasedatum vastleggen of verzetten',
      'Contact met een label, playlist of platform namens de gebruiker',
    ],
    checks: ['links werken', 'build', 'metadata compleet'],
    dataSources: [
      { label: 'Releases en streams', how: 'VUL-IN: distributeur-export', configured: false },
      { label: 'Releaseplanning en metadata', how: 'VUL-IN: eigen releaselijst', configured: false },
    ],
  },
  equities: {
    specialists: [
      { agent: 'ara-equity-analyst', name: 'Fundamenteel analist', does: 'these per positie onderbouwen met primaire bronnen, en melden wanneer het breekpunt geraakt is', model: 'default' },
      { agent: 'ara-earnings-watch', name: 'Cijferbewaking', does: 'kwartaalagenda en dividenddata bijhouden en vooraf waarschuwen', model: 'default' },
      { agent: 'ara-allocation-guard', name: 'Portefeuillebeheer', does: 'weging per naam en per sector bewaken — stelt voor, herbalanceert nooit', model: 'default' },
      { agent: 'ara-risk-guard', name: 'Risicobewaker', does: 'blootstelling en drawdown tegen de limieten houden — alarmeert, grijpt nooit in', model: 'default' },
      executionTrader,
      { agent: 'ara-trade-journal', name: 'Journaal', does: 'elke aan- en verkoop vastleggen met these en uitkomst', model: 'default' },
      qa,
      deps,
      docs,
      security,
      reporter,
    ],
    duties: [
      'These per positie actueel houden en het breekpunt expliciet benoemen',
      'Kwartaalagenda en dividenddata van portefeuille en volglijst bijhouden',
      'Weging per naam en per sector toetsen aan de streefverdeling',
      'Voorstellen indienen via de risicomotor — nooit daarbuiten om',
      'Elke aan- en verkoop in het journaal zetten met de these die eronder lag',
    ],
    escalate: [
      'ELKE order buiten de risicomotor om',
      'ELKE wijziging aan trading-limits.json, de modus of de noodstop',
      'ELKE aanraking van broker-sleutels of rekeninginstellingen',
      'Geld storten, opnemen of overboeken',
      'Een positie sluiten zonder dat daar een eigen besluit met reden aan ten grondslag ligt',
    ],
    checks: ['risicomotor accepteerde het voorstel', 'these vastgelegd met bron', 'typecheck'],
    dataSources: [
      { label: 'Koersen en portefeuille', how: 'VUL-IN: export van je broker of eigen statusbestand — ARA leest, vraagt nooit zelf de broker', configured: false },
      { label: 'Kwartaalagenda', how: 'VUL-IN: investor-relations-pagina per naam, of een agenda-export', configured: false },
      { label: 'Jaarverslagen en kwartaalcijfers', how: 'VUL-IN: primaire bron per naam (IR-site)', configured: false },
      { label: 'Streefverdeling per sector', how: 'VUL-IN: jouw doelallocatie', configured: false },
    ],
  },
  generic: {
    specialists: [
      worker('Uitvoerder', 'de taken van deze tak uitvoeren'),
      scout('Scout', 'opzoekwerk op het web'),
      qa,
      deps,
      docs,
      security,
      reporter,
    ],
    duties: [
      'Openstaande bordtaken van deze tak afwerken',
      'Periodiek nalopen op uitgelekte secrets en kwetsbare dependencies',
    ],
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
