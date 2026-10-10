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
  updated: '2026-10-10',
  campaigns: [
    {
      name: 'Winteractie Bruiloft DJ 2027',
      status: 'Actief',
      dailyBudget: 12,
      maxCpc: 1,
      focus: 'Bruiloften jan t/m mrt, Utrecht en Amersfoort',
      structure: '2 advertentiegroepen, 2 advertenties',
    },
    {
      name: 'Bedrijfsfeest DJ Q1 2027',
      status: 'Actief',
      dailyBudget: 4,
      maxCpc: 1,
      focus: 'Bedrijfsfeesten, personeelsfeesten, nieuwjaarsborrels',
      structure: '1 advertentiegroep, 2 advertenties',
    },
    {
      name: 'PMax Bruiloft',
      status: 'Gepauzeerd',
      dailyBudget: 16.16,
      maxCpc: null,
      focus: 'Performance Max, 0 klikken in 30 dagen',
      structure: 'Assetgroep',
    },
  ],
  plan: [
    { title: 'Campagnes live', start: '2026-10-10', end: '2026-10-10', type: 'live', status: 'Gedaan' },
    { title: 'Looptijd campagnes', start: '2026-10-10', end: '2027-03-31', type: 'run', status: 'Bezig' },
    { title: 'Conversie gforms_submission importeren', start: '2026-10-10', end: '2026-10-10', type: 'task', status: 'Gedaan' },
    { title: 'Eerste check: zoektermen en bod', start: '2026-10-17', end: '2026-10-20', type: 'check', status: 'Gepland' },
    { title: 'Beslismoment bod en bidstrategie', start: '2026-11-02', end: '2026-11-08', type: 'decide', status: 'Gepland' },
    { title: 'Feestdata met winterkorting', start: '2027-01-01', end: '2027-03-31', type: 'party', status: 'Gepland' },
  ],
  tasks: [
    { id: 'campagnes-aangemaakt', title: 'Campagnes bruiloft en bedrijfsfeest aangemaakt', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'bedrijven-advertentie', title: 'Winterkorting-advertentie voor bedrijven live', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'pmax-budgetten', title: 'PMax Bruiloft gepauzeerd, budgetten verhoogd', owner: 'Claude', due: '2026-10-10', status: 'Gedaan' },
    { id: 'ga4-gekoppeld', title: 'GA4 gekoppeld aan Google Ads', owner: 'Bo', due: '2026-10-10', status: 'Gedaan' },
    { id: 'conversie-geimporteerd', title: 'gforms_submission importeren als conversie (Eén, primair)', owner: 'Bo', due: '2026-10-10', status: 'Gedaan' },
    { id: 'key-events', title: 'generate_lead en offerte_form_succes uit key events halen', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'ip-gtm', title: 'Eigen IP uitsluiten, GTM-trigger controleren', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'strato-adcoach', title: 'Strato AdCoach-campagne stoppen', owner: 'Bo', due: '2026-10-14', status: 'Open' },
    { id: 'regel-bedrijven', title: 'Regel voor bedrijven bovenaan /winteractie/', owner: 'Bo', due: '2026-10-17', status: 'Open' },
    { id: 'goedkeuring-zoektermen', title: 'Goedkeuring advertenties en zoektermen controleren', owner: 'Bo', due: '2026-10-17', status: 'Open' },
    { id: 'keywords-verwijderen', title: '21 gepauzeerde zoekwoorden verwijderen', owner: 'Bo', due: '2026-10-20', status: 'Open' },
  ],
};
