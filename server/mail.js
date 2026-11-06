// Outbound mail for verification codes and invitations.
//
// Drivers:
//   console  development/test only — writes the message to the server log and
//            keeps a bounded in-memory outbox for tests. Never active in production.
//   smtp     nodemailer
//   resend   HTTPS API via fetch (no SDK)
//
// Every send has a 10 s deadline and ONE retry. A failure is returned as
// { ok: false, error } — callers must never crash a request because mail is down.
import nodemailer from "nodemailer";

const TIMEOUT_MS = 10_000;
const OUTBOX_LIMIT = 100;

const DEFAULT_FROM = "ASPIRE <no-reply@aspire.local>";

const setting = (v) => String(v ?? "").trim();
const lower = (v) => setting(v).toLowerCase();
const bool = (v) => /^(1|true|yes|on)$/i.test(setting(v));

function timeout(ms) {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error("email send timed out")), ms);
    t.unref?.();
  });
}

async function withDeadline(promise, ms = TIMEOUT_MS) {
  return Promise.race([promise, timeout(ms)]);
}

export function createMailer({
  driver,
  from = process.env.MAIL_FROM || DEFAULT_FROM,
  host = process.env.SMTP_HOST,
  port = process.env.SMTP_PORT,
  secure = process.env.SMTP_SECURE,
  user = process.env.SMTP_USER,
  pass = process.env.SMTP_PASS,
  resendApiKey = process.env.RESEND_API_KEY,
  sendOverride = null,
  logger = console,
  now = () => Date.now(),
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const envDriver = setting(driver ?? process.env.MAIL_DRIVER);
  const chosen = lower(envDriver) || (process.env.NODE_ENV === "production" ? "none" : "console");
  const outbox = [];

  const smtpReady = chosen === "smtp" && Boolean(setting(host)) && Boolean(setting(from));
  const resendReady = chosen === "resend" && Boolean(setting(resendApiKey)) && Boolean(setting(from));
  const consoleReady = chosen === "console" && process.env.NODE_ENV !== "production";

  const enabled = Boolean(sendOverride) || smtpReady || resendReady || consoleReady;
  // "configured" means the operator/deployment opted into mail (or a test
  // injected its own transport). A bare development default stays console but
  // still uses the old temporary-password path, so existing tests and demo
  // provisioning do not silently change.
  const configured = Boolean(sendOverride) || Boolean(envDriver);

  let transport = null;
  async function smtpTransport() {
    if (transport) return transport;
    const p = Number(port) || (bool(secure) ? 465 : 587);
    transport = nodemailer.createTransport({
      host: setting(host),
      port: p,
      secure: bool(secure) || p === 465,
      auth: setting(user) ? { user: setting(user), pass: String(pass ?? "") } : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
    return transport;
  }

  async function deliver({ to, subject, text, html }) {
    if (sendOverride) {
      await sendOverride({ to, subject, text, html, from });
      return;
    }
    if (chosen === "console") {
      const msg = { to, subject, text, html, from, at: now() };
      if (process.env.NODE_ENV !== "production") {
        outbox.push(msg);
        if (outbox.length > OUTBOX_LIMIT) outbox.splice(0, outbox.length - OUTBOX_LIMIT);
        // The console driver MUST print the full message so a developer can copy
        // the invite link. This driver is refused in production.
        logger.log?.(`[mail:console] To: ${to}\nSubject: ${subject}\n\n${text}`);
      }
      return;
    }
    if (chosen === "smtp") {
      const t = await smtpTransport();
      await t.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
      return;
    }
    if (chosen === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`resend ${res.status}: ${detail.slice(0, 200)}`);
      }
      return;
    }
    throw new Error("mail driver is not configured");
  }

  async function send(message) {
    if (!enabled) return { ok: false, error: "email could not be sent" };
    let lastError = "email could not be sent";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await withDeadline(deliver(message), timeoutMs);
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "email could not be sent";
        if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
      }
    }
    return { ok: false, error: "email could not be sent", detail: lastError };
  }

  return {
    driver: chosen,
    enabled,
    configured,
    from,
    outbox,
    send,
    clearOutbox() { outbox.length = 0; },
  };
}

function baseUrl(appBaseUrl) {
  return String(appBaseUrl || process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

export function inviteUrl(appBaseUrl, token) {
  return `${baseUrl(appBaseUrl)}/#/invite?token=${encodeURIComponent(token)}`;
}

export function inviteMessage({ to, token, appBaseUrl }) {
  const link = inviteUrl(appBaseUrl, token);
  return {
    to,
    subject: "You are invited to ASPIRE",
    text: [
      "You have been invited to ASPIRE, the emergency reporting system for Sinalhan Elementary School.",
      "",
      "Open this link to set your password and sign in:",
      link,
      "",
      "This invitation expires in 72 hours and can only be used once.",
      "If you were not expecting this message, you can ignore it.",
    ].join("\n"),
  };
}

export function codeMessage({ to, code, purpose, appBaseUrl }) {
  const what = purpose === "reset_password"
    ? "reset your password"
    : purpose === "change_email"
      ? "confirm your new email address"
      : "verify your email address";
  return {
    to,
    subject: `Your ASPIRE code to ${what}`,
    text: [
      `Use this code to ${what}:`,
      "",
      code,
      "",
      "The code expires in 10 minutes. If you did not ask for it, ignore this message.",
      baseUrl(appBaseUrl),
    ].join("\n"),
  };
}
