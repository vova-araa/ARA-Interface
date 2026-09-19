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

/** Hoe vaak iets terugkomt. Fijner dan dit hoeft niet: de watchdog kijkt elke
 *  vijf minuten, maar werk dat vaker dan dagelijks terugkomt is geen ritme
 *  meer maar een monitor, en die staat in monitors.json. */
export type Cadence = 'dag' | 'week' | 'maand';

export interface Duty {
  every: Cadence;
  text: string;
  /**
   * De rol die dit werk doet, als agent-id (`ara-planner`, `ara-qa-verifier`, …).
   *
   * Leeg = de manager van de tak. Dat was tot nu toe de enige mogelijkheid, en
   * daardoor had één rol per tak werk en de andere tien niets: een vloer vol
   * functieomschrijvingen zonder een taak op het bord. Wie hier staat moet als
   * `agent` in de specialistenlijst van dezelfde tak voorkomen — anders wijst
   * het werk naar een stoel die er niet is, en een test bewaakt dat.
   */
  who?: string;
}

export interface Playbook {
  /** Naam van de manager in het kantoor, bv. "Manager Ritplanning". */
  managerName: string;
  /** Vaste rollen op de vloer, ook als er nu niemand draait. */
  specialists: Specialist[];
  /** Terugkerend werk van deze tak. */
  /**
   * Terugkerend werk, elk met zijn ritme. De cadans hoort bij de taak en niet
   * ergens anders: een taak zonder ritme staat er wel, maar gebeurt nooit — en
   * dat was precies de situatie. Acht managers met een functieomschrijving en
   * geen enkele taak op het bord.
   */
  duties: Duty[];
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
      { every: 'dag', who: 'ara-planner', text: 'Ritten van vandaag en morgen nalopen op gaten en dubbelboekingen' },
      { every: 'dag', who: 'ara-planner', text: 'ETA-afwijkingen en niet-gemelde vertragingen opsporen' },
      { every: 'week', who: 'ara-invoice-auditor', text: 'Facturen naast de uitgevoerde ritten leggen: niet gefactureerd, dubbel, verkeerd tarief' },
      { every: 'dag', who: 'ara-dispatch-comms', text: 'Bij elke vertraging een concept klaarzetten voor chauffeur en klant' },
      { every: 'week', who: 'ara-worker', text: 'Koppelingen en exports droogtesten tegen opgeslagen voorbeeldresponsen: welke aanroep heeft geen timeout, welke fout wordt stil weggeslikt' },
      { every: 'maand', who: 'ara-data-engineer', text: 'Migraties nalopen op volgorde, ontbrekende terugdraaistap en kolommen die de code leest maar het schema niet kent — tegen een kopie, nooit op productie' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het ritplanningswerk dat deze week op done ging: de planningstests zelf draaien en de diff tegen de opdracht leggen' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de TMS-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de TMS-repo tegen de code leggen: commando\'s, paden, poorten en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Repo en configuratie nalopen op uitgelekte sleutels, te ruime CORS en endpoints zonder auth — met bewijs, zonder een gevonden waarde te tonen' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of de TMS-bron al aangesloten is; zo niet, het inleesformaat klaarzetten (werkplek-id\'s uit offices, één voorbeeld-payload, wat er aan de bronkant ontbreekt) en geen enkele stand pushen' },
    ],
    escalate: [
      'Databasemigraties op productie',
      'Wijzigingen aan een externe transport-API of koppelingssleutel',
      'Alles wat een rit of factuur bij een klant verandert',
      'Een bericht daadwerkelijk versturen naar een chauffeur of klant',
      'Crediteren of een tarief aanpassen',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'dag', who: 'ara-compliance-watch', text: 'Wettelijke termijnen per voertuig en chauffeur bewaken — verlopen, 14, 30 en 60 dagen' },
      { every: 'week', who: 'ara-fleet-tech', text: 'Onderhoudsinterval tegen de kilometerstand houden en garagepunten volgen tot afmelding' },
      { every: 'week', who: 'ara-fleet-cost', text: 'Kosten per kilometer per voertuig volgen en uitschieters markeren' },
      { every: 'dag', who: 'ara-trailer-manager', text: 'Beschikbaarheid van trailers bewaken: tekorten, stilstand en scheefstand tussen locaties' },
      { every: 'maand', who: 'ara-data-engineer', text: 'Schema en migraties tegen de code leggen: ontbrekende index op wat dagelijks bevraagd wordt, kolommen die de code leest maar het schema niet kent — getest op een kopie, nooit op productie' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het wagenparkwerk dat deze week op done ging: typecheck en integriteitscheck zelf draaien, diff naast de opdracht' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de wagenpark-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs tegen de code leggen: commando\'s, paden, sync-scripts en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Repo, .env en Supabase-sleutels nalopen: een servicerol die schrijft waar lezen genoeg is, is hier de belangrijkste vondst' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan welke van de vijf wagenpark-bronnen al aangesloten is; voor de rest het inleesformaat klaarzetten (kenteken als werkplek-id, één voorbeeld-payload) en zonder bron niets pushen' },
    ],
    escalate: [
      'Schrijfacties op de productie-database',
      'Een voertuig administratief uit dienst nemen',
      'Alles wat de wettelijke keuringsstatus raakt, inclusief afspraken bij een keuringsstation',
      'Een voertuig of trailer huren, kopen of afstoten',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'dag', who: 'ara-market-analyst', text: 'Openstaande posities en risico aflezen uit wat de bot zelf wegschrijft' },
      { every: 'dag', who: 'ara-risk-guard', text: 'Blootstelling, drawdown en posities zonder stop toetsen aan de limieten' },
      { every: 'week', who: 'ara-trade-journal', text: 'Elke afgesloten trade in het journaal zetten en periodiek evalueren' },
      { every: 'week', who: 'ara-event-scout', text: 'De agenda voor de komende dagen nalopen op events die XAU/USD raken' },
      { every: 'week', who: 'ara-bot-maintainer', text: 'Afwijkingen tussen backtest en live signaleren; logging en storingen bewaken' },
      { every: 'week', who: 'ara-execution-trader', text: 'De keten zelf natrekken via GET /trade/state: modus, noodstop en of de limieten leesbaar zijn — een onbruikbaar limietenbestand is een storing, geen rustige week' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk dat deze week op done ging: checks zelf draaien en de diff tegen de opdracht leggen — een claim over een backtest wordt zelf nagedraaid' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de bot-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs tegen de code leggen: commando\'s, paden, omgevingsvariabelen, en elke belofte over automatisch gedrag die niet in de code aan te wijzen is' },
      { every: 'week', who: 'ara-security-auditor', text: 'Zoeken naar sleutels met handelsrechten in repo, historie en .env naast de bot — vindplaats melden, waarde nergens neerzetten' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of het statusbestand van de bot al aangesloten is; zo niet, het inleesformaat klaarzetten (instrument als werkplek-id, één voorbeeld-payload) en geen enkele stand pushen' },
    ],
    escalate: [
      'ELKE wijziging aan orderlogica, positiegrootte of stops',
      'ELKE aanraking van API-sleutels of broker-instellingen',
      'Alles wat een order kan plaatsen, wijzigen of annuleren',
      'Een positie sluiten of verkleinen, ook bij een overschreden risicolimiet',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'dag', who: 'ara-market-analyst', text: 'Bewaakte munten volgen op de afgesproken niveaus' },
      { every: 'week', who: 'ara-allocation-guard', text: 'Concentratie per munt en per sector toetsen aan de streefverdeling' },
      { every: 'week', who: 'ara-token-safety', text: 'Elke nieuwe munt langs de veiligheidscheck vóór hij op de volglijst komt' },
      { every: 'week', who: 'ara-narrative-scout', text: 'Volgen waar de aandacht heen gaat per sector, en wat juist uit beeld raakt' },
      { every: 'dag', who: 'ara-event-scout', text: 'On-chain signalen, unlocks en listings bij de portefeuille zoeken' },
      { every: 'week', who: 'ara-market-analyst', text: 'Setups documenteren met ingang, stop en doel — als voorstel, niet als order' },
      { every: 'week', who: 'ara-risk-guard', text: 'Blootstelling per munt en drawdown sinds de laatste top toetsen aan de limieten; ontbreekt de positiebron, meld dat als storing in plaats van een getal' },
      { every: 'week', who: 'ara-trade-journal', text: 'Wat er volgens het logboek van de bot is afgesloten in het journaal zetten met aanleiding en uitkomst in R; is er geen logboek, dan is dát de melding' },
      { every: 'week', who: 'ara-execution-trader', text: 'De keten zelf natrekken via GET /trade/state: modus, noodstop en of de limieten leesbaar zijn — zonder positiebron dient hij niets in' },
      { every: 'week', who: 'ara-web-scout', text: 'Publieke koersen van de volglijst ophalen bij CoinGecko en per munt vastleggen met tijdstip en bron — beschrijft, voorspelt niet' },
      { every: 'week', who: 'ara-reporter', text: 'De opgehaalde koersen per munt-bureau pushen (POST /office/crypto/station), id\'s exact gelijk aan offices.crypto; een munt zonder bron krijgt geen stand' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het crypto-werk dat deze week op done ging: checks zelf draaien en nagaan of elke setup een bron met tijdstip heeft' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de crypto-desk-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de crypto-desk tegen de code leggen: commando\'s, paden, endpoints en omgevingsvariabelen die niet meer kloppen' },
      { every: 'week', who: 'ara-security-auditor', text: 'Zoeken naar exchange-sleutels en seed phrases in repo, historie en configuratie — vindplaats melden, waarde nergens neerzetten' },
    ],
    escalate: [
      'ELKE wijziging aan orderlogica of positiegrootte',
      'ELKE aanraking van exchange-sleutels',
      'Elke handeling die geld verplaatst',
      'Een positie sluiten of verkleinen, ook bij een overschreden risicolimiet',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'week', text: 'Lopende campagnes en deliverables bijhouden' },
      { every: 'week', who: 'ara-designer', text: 'Assets consistent houden met de huisstijl van de klant' },
      { every: 'week', who: 'ara-site-watch', text: 'Klantsites periodiek nalopen op gebroken links, trage pagina\'s en SEO-gebreken' },
      { every: 'week', who: 'ara-copywriter', text: 'Per lopend deliverable twee tekstvarianten als concept in drafts/ klaarzetten, met de vraag waarop ze antwoord geven — niets gaat naar een klantkanaal' },
      { every: 'maand', who: 'ara-social-scheduler', text: 'Contentkalender per klant voor de komende maand als concept in drafts/ opstellen: onderwerp, kanaal en datum per item — plaatst niets' },
      { every: 'maand', who: 'ara-web-scout', text: 'Referenties verzamelen bij de thema\'s die in de bordtaken van deze tak langskomen: link, datum en waarom het opvalt — beoordeelt niet' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk dat deze week op done ging: build zelf draaien en de screenshot naast de opdracht leggen' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de design-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de design-repo tegen de code leggen: commando\'s, paden en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Repo en configuratie nalopen op sleutels van klantomgevingen en op assets met onbekende herkomst — met bewijs, zonder de waarde te tonen' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of de opdrachtenlijst en de sitelijst al aangesloten zijn; zo niet, het inleesformaat klaarzetten (deliverable als werkplek-id, één voorbeeld-payload) en geen enkele stand pushen' },
    ],
    escalate: [
      'Publiceren naar productie van een klant, of naar een kanaal, mail of advertentie',
      'Uitgaven aan advertenties, stockmateriaal, licenties of tooling',
      'Beeld gebruiken waarvan de herkomst onbekend is',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'dag', who: 'ara-booking-watch', text: 'Aanvragen volgen: niets langer dan 24 uur onbeantwoord' },
      { every: 'dag', who: 'ara-booking-watch', text: 'Agenda bewaken op dubbele boekingen en op verkoopbare gaten' },
      { every: 'week', who: 'ara-studio-producer', text: 'Site en boekingsflow werkend houden, boekingsflow altijd eerst op staging' },
      { every: 'maand', who: 'ara-studio-producer', text: 'Audio-tooling onderhouden' },
      { every: 'week', who: 'ara-worker', text: 'Openstaande sitetaken van de vloer oppakken op een branch met groene checks; alles wat de boekingsflow raakt blijft op staging staan' },
      { every: 'week', who: 'ara-site-watch', text: 'Site nalopen op gebroken links, trage pagina\'s en ontbrekende meta — repareert niets zelf' },
      { every: 'maand', who: 'ara-copywriter', text: 'Site- en boekingsteksten als concept bijwerken in drafts/, in twee varianten — publiceert niets' },
      { every: 'maand', who: 'ara-social-scheduler', text: 'Contentkalender van de studio voor de komende maand als concept in drafts/ opstellen: onderwerp, kanaal en datum per item — plaatst niets' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk dat deze week op done ging: build en de boekingsflow op staging zelf draaien, diff naast de opdracht' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de studio-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de studiosite tegen de code leggen: commando\'s, paden, endpoints en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Repo en configuratie nalopen op sleutels van de boekingsbackend en op formulier-endpoints zonder rate limit — met bewijs, zonder de waarde te tonen' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of de agenda- en aanvragenbron al aangesloten zijn; zo niet, het inleesformaat klaarzetten (sessie of boeking als werkplek-id, één voorbeeld-payload) en geen enkele stand pushen' },
    ],
    escalate: [
      'Productie-deploy van de boekingsflow zelf',
      'Een boeking bevestigen, verzetten of annuleren',
      'Contact met een klant, in welke vorm dan ook',
      'Uitgaven aan tooling of hosting',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'week', who: 'ara-release-manager', text: 'Releaseplanning bijhouden en het pakket compleet maken tot aan de knop' },
      { every: 'week', who: 'ara-release-manager', text: 'Metadata driemaal controleren: credits, schrijvers, ISRC, releasedatum' },
      { every: 'week', who: 'ara-site-watch', text: 'Site en streaminglinks actueel houden, zeker rond een releasedatum' },
      { every: 'week', who: 'ara-web-scout', text: 'Promotiekanalen volgen: welke playlists, blogs en kanalen passen bij het lopende werk — link, datum en waarom, zonder inschatting van de kans' },
      { every: 'maand', who: 'ara-copywriter', text: 'Release- en promotieteksten als concept in drafts/ klaarzetten, in twee varianten — publiceert niets' },
      { every: 'maand', who: 'ara-social-scheduler', text: 'Contentkalender rond de releaseplanning als concept in drafts/ opstellen: onderwerp, kanaal en datum per item — plaatst niets' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk dat deze week op done ging: build en linkcontrole zelf draaien, diff naast de opdracht' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de release-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de release-repo tegen de code leggen: commando\'s, paden en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Repo en configuratie nalopen op distributeur- en platformsleutels — een sleutel die een release kan uitbrengen hoort hier niet te staan' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of de distributeur-export al aangesloten is; zo niet, het inleesformaat klaarzetten (track als werkplek-id, één voorbeeld-payload) en geen enkele stand pushen' },
    ],
    escalate: [
      'Een release daadwerkelijk uitbrengen bij een distributeur of platform',
      'Een releasedatum vastleggen of verzetten',
      'Contact met een label, playlist of platform namens de gebruiker',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'week', who: 'ara-equity-analyst', text: 'These per positie actueel houden en het breekpunt expliciet benoemen' },
      { every: 'week', who: 'ara-earnings-watch', text: 'Kwartaalagenda en dividenddata van portefeuille en volglijst bijhouden' },
      { every: 'week', who: 'ara-allocation-guard', text: 'Weging per naam en per sector toetsen aan de streefverdeling' },
      { every: 'week', who: 'ara-execution-trader', text: 'Voorstellen indienen via de risicomotor — nooit daarbuiten om' },
      { every: 'week', who: 'ara-trade-journal', text: 'Elke aan- en verkoop in het journaal zetten met de these die eronder lag' },
      { every: 'week', who: 'ara-risk-guard', text: 'Blootstelling per naam en per sector en de drawdown toetsen aan trading-limits.json; is dat bestand onbruikbaar, meld het als storing — het valt dan terug op de strengste stand' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk dat deze week op done ging: checks zelf draaien en nagaan of elke these een bron met datum heeft' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de aandelen-repo bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van de aandelen-tak tegen de code leggen: commando\'s, paden, endpoints en omgevingsvariabelen die niet meer kloppen' },
      { every: 'week', who: 'ara-security-auditor', text: 'Zoeken naar broker-sleutels in repo, historie en configuratie — vindplaats melden, waarde nergens neerzetten' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan of de broker-export al aangesloten is; zo niet, het inleesformaat klaarzetten (ticker als werkplek-id, één voorbeeld-payload) en geen enkele stand pushen' },
    ],
    escalate: [
      'ELKE order buiten de risicomotor om',
      'ELKE wijziging aan trading-limits.json, de modus of de noodstop',
      'ELKE aanraking van broker-sleutels of rekeninginstellingen',
      'Geld storten, opnemen of overboeken',
      'Een positie sluiten zonder dat daar een eigen besluit met reden aan ten grondslag ligt',
      'Een branch mergen of rechtstreeks naar main pushen',
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
      { every: 'dag', who: 'ara-worker', text: 'Openstaande bordtaken van deze tak afwerken' },
      { every: 'maand', who: 'ara-security-auditor', text: 'Periodiek nalopen op uitgelekte secrets en kwetsbare dependencies' },
      { every: 'week', who: 'ara-qa-verifier', text: 'Steekproef op het werk van deze tak dat deze week op done ging: de checks van het project zelf draaien en de diff tegen de opdracht leggen' },
      { every: 'maand', who: 'ara-dependency-warden', text: 'Kwetsbare en achterlopende pakketten in de repo van deze tak bijwerken, één bump per commit op een branch met groene checks — niet mergen' },
      { every: 'maand', who: 'ara-doc-writer', text: 'Docs van deze tak tegen de code leggen: commando\'s, paden, poorten en omgevingsvariabelen die niet meer kloppen' },
      { every: 'maand', who: 'ara-web-scout', text: 'Opzoekwerk dat op het bord blijft liggen oppakken: per vraag bron, datum en wat er staat — beoordeelt niet' },
      { every: 'maand', who: 'ara-reporter', text: 'Nagaan welke bron deze tak zou kunnen voeden; zonder bron geen stand, en dat is dan de melding' },
    ],
    escalate: [
      'Alles wat naar buiten gaat, geld kost of onomkeerbaar is',
      'Een branch mergen of rechtstreeks naar main pushen',
    ],
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
    // De eigenaar staat erbij, anders leest een manager zijn hele playbook als
    // eigen werk — precies de situatie waarin tien rollen stilzaten.
    `Terugkerend werk (achter elke taak staat wie hem doet; "jij" is werk dat je zelf oppakt): ${playbook.duties
      .map((d) => `${d.text} (${d.every}, ${d.who ?? 'jij'})`)
      .join('; ')}.`,
    `ALTIJD escaleren (taak failed met "ESCALATE: …"): ${playbook.escalate.join('; ')}.`,
    `Valideer vóór done: ${playbook.checks.join(', ')}.`,
  ];
  // Een aangesloten bron reist mee mét zijn plek: anders weet de rol wel dát
  // er data is, maar niet waar — en gaat hij zelf zoeken of verzinnen.
  const connected = playbook.dataSources.filter((d) => d.configured);
  if (connected.length > 0) {
    lines.push(`Aangesloten databronnen (lees deze, verzin niets ernaast): ${connected
      .map((d) => `${d.label} (${d.how})`)
      .join('; ')}.`);
  }
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
