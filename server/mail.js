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

// Values pasted from a README often keep their quotes ("ASPIRE <a@b.com>"), which
// makes an otherwise correct SMTP_USER or MAIL_FROM invalid. Strip one matching
// pair of wrapping quotes before anything else reads the value.
const setting = (v) => String(v ?? "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
const lower = (v) => setting(v).toLowerCase();
const bool = (v) => /^(1|true|yes|on)$/i.test(setting(v));

// Documentation placeholders. Sending with these fails at the SMTP server with
// "Invalid login", which reads like a wrong password; recognising them up front
// lets the app report "mail is not configured" instead of blaming the account.
const PLACEHOLDER = [
  /your\.?address/i,
  /your[._-]?email/i,
  /you@gmail\.com/i,
  /app[-_ ]?password/i,
  /^<[\s\S]*>$/,
  /xxxx/i,
  /replace[-_ ]?me/i,
  /changeme/i,
];
const isPlaceholder = (v) => PLACEHOLDER.some((re) => re.test(String(v ?? "")));

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
  const detectedDriver = !envDriver
    ? (setting(resendApiKey) ? "resend" : setting(host) ? "smtp" : process.env.NODE_ENV === "production" ? "none" : "console")
    : lower(envDriver);
  const chosen = detectedDriver;
  const outbox = [];

  const fromValue = setting(from);
  const smtpUser = setting(user);
  const smtpPass = setting(pass);
  const smtpPort = Number(setting(port)) || (bool(secure) ? 465 : 587);
  // An empty problem means SMTP is usable. A reason is reported on /api/health and
  // in the boot log, so the operator can see WHICH variable is still wrong.
  const smtpProblem = chosen !== "smtp"
    ? ""
    : !setting(host) ? "smtp_host_missing"
      : !fromValue ? "mail_from_missing"
        : isPlaceholder(fromValue) ? "mail_from_placeholder"
          : isPlaceholder(smtpUser) ? "smtp_user_placeholder"
            : isPlaceholder(smtpPass) ? "smtp_pass_placeholder"
              : smtpUser && !smtpPass ? "smtp_pass_missing"
                : !smtpUser && smtpPass ? "smtp_user_missing"
                  : "";
  const smtpReady = chosen === "smtp" && !smtpProblem;
  const resendReady = chosen === "resend" && Boolean(setting(resendApiKey)) && Boolean(fromValue);
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
    const p = smtpPort;
    const encrypted = bool(secure) || p === 465;
    transport = nodemailer.createTransport({
      host: setting(host),
      port: p,
      secure: encrypted,
      // Port 587 opens in the clear and upgrades with STARTTLS; require the upgrade
      // so a provider cannot quietly refuse the send over an unencrypted socket.
      requireTLS: !encrypted,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
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

  // Turn nodemailer's terse codes into something a school operator can act on.
  function explain(err) {
    const msg = err instanceof Error ? err.message : String(err ?? "email could not be sent");
    if (/invalid login|username and password not accepted|eauth|535|534/i.test(msg)) {
      return "Gmail rejected the SMTP sign-in – check SMTP_USER, and that SMTP_PASS is the 16-character App Password (2-Step Verification must be on, and the normal account password will not work)";
    }
    if (/enotfound|eai_again|getaddrinfo/i.test(msg)) return `SMTP_HOST (${setting(host)}) could not be resolved`;
    if (/etimedout|esocket|timeout/i.test(msg)) return `No answer from ${setting(host)}:${smtpPort} – the host may block outbound SMTP ports`;
    if (/self.signed|certificate|ssl|tls/i.test(msg)) return "The SMTP server's TLS certificate was rejected";
    return msg;
  }

  async function send(message) {
    if (!enabled) {
      return { ok: false, error: "email could not be sent", detail: smtpProblem || "mail driver is not configured" };
    }
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
    return { ok: false, error: "email could not be sent", detail: explain(lastError) };
  }

  // Never leak the password; the user is masked because /api/health is public.
  function maskUser(v) {
    const s = setting(v);
    const at = s.indexOf("@");
    return !s ? "" : at > 0 ? `${s[0]}***${s.slice(at)}` : "***";
  }

  return {
    driver: chosen,
    enabled,
    configured,
    from: fromValue,
    outbox,
    send,
    clearOutbox() { outbox.length = 0; },
    // Non-secret summary of how mail is set up, for the boot log and /api/health.
    status() {
      return {
        driver: chosen,
        configured,
        ready: enabled,
        from: fromValue,
        host: chosen === "smtp" ? setting(host) : "",
        port: chosen === "smtp" ? smtpPort : 0,
        secure: chosen === "smtp" ? Boolean(bool(secure) || smtpPort === 465) : false,
        user: chosen === "smtp" ? maskUser(user) : "",
        problem: enabled ? "" : smtpProblem || (chosen === "none" ? "mail_driver_not_configured" : ""),
      };
    },
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
