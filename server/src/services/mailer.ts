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

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
