declare module 'nodemailer' {
  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }

  interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    cc?: string;
    bcc?: string;
  }

  interface SentMessageInfo {
    messageId: string;
    accepted: string[];
    rejected: string[];
  }

  interface Transporter {
    sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
  }

  function createTransport(options: TransportOptions): Transporter;

  export default { createTransport };
  export { createTransport, SendMailOptions, SentMessageInfo, Transporter, TransportOptions };
}
