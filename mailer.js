// Thin wrapper around nodemailer for the reports that get mailed instead of
// (or in addition to) being published in the dashboard's Rapporten tab.
// Configured entirely through environment variables so no credentials live
// in the repo; when SMTP isn't configured, callers get a clear error instead
// of a silent failure.
const nodemailer = require('nodemailer');

const DEFAULT_RECIPIENT = 'bojan@studiovanderheide.nl';

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function reportRecipient() {
  return process.env.REPORT_EMAIL_TO || DEFAULT_RECIPIENT;
}

// opts: { subject, html, text, attachments? } — attachments are
// [{ filename, content: Buffer }] as nodemailer expects.
async function sendMail(opts) {
  if (!isConfigured()) {
    throw new Error('E-mail is niet geconfigureerd (SMTP_HOST/SMTP_USER/SMTP_PASS ontbreken)');
  }
  await transporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: reportRecipient(),
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}

module.exports = { isConfigured, sendMail, reportRecipient, DEFAULT_RECIPIENT };
