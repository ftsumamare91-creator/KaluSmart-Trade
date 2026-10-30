import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');

  async send(mail: OutgoingEmail): Promise<void> {
    const provider = process.env.EMAIL_PROVIDER || 'console';

    if (provider === 'console') {
      if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_PROVIDER=console is not allowed in production');
      // Development only: prints the message so you can test links without an email account.
      this.logger.warn(`[dev email] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
      return;
    }

    if (provider === 'resend') {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!key || !from) throw new Error('Email is not configured (RESEND_API_KEY and EMAIL_FROM are required)');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.error(`Email provider responded HTTP ${res.status}`);
        throw new Error('The email provider rejected the message');
      }
      return;
    }

    throw new Error('Unknown EMAIL_PROVIDER (use console or resend)');
  }
}
