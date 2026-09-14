(function () {
  'use strict';

  let currentRange = '7';
  let currentCompare = 'previous';
  let currentCustomRange = null;
  let lineChart = null;
  let donutChart = null;
  let refreshTimer = null;

  var RANGE_LABELS = { '7': '7 dagen', '28': '28 dagen', '90': '90 dagen', month: 'deze maand', lastweek: 'vorige week' };
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
    const res = await fetch(url, {
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

    document.getElementById('kpi-sessions').textContent = formatNumber(k.sessions.current);
    formatChangeEl(document.getElementById('kpi-sessions-change'), k.sessions.change);

    document.getElementById('kpi-users').textContent = formatNumber(k.users.current);
    formatChangeEl(document.getElementById('kpi-users-change'), k.users.change);

    document.getElementById('kpi-pageviews').textContent = formatNumber(k.pageviews.current);
    formatChangeEl(document.getElementById('kpi-pageviews-change'), k.pageviews.change);

    document.getElementById('kpi-offertes').textContent = formatNumber(k.offertes.current);
    formatChangeEl(document.getElementById('kpi-offertes-change'), k.offertes.change);

    document.getElementById('kpi-paidads').textContent = formatNumber(k.paidAds.current);
    formatChangeEl(document.getElementById('kpi-paidads-change'), k.paidAds.change);

    document.getElementById('kpi-social').textContent = formatNumber(k.social.current);
    formatChangeEl(document.getElementById('kpi-social-change'), k.social.change);

    document.getElementById('kpi-search').textContent = formatNumber(k.search.current);
    formatChangeEl(document.getElementById('kpi-search-change'), k.search.change);

    document.getElementById('kpi-overig').textContent = formatNumber(k.overig.current);
    formatChangeEl(document.getElementById('kpi-overig-change'), k.overig.change);

    document.getElementById('kpi-conv-total').textContent = formatConversion(k.conversionTotal.current);
    formatChangeEl(document.getElementById('kpi-conv-total-change'), k.conversionTotal.change);

    document.getElementById('kpi-conv-paid').textContent = formatConversion(k.conversionPaid.current);
    formatChangeEl(document.getElementById('kpi-conv-paid-change'), k.conversionPaid.change);

    document.getElementById('kpi-conv-social').textContent = formatConversion(k.conversionSocial.current);
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
    renderRowsTable('offerteCampaignTableBody', data.offerteByCampaign, 'campaign', 'Geen offerteaanvragen via betaalde ads in deze periode');
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
      document.getElementById('offerteCampaignTableBody').innerHTML = errorRow;
    }
  }

  // --- Widget info sidebar ---
  var widgetInfo = {
    sessions: 'Aantal sessies (bezoeken) op de website in de geselecteerde periode, gemeten via Google Analytics 4.',
    users: 'Aantal unieke gebruikers dat de website heeft bezocht in de geselecteerde periode.',
    pageviews: 'Totaal aantal paginaweergaven in de geselecteerde periode.',
    offertes: 'Aantal succesvolle offerteaanvragen ("offerte_form_succes" events) in de geselecteerde periode.',
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
    offerteByCampaign: 'Aantal offerteaanvragen via betaalde ads, gegroepeerd per campagnenaam (utm_campaign). Toont "(referral)" of "(not set)" wanneer de advertentie niet getagd is.',
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

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var tab = btn.dataset.tab;
      document.getElementById('dashboardView').hidden = tab !== 'dashboard';
      document.getElementById('reportsView').hidden = tab !== 'reports';

      if (tab === 'reports' && !reportsLoaded) {
        reportsLoaded = true;
        loadReports();
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
      var res = await fetch('/api/me', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      var data = await res.json();
      isAdmin = data.role === 'admin';
      document.getElementById('reportsUploadSection').hidden = !isAdmin;
    } catch (err) {
      console.error('Role fetch error:', err);
    }
  }

  async function loadReports() {
    var body = document.getElementById('reportsTableBody');
    try {
      var res = await fetch('/api/reports', { headers: { Accept: 'application/json' } });
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
            '</td><td class="th-right"><a class="reports-download-link" href="/api/reports/' + encodeURIComponent(r.id) + '">Download</a></td></tr>';
        })
        .join('');
    } catch (err) {
      console.error('Reports load error:', err);
      body.innerHTML = '<tr><td colspan="4" class="empty-row">Fout bij laden van rapporten</td></tr>';
    }
  }

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
      var res = await fetch('/api/reports', { method: 'POST', body: formData });
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

  // --- Init ---
  fetchRole();
  load(currentRange, currentCompare, currentCustomRange);
  scheduleAutoRefresh();
})();
