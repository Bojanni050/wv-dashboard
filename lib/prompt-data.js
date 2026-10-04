// Shapes GA4 analytics data into the JSON handed to the AI for the report
// intros and the action-items reports, so all of them describe the same
// figures the same way.
function buildPromptData(data, ranges, googleAds) {
  const k = data.kpis;
  const kpi = (key) => ({ huidigePeriode: k[key].current, vorigePeriode: k[key].previous, veranderingPct: k[key].change });
  return {
    periode: { van: ranges.current.start, tot: ranges.current.end },
    vergelijkingsperiode: { van: ranges.previous.start, tot: ranges.previous.end },
    sessies: kpi('sessions'),
    gebruikers: kpi('users'),
    paginaweergaven: kpi('pageviews'),
    offerteaanvragen: kpi('offertes'),
    bezoekersViaPaidAds: kpi('paidAds'),
    bezoekersViaSocial: kpi('social'),
    bezoekersViaSearch: kpi('search'),
    bezoekersOverig: kpi('overig'),
    conversiePercentageTotaal: kpi('conversionTotal'),
    conversiePercentageBetaald: kpi('conversionPaid'),
    conversiePercentageSocial: kpi('conversionSocial'),
    gemiddeldeBezoekduurSeconden: kpi('avgSessionDuration'),
    paginasPerBezoek: kpi('pagesPerSession'),
    engagementPercentage: kpi('engagementRate'),
    bouncePercentage: kpi('bounceRate'),
    kanalen: data.channels.slice(0, 6),
    offertesPerPagina: data.offerteByPage.slice(0, 5),
    offertesPerCampagne: data.offerteByCampaign.slice(0, 5),
    populairstePaginas: (data.topPages || []).slice(0, 5),
    googleAdsHandmatigIngevuld: googleAds && googleAds.updatedAt ? googleAds : undefined,
  };
}

module.exports = { buildPromptData };
