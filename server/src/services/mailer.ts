import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
}

let transport: Transporter | undefined;
/** Captured messages when no SMTP is configured (dev/test). Never contains anything but what would be emailed. */
export const outbox: Mail[] = [];

function getTransport(): Transporter | null {
  if (!config().SMTP_URL) return null;
  transport ??= nodemailer.createTransport(config().SMTP_URL);
  return transport;
}

export async function sendMail(mail: Mail): Promise<void> {
  const t = getTransport();
  if (!t) {
    // In production a missing SMTP_URL is a misconfiguration: fail loudly so callers record the email as failed
    // instead of reporting it as sent.
    if (config().NODE_ENV === 'production') throw new Error('Email is not configured: SMTP_URL is empty');
    outbox.push(mail);
    if (outbox.length > 200) outbox.shift();
    if (config().NODE_ENV === 'development') {
      console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    }
    return;
  }
  await t.sendMail({ from: config().MAIL_FROM, ...mail });
}

/** For notifications that must not fail the request that triggered them (e.g. SMTP is down). */
export async function trySendMail(mail: Mail): Promise<void> {
  try {
    await sendMail(mail);
  } catch (e) {
    if (config().LOG_LEVEL !== 'silent') console.error(`[mail] failed to send "${mail.subject}":`, (e as Error).message);
  }
}

/** Logs at startup whether email can actually be sent, so a wrong SMTP_URL shows up in the logs immediately. */
export async function checkMailSetup(): Promise<void> {
  if (config().LOG_LEVEL === 'silent' || config().NODE_ENV === 'test') return;
  const url = config().SMTP_URL;
  if (!url) {
    if (config().NODE_ENV === 'production') console.error('[mail] SMTP_URL is not set: no emails will be sent');
    return;
  }
  let host = '?';
  try {
    host = new URL(url).host; // host only: the URL itself contains the password
  } catch {
    console.error('[mail] SMTP_URL is not a valid URL (check that any @ in the login or key is written as %40)');
    return;
  }
  try {
    await getTransport()!.verify();
    console.log(`[mail] SMTP connection OK (${host}), sending as ${config().MAIL_FROM}`);
  } catch (e) {
    console.error(`[mail] SMTP connection to ${host} FAILED: ${(e as Error).message}`);
  }
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
