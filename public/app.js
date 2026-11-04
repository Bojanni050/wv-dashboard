(function () {
  'use strict';

  let currentRange = '7';
  let currentCompare = 'previous';
  let currentCustomRange = null;
  let lineChart = null;
  let donutChart = null;
  let refreshTimer = null;
  let authHeader = sessionStorage.getItem('wv_auth') || null;
  let booted = false;

  // --- Auth ---
  function lockUI() {
    document.body.classList.add('is-locked');
    document.getElementById('loginOverlay').hidden = false;
  }

  function unlockUI() {
    document.body.classList.remove('is-locked');
    document.getElementById('loginOverlay').hidden = true;
  }

  async function apiFetch(url, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (authHeader) headers.Authorization = authHeader;
    var res = await fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) {
      authHeader = null;
      sessionStorage.removeItem('wv_auth');
      lockUI();
    }
    return res;
  }

  async function boot() {
    unlockUI();
    if (booted) return;
    booted = true;
    fetchRole();
    load(currentRange, currentCompare, currentCustomRange);
    scheduleAutoRefresh();
  }

  async function tryBoot() {
    var res = await apiFetch('/api/me');
    if (res.ok) boot();
  }

  var RANGE_LABELS = { today: 'vandaag', yesterday: 'gisteren', '7': '7 dagen', '90': '90 dagen', month: 'deze maand' };
  var COMPARE_LABELS = { previous: 'vorige periode', year: 'zelfde periode vorig jaar' };

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // --- Formatting helpers ---
  function formatNumber(n) {
    return new Intl.NumberFormat('nl-NL').format(n);
  }

  function formatPct(n) {
    const sign = n > 0 ? '+' : '';
    return sign + n + '%';
  }

  function formatCurrency(n) {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
  }

  function formatConversion(n) {
    return n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  // Average session duration comes from GA4 in seconds; show it as m:ss.
  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(seconds));
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function formatPages(n) {
    return n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // Which direction is "good" for a tile. Bounce rate is inverted: a rise is bad.
  function changeClass(change, invert) {
    if (change > 0) return invert ? 'down' : 'up';
    if (change < 0) return invert ? 'up' : 'down';
    return 'neutral';
  }

  function formatChangeEl(el, change, invert) {
    if (change === null || change === undefined) {
      el.textContent = '';
      el.classList.remove('up', 'down', 'neutral');
      return;
    }
    el.textContent = formatPct(change) + ' vs ' + COMPARE_LABELS[currentCompare];
    el.classList.remove('up', 'down', 'neutral');
    el.classList.add(changeClass(change, invert));
  }

  // Sets a KPI tile's main value, with the previous-period value appended
  // in parentheses (colored to match the direction of change).
  function setKpiValue(elId, current, previous, change, formatFn, invert) {
    var el = document.getElementById(elId);
    var cls = changeClass(change, invert);
    el.innerHTML = escapeHtml(formatFn(current)) + ' <span class="kpi-prev ' + cls + '">(' + escapeHtml(formatFn(previous)) + ')</span>';
  }

  function shortDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  // --- Fetch data ---
  async function fetchAnalytics(range, compare, customRange) {
    var url = '/api/analytics?range=' + range + '&compare=' + compare;
    if (range === 'custom' && customRange) {
      url += '&start=' + customRange.start + '&end=' + customRange.end;
    }
    const res = await apiFetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  // --- Update KPIs ---
  function updateKPIs(data) {
    const k = data.kpis;

    setKpiValue('kpi-sessions', k.sessions.current, k.sessions.previous, k.sessions.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-sessions-change'), k.sessions.change);

    setKpiValue('kpi-users', k.users.current, k.users.previous, k.users.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-users-change'), k.users.change);

    setKpiValue('kpi-pageviews', k.pageviews.current, k.pageviews.previous, k.pageviews.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-pageviews-change'), k.pageviews.change);

    setKpiValue('kpi-offertes', k.offertes.current, k.offertes.previous, k.offertes.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-offertes-change'), k.offertes.change);

    setKpiValue('kpi-paidads', k.paidAds.current, k.paidAds.previous, k.paidAds.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-paidads-change'), k.paidAds.change);

    setKpiValue('kpi-paidads-ads', k.paidAds.current, k.paidAds.previous, k.paidAds.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-paidads-ads-change'), k.paidAds.change);

    setKpiValue('kpi-social', k.social.current, k.social.previous, k.social.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-social-change'), k.social.change);

    setKpiValue('kpi-search', k.search.current, k.search.previous, k.search.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-search-change'), k.search.change);

    setKpiValue('kpi-overig', k.overig.current, k.overig.previous, k.overig.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-overig-change'), k.overig.change);

    setKpiValue('kpi-forms-total', k.offertes.current, k.offertes.previous, k.offertes.change, formatNumber);
    formatChangeEl(document.getElementById('kpi-forms-total-change'), k.offertes.change);

    setKpiValue('kpi-conv-overig', k.conversionOverig.current, k.conversionOverig.previous, k.conversionOverig.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-overig-change'), k.conversionOverig.change);

    setKpiValue('kpi-conv-total', k.conversionTotal.current, k.conversionTotal.previous, k.conversionTotal.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-total-change'), k.conversionTotal.change);

    setKpiValue('kpi-conv-paid', k.conversionPaid.current, k.conversionPaid.previous, k.conversionPaid.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-paid-change'), k.conversionPaid.change);

    setKpiValue('kpi-conv-paid-ads', k.conversionPaid.current, k.conversionPaid.previous, k.conversionPaid.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-paid-ads-change'), k.conversionPaid.change);

    setKpiValue('kpi-conv-social', k.conversionSocial.current, k.conversionSocial.previous, k.conversionSocial.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-social-change'), k.conversionSocial.change);

    // Conversion per social platform
    ['facebook', 'instagram', 'linkedin'].forEach(function (p) {
      var s = data.socialPlatforms[p];
      setKpiValue('kpi-conv-' + p, s.conversion.current, s.conversion.previous, s.conversion.change, formatConversion);
      formatChangeEl(document.getElementById('kpi-conv-' + p + '-change'), s.conversion.change);
      document.getElementById('kpi-conv-' + p + '-detail').textContent =
        formatNumber(s.offertes) + ' offertes · ' + formatNumber(s.sessions) + ' sessies';
    });

    // Engagement
    setKpiValue('kpi-engagement-duration', k.avgSessionDuration.current, k.avgSessionDuration.previous, k.avgSessionDuration.change, formatDuration);
    formatChangeEl(document.getElementById('kpi-engagement-duration-change'), k.avgSessionDuration.change);

    setKpiValue('kpi-engagement-pages', k.pagesPerSession.current, k.pagesPerSession.previous, k.pagesPerSession.change, formatPages);
    formatChangeEl(document.getElementById('kpi-engagement-pages-change'), k.pagesPerSession.change);

    setKpiValue('kpi-engagement-rate', k.engagementRate.current, k.engagementRate.previous, k.engagementRate.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-engagement-rate-change'), k.engagementRate.change);

    setKpiValue('kpi-engagement-bounce', k.bounceRate.current, k.bounceRate.previous, k.bounceRate.change, formatConversion, true);
    formatChangeEl(document.getElementById('kpi-engagement-bounce-change'), k.bounceRate.change, true);

    // 'Vandaag' is nog niet compleet: GA4 verwerkt engagement-cijfers met vertraging
    var note = document.getElementById('partialDayNote');
    var grid = document.getElementById('engagementKpiGrid');
    if (note && grid) {
      note.hidden = !data.partialDay;
      grid.classList.toggle('is-provisional', !!data.partialDay);
      if (data.partialDay) {
        note.textContent =
          'Vandaag is nog niet compleet: GA4 verwerkt engagement-cijfers met vertraging, dus deze waarden zijn voorlopig.' +
          (data.compareUntilHour !== null && data.compareUntilHour !== undefined
            ? ' De vergelijking loopt tot ' + String(data.compareUntilHour + 1).padStart(2, '0') + ':00 van de vergelijkingsdag.'
            : '');
      }
    }
  }

  // --- Line chart ---
  function renderLineChart(data) {
    const ctx = document.getElementById('lineChart').getContext('2d');

    const labels = data.dailySessions.map(function (d) { return shortDate(d.date); });
    const currentData = data.dailySessions.map(function (d) { return d.sessions; });
    const prevData = data.dailySessionsPrev.map(function (d) { return d.sessions; });

    if (lineChart) lineChart.destroy();

    lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Deze periode',
            data: currentData,
            borderColor: '#c8a96b',
            backgroundColor: 'rgba(200, 169, 107, 0.1)',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#c8a96b',
            pointBorderColor: '#c8a96b',
            pointHoverRadius: 5,
          },
          {
            label: capitalize(COMPARE_LABELS[currentCompare]),
            data: prevData,
            borderColor: '#555',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.35,
            borderWidth: 1.5,
            borderDash: [5, 5],
            pointRadius: 2,
            pointBackgroundColor: '#555',
            pointBorderColor: '#555',
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#888',
              font: { family: 'DM Sans', size: 12 },
              padding: 16,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#121212',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            titleColor: '#e8e8e8',
            bodyColor: '#888',
            titleFont: { family: 'DM Sans', size: 13 },
            bodyFont: { family: 'DM Sans', size: 12 },
            padding: 12,
            cornerRadius: 8,
          },
        },
        scales: {
          x: {
            grid: { color: '#1e1e1e', drawBorder: false },
            ticks: { color: '#555', font: { family: 'DM Sans', size: 11 } },
          },
          y: {
            grid: { color: '#1e1e1e', drawBorder: false },
            ticks: {
              color: '#555',
              font: { family: 'DM Sans', size: 11 },
              beginAtZero: true,
            },
          },
        },
      },
    });
  }

  // --- Donut chart ---
  function renderDonutChart(data) {
    const ctx = document.getElementById('donutChart').getContext('2d');

    const labels = data.channels.map(function (c) { return c.channel; });
    const values = data.channels.map(function (c) { return c.sessions; });

    const palette = [
      '#c8a96b',
      '#8a7548',
      '#5a4a2e',
      '#e8d5a8',
      '#4a6670',
      '#6b8e9e',
      '#3a3a3a',
      '#7a7a7a',
      '#2a2a2a',
    ];

    if (donutChart) donutChart.destroy();

    donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map(function (_, i) { return palette[i % palette.length]; }),
            borderColor: '#121212',
            borderWidth: 2,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#888',
              font: { family: 'DM Sans', size: 12 },
              padding: 12,
              usePointStyle: true,
              boxWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: '#121212',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            titleColor: '#e8e8e8',
            bodyColor: '#888',
            titleFont: { family: 'DM Sans', size: 13 },
            bodyFont: { family: 'DM Sans', size: 12 },
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                var total = context.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                return context.label + ': ' + formatNumber(context.parsed) + ' (' + pct + '%)';
              },
            },
          },
        },
      },
    });
  }

  // --- Tables ---
  function renderRowsTable(bodyId, rows, labelKey, emptyMessage) {
    var body = document.getElementById(bodyId);

    if (!rows || rows.length === 0) {
      body.innerHTML = '<tr><td colspan="2" class="empty-row">' + emptyMessage + '</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map(function (r) {
        return '<tr><td>' + escapeHtml(r[labelKey]) + '</td><td>' + formatNumber(r.count) + '</td></tr>';
      })
      .join('');
  }

  function renderTable(data) {
    renderRowsTable('offerteTableBody', data.offerteByPage, 'page', 'Geen offerteaanvragen in deze periode');
    renderRowsTable('offerteChannelTableBody', data.offerteByChannel, 'channel', 'Geen offerteaanvragen in deze periode');
    renderRowsTable('offerteCampaignTableBody', data.offerteByCampaign, 'campaign', 'Geen offerteaanvragen via betaalde ads in deze periode');
    renderRowsTable('offerteCampaignTableBody-ads', data.offerteByCampaign, 'campaign', 'Geen offerteaanvragen via betaalde ads in deze periode');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Update last refreshed ---
  function updateLastRefreshed() {
    var now = new Date();
    var time = now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    document.querySelector('.last-updated').textContent = 'Laatst bijgewerkt: ' + time;
  }

  // --- AI explanation above the widgets ---
  // 7 days / this month: written automatically by the server. Other ranges: on-demand button.
  var AUTO_EXPLAIN_RANGES = ['7', 'month'];
  var explainSeq = 0;
  var explainCooldownTimer = null;

  function explainQuery() {
    var q = '?range=' + currentRange + '&compare=' + currentCompare;
    if (currentRange === 'custom' && currentCustomRange) {
      q += '&start=' + currentCustomRange.start + '&end=' + currentCustomRange.end;
    }
    return q;
  }

  function formatClock(iso) {
    return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  // BoBot flips up into view: the watch-checking version while the AI is writing,
  // the pointing version once the text is there. state: 'waiting' | 'ready' | null
  function setAvatar(state, replay) {
    var box = document.getElementById('aiExplain');
    var current = box.classList.contains('is-ready') ? 'ready' : box.classList.contains('is-waiting') ? 'waiting' : null;
    if (current === state && !replay) return;
    box.classList.remove('is-ready', 'is-waiting');
    void box.offsetWidth; // restart the CSS animation
    if (state) box.classList.add('is-' + state);
  }

  function setExplain(opts) {
    var box = document.getElementById('aiExplain');
    var textEl = document.getElementById('aiExplainText');
    var previousText = textEl.textContent;
    box.hidden = !opts;

    var state = !opts ? null : opts.waiting ? 'waiting' : !opts.loading && opts.text ? 'ready' : null;
    setAvatar(state, state === 'ready' && previousText !== opts.text);

    if (!opts) return;
    textEl.textContent = opts.text || '';
    textEl.classList.toggle('is-loading', Boolean(opts.loading));
    document.getElementById('aiExplainMeta').textContent = opts.meta || '';
    document.getElementById('aiExplainActions').hidden = !opts.button;
    if (opts.button) {
      var btn = document.getElementById('aiExplainBtn');
      btn.disabled = Boolean(opts.button.disabled);
      btn.textContent = opts.button.label;
      document.getElementById('aiExplainHint').textContent = opts.button.hint || '';
    }
  }

  function manualButtonState(cooldownUntil) {
    if (explainCooldownTimer) clearTimeout(explainCooldownTimer);
    explainCooldownTimer = null;

    if (!cooldownUntil) {
      return { label: 'Verklaring vragen', hint: 'Kan 1x per 3 uur worden gebruikt.' };
    }
    var wait = new Date(cooldownUntil).getTime() - Date.now();
    if (wait > 0) {
      explainCooldownTimer = setTimeout(loadExplanation, Math.min(wait + 1000, 2147483000));
    }
    return { label: 'Verklaring vragen', disabled: true, hint: 'Weer beschikbaar om ' + formatClock(cooldownUntil) + '.' };
  }

  async function loadExplanation() {
    if (document.getElementById('dashboardView').hidden) return;
    var seq = ++explainSeq;
    if (explainCooldownTimer) clearTimeout(explainCooldownTimer);

    if (AUTO_EXPLAIN_RANGES.indexOf(currentRange) !== -1) {
      setExplain({ text: 'De verklaring wordt geschreven…', loading: true, waiting: true });
    } else {
      setExplain(null);
    }

    try {
      var res = await apiFetch('/api/ai/explanation' + explainQuery(), { headers: { Accept: 'application/json' } });
      if (seq !== explainSeq) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== explainSeq) return;

      if (data.mode === 'unavailable') {
        setExplain(null);
      } else if (data.mode === 'auto') {
        setExplain(data.error
          ? { text: data.error, loading: true }
          : { text: data.text, meta: 'Geschreven om ' + formatClock(data.generatedAt) + ' · ververst om 06:00, 12:00 en 18:00' });
      } else {
        setExplain({
          text: data.text,
          meta: data.text && data.generatedAt ? 'Geschreven om ' + formatClock(data.generatedAt) : '',
          button: manualButtonState(data.cooldownUntil),
        });
      }
    } catch (err) {
      console.error('Explanation load error:', err);
      if (seq === explainSeq) setExplain(null);
    }
  }

  document.getElementById('aiExplainBtn').addEventListener('click', async function () {
    var seq = ++explainSeq;
    var btn = this;
    btn.disabled = true;
    document.getElementById('aiExplainHint').textContent = 'De verklaring wordt geschreven…';
    setAvatar('waiting');

    try {
      var res = await apiFetch('/api/ai/explanation' + explainQuery(), { method: 'POST' });
      var data = await res.json();
      if (seq !== explainSeq) return;

      if (res.status === 429) {
        setExplain({
          text: document.getElementById('aiExplainText').textContent,
          button: manualButtonState(data.cooldownUntil),
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Verklaring maken mislukt');

      setExplain({
        text: data.text,
        meta: 'Geschreven om ' + formatClock(data.generatedAt),
        button: manualButtonState(data.cooldownUntil),
      });
    } catch (err) {
      if (seq !== explainSeq) return;
      btn.disabled = false;
      document.getElementById('aiExplainHint').textContent = err.message;
      setAvatar(document.getElementById('aiExplainText').textContent ? 'ready' : null);
    }
  });

  // --- Main load ---
  var loadCounter = 0;

  async function load(range, compare, customRange) {
    currentRange = range;
    currentCompare = compare;
    currentCustomRange = range === 'custom' ? customRange : null;

    document.getElementById('footerRange').textContent =
      range === 'custom' && customRange
        ? shortDate(customRange.start) + ' – ' + shortDate(customRange.end)
        : RANGE_LABELS[range];
    document.getElementById('lineChartSubtitle').textContent = 'Deze periode vs. ' + COMPARE_LABELS[compare];

    var loadId = ++loadCounter;
    setLoading(true);

    try {
      var data = await fetchAnalytics(range, compare, customRange);
      updateKPIs(data);
      renderLineChart(data);
      renderDonutChart(data);
      renderTable(data);
      updateLastRefreshed();
      loadExplanation();
      // Keep the indicator up until the Google Ads figures are in too, but
      // only the newest load may switch it off.
      await loadGoogleAds(range, compare, customRange);
    } catch (err) {
      console.error('Load error:', err);
      var errorRow = '<tr><td colspan="2" class="empty-row">Fout bij laden van gegevens</td></tr>';
      document.getElementById('offerteTableBody').innerHTML = errorRow;
      document.getElementById('offerteChannelTableBody').innerHTML = errorRow;
      document.getElementById('offerteCampaignTableBody').innerHTML = errorRow;
      document.getElementById('offerteCampaignTableBody-ads').innerHTML = errorRow;
    } finally {
      if (loadId === loadCounter) setLoading(false);
    }
  }

  // Loading indicator: top bar + dimmed tiles, and a spinner on the active
  // period button, so a period/compare change visibly does something.
  function setLoading(on) {
    document.body.classList.toggle('is-loading', on);
    var root = document.getElementById('dashboardRoot');
    if (root) root.setAttribute('aria-busy', on ? 'true' : 'false');
    document.querySelectorAll('.period-btn[data-range]').forEach(function (b) {
      b.classList.toggle('is-busy', on && b.classList.contains('active'));
    });
  }

  // --- Widget info sidebar ---
  // Paragraphs are separated by a blank line (\n\n). A paragraph that starts
  // with one of INFO_LABELS gets that label in bold (see renderInfoBody).
  var widgetInfo = {
    sessions:
      'Wat het is: het aantal sessies, oftewel bezoeken, aan de website in de gekozen periode. Eén persoon kan meerdere sessies hebben.\n\n' +
      'Hoe het wordt berekend: Google Analytics 4 (GA4) telt een nieuwe sessie zodra iemand de site opent en er daarvoor minstens 30 minuten niets is gebeurd. Het cijfer komt rechtstreeks uit GA4.\n\n' +
      'Zo lees je het: dit is de belangrijkste maat voor hoeveel verkeer de site krijgt. Kijk naar de trend en niet naar één dag; in het weekend en in de avond schommelt het nu eenmaal.',
    users:
      'Wat het is: het aantal verschillende bezoekers (GA4 "totale gebruikers") dat de site in de gekozen periode heeft bezocht.\n\n' +
      'Hoe het wordt berekend: GA4 herkent een bezoeker aan een cookie op het apparaat. Dezelfde persoon op telefoon én laptop telt dus als twee gebruikers, en iemand die cookies weigert wordt niet altijd gevolgd.\n\n' +
      'Zo lees je het: het aantal gebruikers is lager dan of gelijk aan het aantal sessies. Is het verschil groot, dan komen bezoekers vaker terug.',
    pageviews:
      'Wat het is: het totale aantal bekeken pagina’s in de gekozen periode.\n\n' +
      'Hoe het wordt berekend: elke keer dat een pagina wordt geladen, telt als één weergave. Dezelfde pagina meerdere keren bekijken telt dus meerdere keren.\n\n' +
      'Zo lees je het: deel het cijfer door het aantal sessies en je krijgt het aantal pagina’s per sessie. Dat zie je ook in de tegel "Pagina’s per sessie".',
    offertes:
      'Wat het is: het aantal sessies waarin een offerteaanvraag is ingediend.\n\n' +
      'Hoe het wordt berekend: het dashboard telt per sessie maximaal één inzending, omdat de formulier-events soms meerdere keren vuren. Welk GA4-event telt, hangt van de periode af: tot en met 14 september 2026 "form_submit", van 15 september tot en met 3 november "gforms_submission" (Gravity Forms) en vanaf 4 november "generate_lead" (Fluent Forms). Testinzendingen met "form_submit" tellen na 14 september niet meer mee.\n\n' +
      'Let op: soms registreert GA4 een inzending zonder sessie. Zo’n inzending telt toch als 1. Een inzending die GA4 helemaal niet heeft ontvangen, is handmatig toegevoegd (3 november, Paid Search); die staat in de lijst met handmatige conversies in de code.\n\n' +
      'Zo lees je het: het zijn aanvragen, geen omzet. Kleine aantallen schommelen sterk; één aanvraag meer of minder verandert het percentage al flink.',
    paidAds:
      'Wat het is: het aantal sessies via betaalde advertenties.\n\n' +
      'Hoe het wordt berekend: elk GA4-standaardkanaal waarvan de naam met "Paid" begint telt mee, zoals Paid Search en Paid Social. GA4 bepaalt het kanaal aan de hand van de herkomst van de bezoeker (UTM-tags of de automatische Google Ads-tag).\n\n' +
      'Zo lees je het: wijkt dit sterk af van het aantal klikken in Google Ads, dan liggen daar vaak de oorzaken: bezoekers die de pagina verlaten voordat GA4 laadt, adblockers en geweigerde cookies. Een klein verschil is normaal.',
    social:
      'Wat het is: het aantal sessies via organisch social verkeer (GA4-kanaal "Organic Social"), dus niet via betaalde social-advertenties.\n\n' +
      'Hoe het wordt berekend: GA4 rekent bezoekers uit sociale netwerken, zoals Facebook, Instagram en LinkedIn, tot dit kanaal als ze niet via een advertentie kwamen.\n\n' +
      'Zo lees je het: bezoeken via Instagram-verhalen of in-app browsers worden soms als "Direct" of onder een andere bron gezet, dus dit cijfer kan lager uitvallen dan wat je in de app zelf ziet.',
    search:
      'Wat het is: het aantal sessies via gewone (niet betaalde) zoekresultaten, vooral Google (GA4-kanaal "Organic Search").\n\n' +
      'Hoe het wordt berekend: bezoekers die op een zoekresultaat klikken, tellen hier mee. Zoekadvertenties zitten er niet in; die staan onder betaalde advertenties.\n\n' +
      'Zo lees je het: een stijging betekent meestal dat de site beter vindbaar is geworden. Het reageert traag op wijzigingen, dus kijk naar een langere periode.',
    overig:
      'Wat het is: het aantal sessies via alle overige kanalen.\n\n' +
      'Hoe het wordt berekend: onder Overig vallen Direct (iemand typt het adres in of komt uit een bladwijzer), Referral (een link op een andere site), Organic Video en verkeer dat GA4 niet kan indelen ("Unassigned").\n\n' +
      'Zo lees je het: een groot aandeel Direct kan ook verkeer zijn waarvan de herkomst niet is bijgehouden, bijvoorbeeld uit WhatsApp of e-mail zonder UTM-tags.',
    conversionTotal:
      'Wat het is: het percentage bezoekers dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: aantal offerteaanvragen gedeeld door het totale aantal gebruikers (niet sessies) in dezelfde periode, afgerond op één decimaal.\n\n' +
      'Zo lees je het: dit is een ruwe maat. Een deel van de gebruikers komt alleen voor informatie en wil geen offerte. Het cijfer is vooral nuttig om periodes met elkaar te vergelijken.',
    conversionPaid:
      'Wat het is: het percentage bezoekers via betaalde advertenties dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: sessies met een offerteaanvraag via betaalde kanalen gedeeld door alle sessies via betaalde kanalen. Per sessie telt een inzending maximaal één keer.\n\n' +
      'Welk event telt: voor 15 september 2026 "form_submit" (per sessie ontdubbeld), tot en met 3 november "gforms_submission", vanaf 4 november "generate_lead" (Fluent Forms).\n\n' +
      'Zo lees je het: dit zegt hoe goed advertentieverkeer omzet in aanvragen. Bij weinig sessies is het percentage onbetrouwbaar; een hoog percentage met 3 sessies zegt niet veel.',
    formsTotal:
      'Wat het is: het totale aantal ingediende formulieren (offerteaanvragen) in de gekozen periode.\n\n' +
      'Hoe het wordt berekend: dit is hetzelfde cijfer als "Offertes" bovenaan. Het is ontdubbeld per sessie: meerdere events binnen dezelfde sessie tellen als één aanvraag.\n\n' +
      'Let op: het zijn alleen aanvragen die in GA4 zijn aangekomen, plus de handmatig toegevoegde conversie van 3 november. Een inzending die de tracking mist, ontbreekt hier. Je vindt ze ook in het formulierbeheer op WordPress.',
    conversionOverig:
      'Wat het is: het percentage bezoekers via overige kanalen (Direct, Referral, Organic Video en niet-geclassificeerd) dat een formulier heeft ingediend.\n\n' +
      'Hoe het wordt berekend: sessies met een ingediend formulier via deze kanalen gedeeld door alle sessies via deze kanalen.\n\n' +
      'Zo lees je het: bij Direct zitten vaak terugkerende bezoekers en klanten, dus dit percentage kan hoger of juist lager zijn dan bij betaald verkeer.',
    conversionSocial:
      'Wat het is: het percentage bezoekers via organisch social dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: offerteaanvragen via het kanaal Organic Social gedeeld door de sessies via Organic Social.\n\n' +
      'Zo lees je het: social levert meestal veel bezoekers met weinig aanvragen. Let op kleine aantallen: één aanvraag verandert het percentage meteen sterk.',
    conversionFacebook:
      'Wat het is: het percentage bezoekers vanuit Facebook (organisch) dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: aanvragen via Organic Social met een bron die "facebook" bevat (zoals "facebook" of "l.facebook.com") of "fb", gedeeld door de sessies met die bron.\n\n' +
      'Zo lees je het: kijk vooral naar de trend over meerdere weken; bij een paar sessies per dag is het percentage onbetrouwbaar.',
    conversionInstagram:
      'Wat het is: het percentage bezoekers vanuit Instagram (organisch) dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: aanvragen via Organic Social met een bron die "instagram" bevat of "ig" is, gedeeld door de sessies met die bron.\n\n' +
      'Zo lees je het: bezoeken uit de Instagram-app komen niet altijd met de juiste bron binnen, dus het kan een deel van het echte verkeer missen.',
    conversionLinkedin:
      'Wat het is: het percentage bezoekers vanuit LinkedIn (organisch) dat een offerteaanvraag heeft ingediend.\n\n' +
      'Hoe het wordt berekend: aanvragen via Organic Social met een bron die "linkedin" bevat of "lnkd.in" is, gedeeld door de sessies met die bron.\n\n' +
      'Zo lees je het: het verkeer vanuit LinkedIn is klein, dus één aanvraag maakt het percentage al heel hoog.',
    avgSessionDuration:
      'Wat het is: hoe lang een bezoeker gemiddeld op de site blijft per sessie, in minuten:seconden.\n\n' +
      'Hoe het wordt berekend: GA4 berekent de duur uit het tijdsverschil tussen het eerste en het laatste event van de sessie (averageSessionDuration). Een bezoek waarin maar één moment is gemeten, telt als 0 seconden.\n\n' +
      'Zo lees je het: een langere duur is meestal goed, maar een korte duur is niet per se slecht, bijvoorbeeld als iemand snel het telefoonnummer vindt.',
    pagesPerSession:
      'Wat het is: het gemiddelde aantal pagina’s dat een bezoeker per sessie bekijkt.\n\n' +
      'Hoe het wordt berekend: het totale aantal paginaweergaven gedeeld door het aantal sessies (GA4 screenPageViewsPerSession).\n\n' +
      'Zo lees je het: een hoger getal betekent dat bezoekers meer rondkijken. Dat is positief als het gaat om het zoeken naar informatie, maar kan ook betekenen dat bezoekers moeite hebben om iets te vinden.',
    engagementRate:
      'Wat het is: het percentage sessies waarin de bezoeker echt iets met de site doet.\n\n' +
      'Hoe het wordt berekend: een sessie telt als "betrokken" als hij langer dan 10 seconden actief was, een conversie bevat (zoals een formulierinzending) of minstens 2 paginaweergaven heeft.\n\n' +
      'Zo lees je het: hoe hoger, hoe beter. Het is het omgekeerde van het bouncepercentage: samen zijn ze 100%.\n\n' +
      'Let op: bij "Vandaag" levert GA4 deze cijfers met vertraging; ze zijn dan voorlopig en kunnen later nog stijgen.',
    bounceRate:
      'Wat het is: het percentage sessies waarin de bezoeker niet echt iets deed: niet langer dan 10 seconden actief, hooguit één pagina bekeken en geen conversie.\n\n' +
      'Hoe het wordt berekend: 100% min het betrokkenheidspercentage (GA4 bounceRate).\n\n' +
      'Zo lees je het: let op, hier is een stijging ongunstig, dus een groene pijl omlaag is goed. Een hoog percentage kan normaal zijn voor een pagina waar bezoekers snel hun antwoord vinden.\n\n' +
      'Let op: bij "Vandaag" zijn deze cijfers voorlopig.',
    dailySessions:
      'Wat het is: het aantal sessies per dag in de gekozen periode, met de vergelijkingsperiode als tweede lijn.\n\n' +
      'Hoe het wordt berekend: GA4 telt de sessies per kalenderdag. De vergelijkingsperiode (de periode ervoor, of een jaar eerder) is de tweede lijn, zodat je dag voor dag kunt vergelijken.\n\n' +
      'Zo lees je het: let op pieken die samenhangen met campagnes of social posts, en op dalen in het weekend. Een enkele dag zegt weinig; de lijn als geheel is belangrijker.',
    channelDonut:
      'Wat het is: de verdeling van het verkeer over de herkomst van de bezoekers (Direct, Organic Search, Paid Search, Referral enzovoort).\n\n' +
      'Hoe het wordt berekend: sessies per GA4-standaardkanaal in de gekozen periode, als aandeel van het totaal.\n\n' +
      'Zo lees je het: het laat zien waar je verkeer vandaan komt. Een groot aandeel van één kanaal maakt je afhankelijk van die ene bron.',
    offerteByPage:
      'Wat het is: het aantal offerteaanvragen per pagina waarop het formulier is ingevuld.\n\n' +
      'Hoe het wordt berekend: de pagina waarop het formulier-event is geregistreerd. Eén sessie kan op meer dan één pagina een aanvraag doen, dus de som van deze lijst kan hoger zijn dan het totaal aantal offertes.\n\n' +
      'Zo lees je het: dit laat zien welke pagina’s de meeste aanvragen opleveren, bijvoorbeeld de contactpagina of een landingspagina.',
    offerteByChannel:
      'Wat het is: het aantal offerteaanvragen per GA4-kanaal (Direct, Organic Search, Paid Search, Paid Social, Referral enzovoort).\n\n' +
      'Hoe het wordt berekend: het kanaal waarmee de sessie begon waarin de aanvraag is gedaan. Per sessie telt een aanvraag maximaal één keer.\n\n' +
      'Zo lees je het: je ziet direct of bezoekers die via een advertentie binnenkwamen ook het formulier invullen. Aanvragen waarvan GA4 geen herkomst heeft, staan onder "Unassigned".',
    offerteByCampaign:
      'Wat het is: het aantal offerteaanvragen via betaalde advertenties, per campagne.\n\n' +
      'Hoe het wordt berekend: alleen sessies uit betaalde kanalen, gegroepeerd op de campagnenaam die GA4 uit de advertentie-link haalt (UTM-tag of de gekoppelde Google Ads-campagne). Staat er "(referral)" of "(not set)", dan is de advertentie niet getagd of kon GA4 de campagne niet koppelen.\n\n' +
      'Zo lees je het: dit laat zien welke campagne echt aanvragen oplevert en niet alleen klikken. Een campagne met veel klikken en geen aanvragen is een kandidaat voor aanpassing.',
    gaClicks:
      'Wat het is: het aantal klikken op je Google Ads-advertenties in de gekozen periode.\n\n' +
      'Hoe het wordt berekend: dit komt uit Google Ads, via Windsor.ai. Het zijn klikken, geen bezoeken; GA4 telt daar sessies bij.\n\n' +
      'Zo lees je het: het aantal klikken is meestal iets hoger dan het aantal sessies via Paid Search in GA4. Dat komt door dubbelklikken, bezoekers die weggaan voordat de pagina laadt en bezoekers die cookies of tracking blokkeren.',
    gaCostOfClicks:
      'Wat het is: wat je in de gekozen periode hebt uitgegeven aan Google Ads.\n\n' +
      'Hoe het wordt berekend: de totale kosten van de klikken, opgehaald uit Google Ads via Windsor.ai.\n\n' +
      'Zo lees je het: zet de kosten naast het aantal offerteaanvragen via betaald verkeer om te zien wat een aanvraag kost. Het cijfer kan een dag achterlopen of kleine afwijkingen hebben ten opzichte van de Google Ads-omgeving zelf.',
    gaCostPerClick:
      'Wat het is: wat een klik gemiddeld kost (CPC).\n\n' +
      'Hoe het wordt berekend: totale kosten gedeeld door het aantal klikken, opgehaald uit Google Ads via Windsor.ai.\n\n' +
      'Zo lees je het: een lagere CPC is gunstig, maar zegt niets over de kwaliteit van de bezoekers. Beoordeel hem samen met het aantal aanvragen.',
    gaActiveCampaigns:
      'Wat het is: de Google Ads-campagnes die nu lopen.\n\n' +
      'Hoe het wordt berekend: per campagne de totalen sinds de start van de campagne, niet alleen voor de gekozen periode. Opgehaald uit Google Ads via Windsor.ai.\n\n' +
      'Zo lees je het: je ziet welke campagnes tot nu toe het meeste hebben gekost en opgeleverd.',
    gaClosedCampaigns:
      'Wat het is: de Google Ads-campagnes die niet meer lopen (gepauzeerd, verwijderd of afgelopen).\n\n' +
      'Hoe het wordt berekend: per campagne de totalen over de hele looptijd, opgehaald uit Google Ads via Windsor.ai.\n\n' +
      'Zo lees je het: handig om afgesloten campagnes terug te kijken en te vergelijken met de campagnes die nu lopen.',
  };

  // Keys of the tiles that show a percentage change next to the value.
  var INFO_COMPARE_KEYS = [
    'sessions', 'users', 'pageviews', 'offertes', 'paidAds', 'social', 'search', 'overig',
    'formsTotal', 'conversionTotal', 'conversionPaid', 'conversionOverig', 'conversionSocial',
    'conversionFacebook', 'conversionInstagram', 'conversionLinkedin',
    'avgSessionDuration', 'pagesPerSession', 'engagementRate', 'bounceRate',
  ];
  var INFO_COMPARE_NOTE =
    'Vergelijking: het percentage naast het cijfer vergelijkt met de vergelijkingsperiode die je bovenaan hebt gekozen (de periode ervoor, of dezelfde periode een jaar eerder).';
  var INFO_LABELS = ['Wat het is', 'Hoe het wordt berekend', 'Zo lees je het', 'Let op', 'Welk event telt', 'Vergelijking'];

  var infoSidebar = document.getElementById('infoSidebar');
  var infoOverlay = document.getElementById('infoOverlay');
  var infoTitle = document.getElementById('infoTitle');
  var infoBody = document.getElementById('infoBody');
  var infoClose = document.getElementById('infoClose');
  var lastFocusedEl = null;

  // Builds the sidebar text: one <p> per paragraph, with a bold lead-in label.
  function renderInfoBody(key, description) {
    var paragraphs = description.split('\n\n');
    if (INFO_COMPARE_KEYS.indexOf(key) !== -1) paragraphs.push(INFO_COMPARE_NOTE);
    infoBody.textContent = '';
    paragraphs.forEach(function (text) {
      var p = document.createElement('p');
      var label = INFO_LABELS.find(function (l) { return text.indexOf(l + ':') === 0; });
      if (label) {
        var strong = document.createElement('strong');
        strong.textContent = label + ':';
        p.appendChild(strong);
        p.appendChild(document.createTextNode(text.slice(label.length + 1)));
      } else {
        p.textContent = text;
      }
      infoBody.appendChild(p);
    });
  }

  function openInfoSidebar(titleEl) {
    var key = titleEl.dataset.info;
    var description = widgetInfo[key];
    if (!description) return;

    lastFocusedEl = titleEl;
    infoTitle.textContent = titleEl.textContent;
    renderInfoBody(key, description);
    infoSidebar.classList.add('open');
    infoOverlay.classList.add('open');
    infoSidebar.setAttribute('aria-hidden', 'false');
    infoClose.focus();
  }

  function closeInfoSidebar() {
    infoSidebar.classList.remove('open');
    infoOverlay.classList.remove('open');
    infoSidebar.setAttribute('aria-hidden', 'true');
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  // The title stays the keyboard-accessible trigger (Enter/Space)…
  document.querySelectorAll('.widget-title').forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openInfoSidebar(el);
      }
    });
  });

  // …while a click anywhere on the card that owns the title also opens it.
  document.querySelectorAll('.kpi-tile, .chart-card, .table-card').forEach(function (card) {
    var titleEl = card.querySelector('.widget-title');
    if (!titleEl) return;

    card.classList.add('is-clickable');
    card.addEventListener('click', function (e) {
      // Leave real controls (links, buttons, form fields) alone.
      if (e.target.closest('a, button, input, select, textarea, label')) return;
      openInfoSidebar(titleEl);
    });
  });

  infoClose.addEventListener('click', closeInfoSidebar);
  infoOverlay.addEventListener('click', closeInfoSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && infoSidebar.classList.contains('open')) closeInfoSidebar();
  });

  // --- Auto refresh (30 min) ---
  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      load(currentRange, currentCompare, currentCustomRange);
    }, 30 * 60 * 1000);
  }

  // --- Custom date range picker ---
  var customPicker = document.getElementById('customRangePicker');
  var customStartInput = document.getElementById('customStart');
  var customEndInput = document.getElementById('customEnd');
  var customError = document.getElementById('customRangeError');

  function todayStr() {
    return formatDateInput(new Date());
  }

  function formatDateInput(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function showCustomPicker() {
    if (!customStartInput.value || !customEndInput.value) {
      var end = new Date();
      var start = new Date();
      start.setDate(end.getDate() - 6);
      customStartInput.value = formatDateInput(start);
      customEndInput.value = formatDateInput(end);
    }
    customPicker.hidden = false;
  }

  function hideCustomPicker() {
    customPicker.hidden = true;
    customError.hidden = true;
  }

  // --- Period selector ---
  document.querySelectorAll('.period-btn[data-range]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.range === 'custom') {
        showCustomPicker();
        return;
      }
      hideCustomPicker();
      document.querySelectorAll('.period-btn[data-range]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      load(btn.dataset.range, currentCompare, null);
    });
  });

  document.getElementById('customApplyBtn').addEventListener('click', function () {
    var start = customStartInput.value;
    var end = customEndInput.value;

    if (!start || !end || start > end || end > todayStr()) {
      customError.hidden = false;
      return;
    }
    customError.hidden = true;

    document.querySelectorAll('.period-btn[data-range]').forEach(function (b) { b.classList.remove('active'); });
    document.getElementById('customRangeBtn').classList.add('active');
    load('custom', currentCompare, { start: start, end: end });
  });

  // --- Compare selector ---
  document.querySelectorAll('.period-btn[data-compare]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.period-btn[data-compare]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      load(currentRange, btn.dataset.compare, currentCustomRange);
    });
  });

  // --- Tabs ---
  var reportsLoaded = false;
  var aiLoaded = false;

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var tab = btn.dataset.tab;
      document.getElementById('dashboardView').hidden = tab !== 'dashboard';
      document.getElementById('googleadsView').hidden = tab !== 'googleads';
      document.getElementById('planningView').hidden = tab !== 'planning';
      document.getElementById('reportsView').hidden = tab !== 'reports';
      document.getElementById('aiView').hidden = tab !== 'ai';
      if (tab === 'dashboard') loadExplanation();

      if (tab === 'ai' && !aiLoaded) {
        aiLoaded = true;
        loadAiSettings();
      }
      if (tab === 'planning') loadPlanning();
      if (tab === 'reports' && !reportsLoaded) {
        reportsLoaded = true;
        loadReports();
      }
    });
  });

  // --- Planning ---
  var PL_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var PL_TYPE_CLASS = { live: 'pl-live', run: 'pl-run', task: 'pl-task', check: 'pl-check', decide: 'pl-decide', party: 'pl-party' };
  var PL_STATUS_CLASS = { Actief: 'ok', Gedaan: 'ok', Bezig: 'ok', Gepland: 'warn', Open: 'warn', Gepauzeerd: 'muted' };

  function plDay(iso) {
    var p = iso.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function plFmt(iso) {
    var d = new Date(plDay(iso));
    return d.getUTCDate() + ' ' + PL_MONTHS[d.getUTCMonth()];
  }
  function plPill(status) {
    return '<span class="pl-pill pl-pill-' + (PL_STATUS_CLASS[status] || 'muted') + '">' + escapeHtml(status) + '</span>';
  }

  function renderPlanning(data) {
    if (data.title) document.getElementById('plTitle').textContent = data.title;
    var campaigns = data.campaigns || [];
    var tasks = data.tasks || [];
    var plan = data.plan || [];
    var active = campaigns.filter(function (c) { return c.status === 'Actief'; });
    var open = tasks.filter(function (t) { return t.status === 'Open'; });
    var budget = active.reduce(function (sum, c) { return sum + c.dailyBudget; }, 0);
    var upcoming = plan
      .filter(function (p) { return p.status === 'Gepland'; })
      .sort(function (a, b) { return plDay(a.start) - plDay(b.start); })[0];

    document.getElementById('pl-active').textContent = formatNumber(active.length);
    document.getElementById('pl-active-sub').textContent = active.map(function (c) { return c.name.replace(/ 2027$/, ''); }).join(', ');
    document.getElementById('pl-budget').textContent = formatCurrency(budget);
    document.getElementById('pl-budget-sub').textContent = 'per dag, alleen actieve campagnes';
    document.getElementById('pl-open').textContent = formatNumber(open.length);
    document.getElementById('pl-open-sub').textContent = 'van ' + formatNumber(tasks.length) + ' taken';
    document.getElementById('pl-next').textContent = upcoming ? plFmt(upcoming.start) : '—';
    document.getElementById('pl-next-sub').textContent = upcoming ? upcoming.title : '';

    document.getElementById('plCampaignsBody').innerHTML = campaigns
      .map(function (c) {
        return (
          '<tr>' +
          '<td>' + escapeHtml(c.name) + '<div class="pl-sub">' + escapeHtml(c.focus) + '</div></td>' +
          '<td>' + plPill(c.status) + '</td>' +
          '<td class="th-right">' + formatCurrency(c.dailyBudget) + '</td>' +
          '<td class="th-right">' + (c.maxCpc == null ? '—' : formatCurrency(c.maxCpc)) + '</td>' +
          '<td class="pl-plain">' + escapeHtml(c.structure) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    document.getElementById('plTasksBody').innerHTML = tasks
      .map(function (t) {
        return (
          '<tr>' +
          '<td>' + escapeHtml(t.title) + '</td>' +
          '<td style="color:#777">' + escapeHtml(t.owner) + '</td>' +
          '<td style="color:#777">' + escapeHtml(plFmt(t.due)) + '</td>' +
          '<td>' + (isAdmin && (t.status === 'Open' || t.status === 'Gedaan')
            ? '<button type="button" class="pl-toggle" data-task-id="' + escapeHtml(t.id) + '" data-next="' + (t.status === 'Open' ? 'Gedaan' : 'Open') + '" title="' + (t.status === 'Open' ? 'Zet op gedaan' : 'Zet terug op open') + '">' + plPill(t.status) + '</button>'
            : plPill(t.status)) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    // Timeline: Oct 2026 to early Apr 2027, bars as % of that span.
    var t0 = plDay('2026-10-01');
    var t1 = plDay('2027-04-05');
    var span = t1 - t0;
    var pct = function (ms) { return Math.max(0, Math.min(100, ((ms - t0) / span) * 100)); };
    var months = '';
    ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'].forEach(function (m) {
      months += '<span style="left:' + pct(plDay(m)).toFixed(2) + '%">' + PL_MONTHS[+m.split('-')[1] - 1] + '</span>';
    });
    var rows = plan
      .map(function (p) {
        var left = pct(plDay(p.start));
        var width = Math.max(pct(plDay(p.end) + 86400000) - left, 1.4);
        var range = p.start === p.end ? plFmt(p.start) : plFmt(p.start) + ' – ' + plFmt(p.end);
        return (
          '<div class="pl-row">' +
          '<div class="pl-label"><span>' + escapeHtml(p.title) + '</span><em>' + escapeHtml(range) + '</em></div>' +
          '<div class="pl-track"><div class="pl-bar ' + (PL_TYPE_CLASS[p.type] || 'pl-run') + '" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></div></div>' +
          '</div>'
        );
      })
      .join('');
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var todayLine = today >= t0 && today <= t1
      ? '<div class="pl-today"><div style="left:' + pct(today).toFixed(2) + '%" title="Vandaag"></div></div>'
      : '';
    document.getElementById('plTimeline').innerHTML = '<div class="pl-months">' + months + '</div>' + todayLine + rows;
  }

  document.getElementById('plTasksBody').addEventListener('click', async function (e) {
    var btn = e.target.closest('.pl-toggle');
    if (!btn) return;
    btn.disabled = true;
    try {
      var res = await apiFetch('/api/planning/tasks/' + encodeURIComponent(btn.dataset.taskId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status: btn.dataset.next }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadPlanning();
    } catch (err) {
      console.error('Taakstatus opslaan mislukt:', err);
      btn.disabled = false;
    }
  });

  async function loadPlanning() {
    try {
      var res = await apiFetch('/api/planning', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderPlanning(await res.json());
    } catch (err) {
      console.error('Planning laden mislukt:', err);
      var msg = '<tr><td colspan="5" class="empty-row">Laden mislukt</td></tr>';
      document.getElementById('plCampaignsBody').innerHTML = msg;
      document.getElementById('plTasksBody').innerHTML = msg;
      document.getElementById('plTimeline').innerHTML = '<p class="empty-row">Laden mislukt</p>';
    }
  }

  // --- Reports ---
  var isAdmin = false;

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatReportDate(iso) {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function fetchRole() {
    try {
      var res = await apiFetch('/api/me', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      var data = await res.json();
      isAdmin = data.role === 'admin';
      document.getElementById('reportsUploadSection').hidden = !isAdmin;
      document.getElementById('aiTabBtn').hidden = !isAdmin;
      if (isAdmin && reportsLoaded) loadReports();
    } catch (err) {
      console.error('Role fetch error:', err);
    }
  }

  async function loadReports() {
    var body = document.getElementById('reportsTableBody');
    try {
      var res = await apiFetch('/api/reports', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var reports = await res.json();

      if (!reports.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty-row">Nog geen rapporten geüpload</td></tr>';
        return;
      }

      body.innerHTML = reports
        .map(function (r) {
          return '<tr><td>' + escapeHtml(r.originalName) + '</td><td>' + formatReportDate(r.uploadedAt) +
            '</td><td class="th-right">' + formatFileSize(r.size) +
            '</td><td class="th-right"><button type="button" class="reports-download-link" data-view-id="' + escapeHtml(r.id) +
            '">Bekijken</button> <button type="button" class="reports-download-link" data-id="' + escapeHtml(r.id) +
            '" data-name="' + escapeHtml(r.originalName) + '">Download</button>' +
            (isAdmin ? ' <button type="button" class="reports-download-link reports-delete-link" data-delete-id="' + escapeHtml(r.id) +
              '" data-name="' + escapeHtml(r.originalName) + '">Verwijderen</button>' : '') + '</td></tr>';
        })
        .join('');
    } catch (err) {
      console.error('Reports load error:', err);
      body.innerHTML = '<tr><td colspan="4" class="empty-row">Fout bij laden van rapporten</td></tr>';
    }
  }

  document.getElementById('reportsTableBody').addEventListener('click', async function (e) {
    var viewBtn = e.target.closest('button[data-view-id]');
    if (viewBtn) {
      // The PDF needs the Authorization header, so a plain link won't work: fetch it and
      // open the blob in a new tab. The tab is opened synchronously to avoid popup blockers.
      var tab = window.open('', '_blank');
      var viewText = viewBtn.textContent;
      viewBtn.disabled = true;
      viewBtn.textContent = 'Bezig…';
      try {
        var viewRes = await apiFetch('/api/reports/' + encodeURIComponent(viewBtn.dataset.viewId));
        if (!viewRes.ok) throw new Error('HTTP ' + viewRes.status);
        var pdfBlob = new Blob([await viewRes.blob()], { type: 'application/pdf' });
        var pdfUrl = URL.createObjectURL(pdfBlob);
        if (tab) tab.location.href = pdfUrl;
        else window.location.href = pdfUrl;
        setTimeout(function () { URL.revokeObjectURL(pdfUrl); }, 5 * 60 * 1000);
        viewBtn.textContent = viewText;
      } catch (err) {
        console.error('View error:', err);
        if (tab) tab.close();
        viewBtn.textContent = 'Mislukt';
        setTimeout(function () { viewBtn.textContent = viewText; }, 2000);
      }
      viewBtn.disabled = false;
      return;
    }

    var delBtn = e.target.closest('button[data-delete-id]');
    if (delBtn) {
      if (!confirm('Rapport "' + delBtn.dataset.name + '" definitief verwijderen?')) return;
      delBtn.disabled = true;
      delBtn.textContent = 'Bezig…';
      try {
        var delRes = await apiFetch('/api/reports/' + encodeURIComponent(delBtn.dataset.deleteId), { method: 'DELETE' });
        if (!delRes.ok) throw new Error('HTTP ' + delRes.status);
        loadReports();
      } catch (err) {
        console.error('Delete error:', err);
        delBtn.textContent = 'Mislukt';
        setTimeout(function () { delBtn.disabled = false; delBtn.textContent = 'Verwijderen'; }, 2000);
      }
      return;
    }

    var btn = e.target.closest('button[data-id]');
    if (!btn) return;

    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Bezig…';

    try {
      var res = await apiFetch('/api/reports/' + encodeURIComponent(btn.dataset.id));
      if (!res.ok) throw new Error('Download mislukt');
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = btn.dataset.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      btn.textContent = 'Mislukt';
      setTimeout(function () { btn.textContent = originalText; }, 2000);
      return;
    }

    btn.disabled = false;
    btn.textContent = originalText;
  });

  function setUploadStatus(message, isError) {
    var el = document.getElementById('reportUploadStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  document.getElementById('reportUploadBtn').addEventListener('click', async function () {
    var input = document.getElementById('reportFileInput');
    var file = input.files[0];
    if (!file) {
      setUploadStatus('Kies eerst een PDF-bestand.', true);
      return;
    }

    var formData = new FormData();
    formData.append('report', file);

    setUploadStatus('Uploaden…', false);
    try {
      var res = await apiFetch('/api/reports', { method: 'POST', body: formData });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload mislukt');

      setUploadStatus('"' + data.originalName + '" geüpload.', false);
      input.value = '';
      reportsLoaded = true;
      loadReports();
    } catch (err) {
      setUploadStatus(err.message, true);
    }
  });

  // --- Google Ads ---
  function formatDateNL(dateStr, withYear) {
    return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    });
  }

  // "sinds 1 sep 2026" for running campaigns, "15 mei – 31 jul 2026" for closed.
  function campaignPeriod(c, running) {
    if (!c.startDate) return '—';
    if (running || !c.endDate || c.endDate === '2037-12-30') return 'sinds ' + formatDateNL(c.startDate, true);
    var sameYear = c.startDate.slice(0, 4) === c.endDate.slice(0, 4);
    return formatDateNL(c.startDate, !sameYear) + ' – ' + formatDateNL(c.endDate, true);
  }

  function renderCampaignTable(bodyId, campaigns, emptyMessage, running) {
    var body = document.getElementById(bodyId);
    if (!campaigns || !campaigns.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-row">' + emptyMessage + '</td></tr>';
      return;
    }
    body.innerHTML = campaigns
      .map(function (c) {
        return (
          '<tr>' +
          '<td>' + escapeHtml(c.campaign) + '</td>' +
          '<td style="color:#777">' + escapeHtml(campaignPeriod(c, running)) + '</td>' +
          '<td class="th-right">' + formatNumber(c.clicks) + '</td>' +
          '<td class="th-right">' + formatNumber(c.impressions) + '</td>' +
          '<td class="th-right">' + formatCurrency(c.costOfClicks) + '</td>' +
          '<td class="th-right">' + formatCurrency(c.costPerClick) + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function gaRangeLabel(range, customRange) {
    if (range === 'custom' && customRange) return shortDate(customRange.start) + ' – ' + shortDate(customRange.end);
    return capitalize(RANGE_LABELS[range] || 'deze periode');
  }

  async function loadGoogleAds(range, compare, customRange) {
    range = range || currentRange;
    compare = compare || currentCompare;
    try {
      var url = '/api/google-ads?range=' + range + '&compare=' + compare;
      if (range === 'custom' && customRange) {
        url += '&start=' + customRange.start + '&end=' + customRange.end;
      }
      var res = await apiFetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      var hasData = Boolean(data.updatedAt);
      if (hasData) {
        var prev = data.previous || {};
        var ch = data.changes || {};
        setKpiValue('ga-clicks', data.clicks, prev.clicks || 0, ch.clicks || 0, formatNumber);
        formatChangeEl(document.getElementById('ga-clicks-change'), ch.clicks);
        setKpiValue('ga-cost', data.costOfClicks, prev.costOfClicks || 0, ch.costOfClicks || 0, formatCurrency);
        formatChangeEl(document.getElementById('ga-cost-change'), ch.costOfClicks);
        setKpiValue('ga-cpc', data.costPerClick, prev.costPerClick || 0, ch.costPerClick || 0, formatCurrency);
        formatChangeEl(document.getElementById('ga-cpc-change'), ch.costPerClick);
      } else {
        document.getElementById('ga-clicks').textContent = '—';
        document.getElementById('ga-cost').textContent = '—';
        document.getElementById('ga-cpc').textContent = '—';
        formatChangeEl(document.getElementById('ga-clicks-change'), null);
        formatChangeEl(document.getElementById('ga-cost-change'), null);
        formatChangeEl(document.getElementById('ga-cpc-change'), null);
      }

      renderCampaignTable('gaActiveCampaignTableBody', data.activeCampaigns, 'Geen lopende campagnes', true);
      renderCampaignTable('gaClosedCampaignTableBody', data.closedCampaigns, 'Geen afgesloten campagnes', false);

      var updatedEl = document.getElementById('googleAdsUpdatedAt');
      updatedEl.textContent = hasData
        ? gaRangeLabel(range, customRange) + ' · Laatst bijgewerkt: ' +
          new Date(data.updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'Geen Google Ads-gegevens beschikbaar';
    } catch (err) {
      console.error('Google Ads load error:', err);
      document.getElementById('ga-clicks').textContent = '—';
      document.getElementById('ga-cost').textContent = '—';
      document.getElementById('ga-cpc').textContent = '—';
      formatChangeEl(document.getElementById('ga-clicks-change'), null);
      formatChangeEl(document.getElementById('ga-cost-change'), null);
      formatChangeEl(document.getElementById('ga-cpc-change'), null);
      renderCampaignTable('gaActiveCampaignTableBody', null, 'Geen lopende campagnes', true);
      renderCampaignTable('gaClosedCampaignTableBody', null, 'Geen afgesloten campagnes', false);
    }
  }

  // --- AI settings (admin) ---
  var aiState = null; // { activeProvider, weeklyReportEnabled, providers, providerMeta }
  // Unsaved edits per provider, so switching provider in the dropdown doesn't lose them
  var aiDraft = {};
  var aiShownProvider = null;

  function setAiStatus(message, isError) {
    var el = document.getElementById('aiStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  function setAiModelOptions(models, selected) {
    var select = document.getElementById('aiModel');
    var ids = models.map(function (m) { return m.id; });
    if (selected && ids.indexOf(selected) === -1) models = [{ id: selected, name: selected }].concat(models);
    select.innerHTML = models.length
      ? models.map(function (m) {
          return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name === m.id ? m.id : m.name + ' (' + m.id + ')') + '</option>';
        }).join('')
      : '<option value="">Nog geen model — haal modellen op</option>';
    select.value = selected || (models[0] ? models[0].id : '');
  }

  function saveAiDraft() {
    if (!aiShownProvider) return;
    var select = document.getElementById('aiModel');
    aiDraft[aiShownProvider] = {
      baseUrl: document.getElementById('aiBaseUrl').value,
      apiKey: document.getElementById('aiApiKey').value,
      model: select.value,
      models: Array.prototype.map.call(select.options, function (o) {
        return { id: o.value, name: o.textContent };
      }).filter(function (m) { return m.id; }),
    };
  }

  function showAiProvider(key) {
    var saved = aiState.providers[key];
    var d = aiDraft[key] || {};
    aiShownProvider = key;
    document.getElementById('aiBaseUrl').value = d.baseUrl !== undefined ? d.baseUrl : saved.baseUrl;
    var keyInput = document.getElementById('aiApiKey');
    keyInput.value = d.apiKey || '';
    keyInput.placeholder = saved.hasKey ? 'Opgeslagen — laat leeg om te behouden' : 'Plak hier je API-key';
    setAiModelOptions(d.models || [], d.model !== undefined ? d.model : saved.model);
  }

  async function loadAiSettings() {
    try {
      var res = await apiFetch('/api/ai/settings', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      aiState = await res.json();
      aiDraft = {};

      var select = document.getElementById('aiProvider');
      select.innerHTML = Object.keys(aiState.providerMeta).map(function (key) {
        return '<option value="' + key + '">' + escapeHtml(aiState.providerMeta[key].label) + '</option>';
      }).join('');
      select.value = aiState.activeProvider;
      document.getElementById('aiWeeklyEnabled').checked = aiState.weeklyReportEnabled;
      document.getElementById('aiMonthlyEnabled').checked = aiState.monthlyReportEnabled;
      document.getElementById('aiWeeklyActionsEnabled').checked = aiState.weeklyActionsEnabled;
      document.getElementById('aiMonthlyActionsEnabled').checked = aiState.monthlyActionsEnabled;
      showAiProvider(aiState.activeProvider);

      var smtp = aiState.smtp || {};
      document.getElementById('smtpHost').value = smtp.host || '';
      document.getElementById('smtpPort').value = smtp.port || 587;
      document.getElementById('smtpSecure').checked = Boolean(smtp.secure);
      document.getElementById('smtpUser').value = smtp.user || '';
      document.getElementById('smtpPass').value = '';
      document.getElementById('smtpPass').placeholder = smtp.hasPass ? 'Opgeslagen — laat leeg om te behouden' : 'Wachtwoord';
      document.getElementById('smtpFrom').value = smtp.from || '';
      document.getElementById('smtpTo').value = smtp.to || '';
    } catch (err) {
      console.error('AI settings load error:', err);
      aiLoaded = false;
      setAiStatus('Instellingen laden mislukt.', true);
    }
  }

  document.getElementById('aiProvider').addEventListener('change', function () {
    saveAiDraft();
    showAiProvider(this.value);
    setAiStatus('', false);
  });

  document.getElementById('aiFetchModels').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    setAiStatus('Modellen ophalen…', false);
    try {
      var res = await apiFetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: document.getElementById('aiProvider').value,
          baseUrl: document.getElementById('aiBaseUrl').value,
          apiKey: document.getElementById('aiApiKey').value,
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Modellen ophalen mislukt');
      setAiModelOptions(data.models, document.getElementById('aiModel').value);
      setAiStatus(data.models.length + ' modellen gevonden. Kies een model en sla op.', false);
    } catch (err) {
      setAiStatus(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('aiForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    saveAiDraft();

    var providers = {};
    Object.keys(aiDraft).forEach(function (key) {
      providers[key] = { baseUrl: aiDraft[key].baseUrl, apiKey: aiDraft[key].apiKey, model: aiDraft[key].model };
    });

    setAiStatus('Opslaan…', false);
    try {
      var res = await apiFetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeProvider: document.getElementById('aiProvider').value,
          weeklyReportEnabled: document.getElementById('aiWeeklyEnabled').checked,
          monthlyReportEnabled: document.getElementById('aiMonthlyEnabled').checked,
          weeklyActionsEnabled: document.getElementById('aiWeeklyActionsEnabled').checked,
          monthlyActionsEnabled: document.getElementById('aiMonthlyActionsEnabled').checked,
          providers: providers,
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');

      // Typed keys are now stored server-side; keep fetched model lists and selections
      Object.keys(aiDraft).forEach(function (key) { aiDraft[key].apiKey = ''; });
      aiState = data;
      showAiProvider(document.getElementById('aiProvider').value);
      setAiStatus('Opgeslagen.', false);
    } catch (err) {
      setAiStatus(err.message, true);
    }
  });

  document.getElementById('aiRunMonthlyReport').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    setAiStatus('Maandrapport wordt gemaakt (dit kan een halve minuut duren)…', false);
    try {
      var res = await apiFetch('/api/ai/monthly-report', { method: 'POST' });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Maandrapport maken mislukt');
      setAiStatus(
        '"' + data.entry.originalName + '" is toegevoegd aan Rapporten.' +
          (data.aiUsed ? '' : ' Let op: AI-inleiding mislukt (' + data.aiError + '), standaardtekst gebruikt.'),
        !data.aiUsed
      );
      reportsLoaded = true;
      loadReports();
    } catch (err) {
      setAiStatus(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  function setAiActionsStatus(message, isError) {
    var el = document.getElementById('aiActionsStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  // --- SMTP settings (admin) ---
  function setSmtpStatus(message, isError) {
    var el = document.getElementById('smtpStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  async function saveSmtpSettings() {
    var res = await apiFetch('/api/ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeProvider: aiState.activeProvider,
        weeklyReportEnabled: aiState.weeklyReportEnabled,
        monthlyReportEnabled: aiState.monthlyReportEnabled,
        weeklyActionsEnabled: aiState.weeklyActionsEnabled,
        monthlyActionsEnabled: aiState.monthlyActionsEnabled,
        providers: {},
        smtp: {
          host: document.getElementById('smtpHost').value,
          port: document.getElementById('smtpPort').value,
          secure: document.getElementById('smtpSecure').checked,
          user: document.getElementById('smtpUser').value,
          pass: document.getElementById('smtpPass').value,
          from: document.getElementById('smtpFrom').value,
          to: document.getElementById('smtpTo').value,
        },
      }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
    aiState = data;
    document.getElementById('smtpPass').value = '';
    document.getElementById('smtpPass').placeholder = data.smtp.hasPass ? 'Opgeslagen — laat leeg om te behouden' : 'Wachtwoord';
    return data;
  }

  document.getElementById('smtpForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!aiState) return;
    setSmtpStatus('Opslaan…', false);
    try {
      await saveSmtpSettings();
      setSmtpStatus('Opgeslagen.', false);
    } catch (err) {
      setSmtpStatus(err.message, true);
    }
  });

  // Saves first, so the test always uses what's currently in the form
  // rather than whatever was saved last.
  document.getElementById('smtpTest').addEventListener('click', async function () {
    if (!aiState) return;
    var btn = this;
    btn.disabled = true;
    setSmtpStatus('Instellingen opslaan…', false);
    try {
      await saveSmtpSettings();
      setSmtpStatus('Testmail wordt verstuurd…', false);
      var res = await apiFetch('/api/ai/smtp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: document.getElementById('smtpTo').value }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Testmail versturen mislukt');
      setSmtpStatus('Testmail verstuurd naar ' + data.to + '.', false);
    } catch (err) {
      setSmtpStatus(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('aiActionsForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!aiState) return;
    setAiActionsStatus('Opslaan…', false);
    try {
      var res = await apiFetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeProvider: aiState.activeProvider,
          weeklyReportEnabled: document.getElementById('aiWeeklyEnabled').checked,
          monthlyReportEnabled: document.getElementById('aiMonthlyEnabled').checked,
          weeklyActionsEnabled: document.getElementById('aiWeeklyActionsEnabled').checked,
          monthlyActionsEnabled: document.getElementById('aiMonthlyActionsEnabled').checked,
          providers: {},
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      aiState = data;
      setAiActionsStatus('Opgeslagen.', false);
    } catch (err) {
      setAiActionsStatus(err.message, true);
    }
  });

  function setReportMailStatus(message, isError) {
    var el = document.getElementById('aiReportMailStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  // Generates a fresh PDF, saves it in Rapporten and mails it as an attachment.
  function runReportMail(buttonId, endpoint, label) {
    document.getElementById(buttonId).addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      setReportMailStatus(label + ' wordt gemaakt en gemaild (dit kan een halve minuut duren)…', false);
      try {
        var res = await apiFetch(endpoint, { method: 'POST' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Rapport mailen mislukt');
        setReportMailStatus(
          label + ' is gemaild naar ' + data.to + ' en toegevoegd aan Rapporten.' +
            (data.aiUsed ? '' : ' Let op: AI-inleiding mislukt (' + data.aiError + '), standaardtekst gebruikt.'),
          !data.aiUsed
        );
        reportsLoaded = true;
        loadReports();
      } catch (err) {
        setReportMailStatus(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  runReportMail('aiRunWeeklyReportMail', '/api/ai/weekly-report-mail', 'Weekrapport (PDF)');
  runReportMail('aiRunMonthlyReportMail', '/api/ai/monthly-report-mail', 'Maandrapport (PDF)');

  function runActionsMail(buttonId, endpoint, label) {
    document.getElementById(buttonId).addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      setAiActionsStatus(label + ' worden gemaild…', false);
      try {
        var res = await apiFetch(endpoint, { method: 'POST' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Mailen mislukt');
        setAiActionsStatus(
          label + ' gemaild.' + (data.ai ? '' : ' Let op: AI-analyse mislukt (' + data.error + '), standaardlijst gebruikt.'),
          !data.ai
        );
      } catch (err) {
        setAiActionsStatus(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  runActionsMail('aiRunWeeklyActions', '/api/ai/weekly-actions', 'Actiepunten (week)');
  runActionsMail('aiRunMonthlyActions', '/api/ai/monthly-actions', 'Actiepunten (maand)');

  document.getElementById('aiRunReport').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    setAiStatus('Weekrapport wordt gemaakt (dit kan een halve minuut duren)…', false);
    try {
      var res = await apiFetch('/api/ai/weekly-report', { method: 'POST' });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Weekrapport maken mislukt');
      setAiStatus(
        '"' + data.entry.originalName + '" is toegevoegd aan Rapporten.' +
          (data.aiUsed ? '' : ' Let op: AI-inleiding mislukt (' + data.aiError + '), standaardtekst gebruikt.'),
        !data.aiUsed
      );
      reportsLoaded = true;
      loadReports();
    } catch (err) {
      setAiStatus(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Login form ---
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var loginSubmit = document.getElementById('loginSubmit');

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var user = document.getElementById('loginUser').value;
    var pass = document.getElementById('loginPass').value;
    var candidate = 'Basic ' + btoa(user + ':' + pass);

    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Bezig…';

    try {
      var res = await fetch('/api/me', { headers: { Authorization: candidate } });
      if (!res.ok) {
        loginError.textContent = 'Onjuiste gebruikersnaam of wachtwoord.';
        loginError.hidden = false;
        return;
      }
      authHeader = candidate;
      sessionStorage.setItem('wv_auth', candidate);
      document.getElementById('loginPass').value = '';
      boot();
    } catch (err) {
      loginError.textContent = 'Kon geen verbinding maken. Probeer opnieuw.';
      loginError.hidden = false;
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Inloggen';
    }
  });

  // --- Init ---
  tryBoot();
})();
