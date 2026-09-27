// AI-written intro paragraph shared by the weekly and monthly site reports.
const ai = require('./ai');
const { nlDate } = require('./lib/dates');
const { cleanText, stripGreetings } = require('./lib/text');
const { buildPromptData } = require('./lib/prompt-data');

function systemPrompt(kind) {
  const cadence = kind === 'month' ? 'maandelijks' : 'wekelijks';
  return (
    'Je schrijft de inleiding van een ' + cadence + ' webstatistiekenrapport voor White Vision, een Nederlands bedrijf. ' +
    'De lezer is een ondernemer zonder technische achtergrond. Schrijf in helder, vriendelijk Nederlands, in de wij/jullie-vorm waar dat past. ' +
    'Leg in gewone woorden uit wat de cijfers van de afgelopen periode betekenen: wat gaat goed, wat valt op en wat is de belangrijkste les. ' +
    'Gebruik alleen de aangeleverde cijfers en verzin niets. Noem geen oorzaken die je niet uit de data kunt afleiden; formuleer die dan als mogelijke verklaring. ' +
    'Begin direct met de inhoud: geen aanhef (zoals "Beste" of "Hallo") en geen afsluitende groet, ondertekening of slotzin als "Met vriendelijke groet". ' +
    'Schrijf 120 tot 200 woorden in 2 tot 3 alinea\'s, zonder kopjes, opsommingstekens, markdown of emoji.'
  );
}

function fallbackIntro(kind, data, ranges) {
  const k = data.kpis;
  const periodWoord = kind === 'month' ? 'maand' : 'week';
  const dir = (c) => (c > 0 ? 'een stijging van ' + c + '%' : c < 0 ? 'een daling van ' + Math.abs(c) + '%' : 'gelijk gebleven');
  return (
    'Dit is het overzicht van de website van ' + nlDate(ranges.current.start) + ' tot en met ' + nlDate(ranges.current.end, true) + '. ' +
    'De site kreeg ' + k.sessions.current + ' sessies (' + dir(k.sessions.change) + ' ten opzichte van de ' + periodWoord + ' ervoor) ' +
    'en er zijn ' + k.offertes.current + ' offerteaanvragen binnengekomen (' + dir(k.offertes.change) + '). ' +
    'Hieronder vind je de details per kanaal, pagina en campagne.'
  );
}

// kind is 'week' or 'month'.
async function writeIntro(kind, data, ranges, googleAds) {
  const settings = ai.readSettings();
  try {
    const text = await ai.generateText(
      settings,
      systemPrompt(kind),
      'Cijfers als JSON:\n' + JSON.stringify(buildPromptData(data, ranges, googleAds), null, 2)
    );
    return { text: stripGreetings(cleanText(text)), ai: true };
  } catch (err) {
    console.error((kind === 'month' ? 'Monthly' : 'Weekly') + ' report AI intro failed, using fallback:', err.message);
    return { text: fallbackIntro(kind, data, ranges), ai: false, error: err.message };
  }
}

module.exports = { writeIntro };
