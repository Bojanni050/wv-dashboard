'use strict';

// Planning, campagnes en takenlijst voor de tab Planning. Nu gevuld met de winteractie (25% korting op feestdata in
// januari t/m maart 2027). Handmatig bijgehouden: pas dit bestand aan en
// deploy opnieuw. Live cijfers (klikken, kosten) staan op de tab Google Ads.
//
// type (planning): live | run | task | check | decide | party
// tasks hebben een vast `id`; de status van een taak kan in het dashboard door
// een admin worden omgezet (Open/Gedaan) en wordt dan opgeslagen in data/.
// status: Actief | Gepauzeerd (campagnes); Gedaan | Bezig | Gepland | Open (rest)

module.exports = {
  title: 'Winteractie 2027',
  updated: '2026-11-18',
  campaigns: [
    {
      name: 'Winteractie Bruiloft DJ 2027',
      status: 'Actief',
      dailyBudget: 15,
      maxCpc: null,
      focus: 'Bruiloften jan t/m mrt. Sinds 10 okt: 314 klikken, € 406, 0 conversies in Ads',
      structure: '2 actieve advertentiegroepen (Algemeen, Winterbruiloft), 4 plaatsgroepen gepauzeerd. Conversies maximaliseren, AI Max uit, geen CPC-plafond',
    },
    {
      name: 'Bedrijfsfeest DJ Q1 2027',
      status: 'Actief',
      dailyBudget: 15,
      maxCpc: null,
      focus: 'Bedrijfsfeesten, personeelsfeesten, nieuwjaarsborrels. Sinds 10 okt: 278 klikken, € 308, 0 conversies in Ads',
      structure: '1 advertentiegroep. Conversies maximaliseren, AI Max uit, geen CPC-plafond',
    },
    {
      name: 'Merk - White Vision',
      status: 'Gepauzeerd',
      dailyBudget: 5,
      maxCpc: null,
      focus: 'Zoekopdrachten op de merknaam. 18 klikken, € 10 voor de pauze',
      structure: 'Handmatige CPC',
    },
    {
      name: 'Photobooth - White Vision',
      status: 'Gepauzeerd',
      dailyBudget: 10,
      maxCpc: 1.5,
      focus: 'Mikt op losse photobooth, die niet los te boeken is. Alleen terug als combinatie met DJ-show',
      structure: 'Klikken maximaliseren, alles gepauzeerd',
    },
  ],
  plan: [
    { title: 'Campagnes live', start: '2026-10-10', end: '2026-10-10', type: 'live', status: 'Gedaan' },
    { title: 'Looptijd campagnes', start: '2026-10-10', end: '2027-03-31', type: 'run', status: 'Bezig' },
    { title: 'Conversie gforms_submission importeren', start: '2026-10-10', end: '2026-10-10', type: 'task', status: 'Gedaan' },
    { title: 'Handmatige CPC en 34 extra zoekwoorden', start: '2026-10-17', end: '2026-10-17', type: 'task', status: 'Gedaan' },
    { title: 'Biedingen verhoogd naar eerste-paginaniveau', start: '2026-10-19', end: '2026-10-19', type: 'task', status: 'Gedaan' },
    { title: 'Eerste check: zoektermen en bod', start: '2026-10-19', end: '2026-10-22', type: 'check', status: 'Gedaan' },
    { title: 'Zoekwoordbeleid en patroon-uitsluitingen', start: '2026-11-03', end: '2026-11-03', type: 'task', status: 'Gedaan' },
    { title: 'Formulieren over naar Fluent Forms', start: '2026-11-03', end: '2026-11-04', type: 'task', status: 'Gedaan' },
    { title: 'Proef Conversies maximaliseren + AI Max, vertoningen zakten in', start: '2026-11-06', end: '2026-11-08', type: 'decide', status: 'Gedaan' },
    { title: 'AI Max uit, budget € 15 per campagne', start: '2026-11-09', end: '2026-11-09', type: 'task', status: 'Gedaan' },
    { title: 'Campagne Live acts verwijderd', start: '2026-11-11', end: '2026-11-11', type: 'task', status: 'Gedaan' },
    { title: 'Aanbeveling: CPC-plafond € 2,50 verwijderd', start: '2026-11-17', end: '2026-11-17', type: 'task', status: 'Gedaan' },
    { title: 'Beslissen: biedstrategie zonder conversiemeting', start: '2026-11-19', end: '2026-11-20', type: 'decide', status: 'Gepland' },
    { title: 'Wekelijkse zoektermencheck (ma)', start: '2026-11-23', end: '2026-11-23', type: 'check', status: 'Gepland' },
    { title: 'Conversiemeting in Ads werkend', start: '2026-11-19', end: '2026-11-30', type: 'task', status: 'Gepland' },
    { title: 'Feestdata met winterkorting', start: '2027-01-01', end: '2027-03-31', type: 'party', status: 'Gepland' },
  ],
  tasks: [
    { id: 'campagnes-aangemaakt', title: 'Campagnes bruiloft en bedrijfsfeest aangemaakt', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'bedrijven-advertentie', title: 'Winterkorting-advertentie voor bedrijven live', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'pmax-budgetten', title: 'PMax Bruiloft gepauzeerd (inmiddels verwijderd), budgetten verhoogd', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'ga4-gekoppeld', title: 'GA4 gekoppeld aan Google Ads', owner: 'Bo', due: '2026-10-10', status: 'Gedaan' },
    { id: 'conversie-geimporteerd', title: 'gforms_submission importeren als conversie (Eén, primair)', owner: 'Bo', due: '2026-10-10', status: 'Gedaan' },
    { id: 'handmatige-cpc', title: 'Handmatige CPC, extra zoekwoorden en uitsluitwoorden ingesteld', owner: 'Claude', due: '2026-10-17', status: 'Gedaan' },
    { id: 'biedingen-verhoogd', title: 'Biedingen per zoekwoord verhoogd, dagbudget €20 en €5', owner: 'Claude', due: '2026-10-19', status: 'Gedaan' },
    { id: 'zoekwoordbeleid', title: 'Zoekwoordbeleid vastgelegd, patroon-uitsluitingen in beide DJ-campagnes', owner: 'Claude', due: '2026-11-03', status: 'Gedaan' },
    { id: 'ai-max-uit', title: 'AI Max en tekst-/URL-automatisering uit, budget €15 per DJ-campagne', owner: 'Claude', due: '2026-11-09', status: 'Gedaan' },
    { id: 'live-acts-verwijderd', title: 'Campagne Live acts verwijderd (losse acts niet te boeken)', owner: 'Bo', due: '2026-11-11', status: 'Gedaan' },
    { id: 'key-events', title: 'generate_lead en offerte_form_succes uit key events halen', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'ip-gtm', title: 'Eigen IP uitsluiten, GTM-trigger controleren', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'strato-adcoach', title: 'Strato AdCoach-campagne stoppen', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'regel-bedrijven', title: 'Regel voor bedrijven bovenaan /winteractie/', owner: 'Bo', due: '2026-10-17', status: 'Open' },
    { id: 'goedkeuring-zoektermen', title: 'Goedkeuring advertenties en zoektermen controleren', owner: 'Bo', due: '2026-10-17', status: 'Open' },
    { id: 'keywords-verwijderen', title: '21 gepauzeerde zoekwoorden verwijderen', owner: 'Bo', due: '2026-10-20', status: 'Open' },
    { id: 'biedstrategie-plafond', title: 'Biedstrategie kiezen: Conversies maximaliseren zonder CPC-plafond werkt niet zolang Ads 0 conversies ziet', owner: 'Bo', due: '2026-11-20', status: 'Open' },
    { id: 'conversiemeting-ads', title: 'Conversie Offerte aanvragen (Fluent Forms) laten tellen in Ads, nu nog 0', owner: 'Bo', due: '2026-11-30', status: 'Open' },
  ],
};
