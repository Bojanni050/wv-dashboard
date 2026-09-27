// Date helpers shared by the weekly/monthly reports and the AI explanation.
// All in Amsterdam time; the container itself runs in UTC.

const TIMEZONE = 'Europe/Amsterdam';

function amsterdamNow(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    hour: parseInt(get('hour'), 10) % 24,
    weekday: get('weekday'), // 'Mon'..'Sun'
  };
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}

// Monday of the week containing dateStr
function mondayOf(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  return shiftDate(dateStr, -((dow + 6) % 7));
}

function nlDate(dateStr, withYear) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

function nlWeekday(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'short', timeZone: 'UTC' });
}

function dayOfMonth(dateStr) {
  return String(new Date(dateStr + 'T12:00:00Z').getUTCDate());
}

module.exports = {
  TIMEZONE,
  amsterdamNow,
  shiftDate,
  addMonths,
  firstOfMonth,
  mondayOf,
  nlDate,
  nlWeekday,
  dayOfMonth,
};
