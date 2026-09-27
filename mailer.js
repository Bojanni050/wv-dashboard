// Thin wrapper around nodemailer for the reports that get mailed instead of
// (or in addition to) being published in the dashboard's Rapporten tab.
// SMTP credentials can be set by the admin on the AI-instellingen tab
// (stored in data/ai-settings.json, same as the AI provider keys) or via
// environment variables — the stored settings win when both are present.
// When neither is configured, callers get a clear error instead of a silent
// failure.
const nodemailer = require('nodemailer');
const ai = require('./ai');

const DEFAULT_RECIPIENT = 'bojan@studiovanderheide.nl';

function resolveConfig() {
  const smtp = ai.readSettings().smtp || {};
  return {
    host: smtp.host || process.env.SMTP_HOST || '',
    port: smtp.port || parseInt(process.env.SMTP_PORT || '587', 10),
    secure: typeof smtp.secure === 'boolean' && smtp.host ? smtp.secure : process.env.SMTP_SECURE === 'true',
    user: smtp.user || process.env.SMTP_USER || '',
    pass: smtp.pass || process.env.SMTP_PASS || '',
    from: smtp.from || process.env.MAIL_FROM || smtp.user || process.env.SMTP_USER || '',
    to: smtp.to || process.env.REPORT_EMAIL_TO || DEFAULT_RECIPIENT,
  };
}

function isConfigured() {
  const cfg = resolveConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

function transporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

function reportRecipient() {
  return resolveConfig().to;
}

// opts: { subject, html, text, attachments?, to? } — attachments are
// [{ filename, content: Buffer }] as nodemailer expects. `to` overrides the
// configured recipient (used by the test-mail button).
async function sendMail(opts) {
  const cfg = resolveConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('E-mail is niet geconfigureerd (SMTP host, gebruiker of wachtwoord ontbreekt)');
  }
  await transporter(cfg).sendMail({
    from: cfg.from,
    to: opts.to || cfg.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}

async function sendTestMail(to) {
  await sendMail({
    to,
    subject: 'Testmail — White Vision dashboard',
    text: 'Dit is een testmail vanuit het White Vision dashboard. Als je deze mail ontvangt, werken de SMTP-instellingen correct.',
    html: '<p>Dit is een testmail vanuit het White Vision dashboard.</p><p>Als je deze mail ontvangt, werken de SMTP-instellingen correct.</p>',
  });
}

module.exports = { isConfigured, sendMail, sendTestMail, reportRecipient, DEFAULT_RECIPIENT };
