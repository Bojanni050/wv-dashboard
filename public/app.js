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

  function formatChangeEl(el, change) {
    el.textContent = formatPct(change) + ' vs ' + COMPARE_LABELS[currentCompare];
    el.classList.remove('up', 'down', 'neutral');
    if (change > 0) el.classList.add('up');
    else if (change < 0) el.classList.add('down');
    else el.classList.add('neutral');
  }

  // Sets a KPI tile's main value, with the previous-period value appended
  // in parentheses (colored to match the direction of change).
  function setKpiValue(elId, current, previous, change, formatFn) {
    var el = document.getElementById(elId);
    var cls = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
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

    setKpiValue('kpi-conv-total', k.conversionTotal.current, k.conversionTotal.previous, k.conversionTotal.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-total-change'), k.conversionTotal.change);

    setKpiValue('kpi-conv-paid', k.conversionPaid.current, k.conversionPaid.previous, k.conversionPaid.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-paid-change'), k.conversionPaid.change);

    setKpiValue('kpi-conv-paid-ads', k.conversionPaid.current, k.conversionPaid.previous, k.conversionPaid.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-paid-ads-change'), k.conversionPaid.change);

    setKpiValue('kpi-conv-social', k.conversionSocial.current, k.conversionSocial.previous, k.conversionSocial.change, formatConversion);
    formatChangeEl(document.getElementById('kpi-conv-social-change'), k.conversionSocial.change);
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

  // --- Main load ---
  async function load(range, compare, customRange) {
    currentRange = range;
    currentCompare = compare;
    currentCustomRange = range === 'custom' ? customRange : null;

    document.getElementById('footerRange').textContent =
      range === 'custom' && customRange
        ? shortDate(customRange.start) + ' – ' + shortDate(customRange.end)
        : RANGE_LABELS[range];
    document.getElementById('lineChartSubtitle').textContent = 'Deze periode vs. ' + COMPARE_LABELS[compare];

    try {
      var data = await fetchAnalytics(range, compare, customRange);
      updateKPIs(data);
      renderLineChart(data);
      renderDonutChart(data);
      renderTable(data);
      updateLastRefreshed();
    } catch (err) {
      console.error('Load error:', err);
      var errorRow = '<tr><td colspan="2" class="empty-row">Fout bij laden van gegevens</td></tr>';
      document.getElementById('offerteTableBody').innerHTML = errorRow;
      document.getElementById('offerteChannelTableBody').innerHTML = errorRow;
      document.getElementById('offerteCampaignTableBody').innerHTML = errorRow;
      document.getElementById('offerteCampaignTableBody-ads').innerHTML = errorRow;
    }
  }

  // --- Widget info sidebar ---
  var widgetInfo = {
    sessions: 'Aantal sessies (bezoeken) op de website in de geselecteerde periode, gemeten via Google Analytics 4.',
    users: 'Aantal unieke gebruikers dat de website heeft bezocht in de geselecteerde periode.',
    pageviews: 'Totaal aantal paginaweergaven in de geselecteerde periode.',
    offertes: 'Aantal succesvolle offerteaanvragen ("gforms_submission" events) in de geselecteerde periode.',
    paidAds: 'Aantal sessies via betaalde advertenties: elk GA4-kanaal dat begint met "Paid", zoals Paid Search en Paid Social.',
    social: 'Aantal sessies via organisch social verkeer (Organic Social kanaal) — dus niet via betaalde social ads.',
    search: 'Aantal sessies via organische zoekresultaten (Organic Search kanaal).',
    overig: 'Aantal sessies via overige kanalen: Direct, Referral, Organic Video en niet-geclassificeerd verkeer.',
    conversionTotal: 'Percentage van alle gebruikers dat een offerteaanvraag heeft ingediend: offertes gedeeld door totaal aantal gebruikers.',
    conversionPaid: 'Conversieratio van bezoekers via betaalde ads: offerteaanvragen via betaalde kanalen gedeeld door sessies via betaalde kanalen.',
    conversionSocial: 'Conversieratio van bezoekers via organic social: offerteaanvragen via Organic Social gedeeld door sessies via Organic Social.',
    dailySessions: 'Dagelijks aantal sessies in de geselecteerde periode, vergeleken met dezelfde periode ervoor.',
    channelDonut: 'Verdeling van sessies over de GA4-kanalen (Direct, Organic Search, Paid Search, Referral, etc.) in de geselecteerde periode.',
    offerteByPage: 'Aantal offerteaanvragen per pagina waarop het formulier is ingevuld.',
    offerteByChannel: 'Aantal offerteaanvragen per GA4-kanaal (Direct, Organic Search, Paid Search, Paid Social, Referral, etc.). Hiermee zie je direct of bezoekers die via een advertentie binnenkwamen ook daadwerkelijk het formulier hebben ingevuld.',
    offerteByCampaign: 'Aantal offerteaanvragen via betaalde ads, gegroepeerd per campagnenaam (utm_campaign). Toont "(referral)" of "(not set)" wanneer de advertentie niet getagd is.',
    gaClicks: 'Aantal klikken op de Google Ads-campagnes. Deze data komt via Strato rankingcoach en wordt handmatig door Admin bijgewerkt.',
    gaCostOfClicks: 'Totale advertentiekosten van de Google Ads-klikken. Deze data komt via Strato rankingcoach en wordt handmatig door Admin bijgewerkt.',
    gaCostPerClick: 'Gemiddelde kost per klik (CPC) op de Google Ads-campagnes. Deze data komt via Strato rankingcoach en wordt handmatig door Admin bijgewerkt.',
  };

  var infoSidebar = document.getElementById('infoSidebar');
  var infoOverlay = document.getElementById('infoOverlay');
  var infoTitle = document.getElementById('infoTitle');
  var infoBody = document.getElementById('infoBody');
  var infoClose = document.getElementById('infoClose');
  var lastFocusedEl = null;

  function openInfoSidebar(titleEl) {
    var key = titleEl.dataset.info;
    var description = widgetInfo[key];
    if (!description) return;

    lastFocusedEl = titleEl;
    infoTitle.textContent = titleEl.textContent;
    infoBody.textContent = description;
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

  document.querySelectorAll('.widget-title').forEach(function (el) {
    el.addEventListener('click', function () { openInfoSidebar(el); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openInfoSidebar(el);
      }
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
  var googleAdsLoaded = false;
  var aiLoaded = false;

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var tab = btn.dataset.tab;
      document.getElementById('dashboardView').hidden = tab !== 'dashboard';
      document.getElementById('googleadsView').hidden = tab !== 'googleads';
      document.getElementById('reportsView').hidden = tab !== 'reports';
      document.getElementById('aiView').hidden = tab !== 'ai';

      if (tab === 'ai' && !aiLoaded) {
        aiLoaded = true;
        loadAiSettings();
      }
      if (tab === 'reports' && !reportsLoaded) {
        reportsLoaded = true;
        loadReports();
      }
      if (tab === 'googleads' && !googleAdsLoaded) {
        googleAdsLoaded = true;
        loadGoogleAds();
      }
    });
  });

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
      document.getElementById('googleAdsEditSection').hidden = !isAdmin;
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
            '</td><td class="th-right"><button type="button" class="reports-download-link" data-id="' + escapeHtml(r.id) +
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
  async function loadGoogleAds() {
    try {
      var res = await apiFetch('/api/google-ads', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      document.getElementById('ga-clicks').textContent = formatNumber(data.clicks);
      document.getElementById('ga-cost').textContent = formatCurrency(data.costOfClicks);
      document.getElementById('ga-cpc').textContent = formatCurrency(data.costPerClick);

      var updatedEl = document.getElementById('googleAdsUpdatedAt');
      updatedEl.textContent = data.updatedAt
        ? 'Laatst bijgewerkt: ' + new Date(data.updatedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Nog niet ingevuld';

      document.getElementById('gaClicksInput').value = data.clicks;
      document.getElementById('gaCostInput').value = data.costOfClicks;
      document.getElementById('gaCpcInput').value = data.costPerClick;
    } catch (err) {
      console.error('Google Ads load error:', err);
      document.getElementById('ga-clicks').textContent = '—';
      document.getElementById('ga-cost').textContent = '—';
      document.getElementById('ga-cpc').textContent = '—';
    }
  }

  function setGoogleAdsStatus(message, isError) {
    var el = document.getElementById('googleAdsStatus');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('success', !isError);
  }

  document.getElementById('googleAdsForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    var clicks = parseInt(document.getElementById('gaClicksInput').value, 10);
    var costOfClicks = parseFloat(document.getElementById('gaCostInput').value);
    var costPerClick = parseFloat(document.getElementById('gaCpcInput').value);

    if (!isFinite(clicks) || clicks < 0 || !isFinite(costOfClicks) || costOfClicks < 0 || !isFinite(costPerClick) || costPerClick < 0) {
      setGoogleAdsStatus('Vul geldige, positieve getallen in.', true);
      return;
    }

    setGoogleAdsStatus('Opslaan…', false);
    try {
      var res = await apiFetch('/api/google-ads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clicks: clicks, costOfClicks: costOfClicks, costPerClick: costPerClick }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');

      setGoogleAdsStatus('Opgeslagen.', false);
      googleAdsLoaded = true;
      loadGoogleAds();
    } catch (err) {
      setGoogleAdsStatus(err.message, true);
    }
  });

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
      showAiProvider(aiState.activeProvider);
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
