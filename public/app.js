(function () {
  'use strict';

  let currentRange = 7;
  let lineChart = null;
  let donutChart = null;
  let refreshTimer = null;

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
    el.textContent = formatPct(change) + ' vs vorige periode';
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
  async function fetchAnalytics(range) {
    const res = await fetch('/api/analytics?range=' + range, {
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
            label: 'Vorige periode',
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
  async function load(range) {
    currentRange = range;
    document.getElementById('footerRange').textContent = range + ' dagen';

    try {
      var data = await fetchAnalytics(range);
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

  // --- Auto refresh (30 min) ---
  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      load(currentRange);
    }, 30 * 60 * 1000);
  }

  // --- Period selector ---
  document.querySelectorAll('.period-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.period-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var range = parseInt(btn.dataset.range, 10);
      load(range);
    });
  });

  // --- Init ---
  load(7);
  scheduleAutoRefresh();
})();
