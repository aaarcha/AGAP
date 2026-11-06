import { useState } from "react";
import { Check, Copy, MailCheck, Send, ShieldX } from "lucide-react";
import type { TempCredential } from "../lib/types";
import { api } from "../lib/api";
import { Modal } from "./Modal";

/**
 * One-time credentials. The temporary password is shown here and nowhere else:
 * the server returns it once, and the dialog is dismissed for good on close.
 * Shared by the Admin console (provision + password reset) and the Principal's
 * Add teacher form, so the wording and the Copy button never drift apart.
 */
export function TempCredentialModal({ title, credential, onClose }: { title: string; credential: TempCredential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copyToClipboard() {
    void navigator.clipboard.writeText(`${credential.email} / ${credential.tempPassword}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div data-one-time-credentials className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-bold">⚠️ Save these credentials now</p>
          <p>This is the only time the temporary password will be shown. Share it securely with the user.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs text-slate-500">Email</p>
          <p className="break-all font-mono text-sm font-bold">{credential.email}</p>
          <p className="mb-1 mt-3 text-xs text-slate-500">Temporary password</p>
          <p className="break-all font-mono text-sm font-bold">{credential.tempPassword}</p>
        </div>
        <button onClick={copyToClipboard} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy credentials</>}
        </button>
        <p className="text-center text-xs text-slate-500">The user must set a new password on their first sign-in.</p>
      </div>
    </Modal>
  );
}

export type InviteNotice = {
  basePath: string;
  name: string;
  maskedEmail: string | null;
};

/**
 * Invitations never show a password. The creator can resend a fresh 72-hour
 * link or revoke it; the account stays invited and cannot sign in until a link
 * is accepted.
 */
export function InviteSentModal({ notice, onClose, onChanged }: {
  notice: InviteNotice;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [masked, setMasked] = useState(notice.maskedEmail || "the new address");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"invited" | "revoked">("invited");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function resend() {
    setBusy(true); setError("");
    try {
      const r = await api<{ maskedEmail?: string | null }>("POST", `${notice.basePath}/invite/resend`);
      if (r.maskedEmail) setMasked(r.maskedEmail);
      setStatus("invited");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend the invitation.");
    } finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true); setError("");
    try {
      await api("POST", `${notice.basePath}/invite/revoke`);
      setStatus("revoked");
      setConfirmRevoke(false);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the invitation.");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={status === "revoked" ? "Invitation revoked" : "Invitation sent"} onClose={onClose}>
      <div data-invite-notice className="space-y-3">
        <div className={`rounded-xl border p-3 text-sm ${status === "revoked" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          <p className="flex items-center gap-2 font-bold"><MailCheck size={17} /> {status === "revoked" ? "The invitation link no longer works." : `Invitation sent to ${masked}`}</p>
          <p className="mt-1 leading-relaxed">
            {status === "revoked"
              ? "The account is still invited. Resend to create a new link, or edit the address first."
              : "No password is shown. The link expires in 72 hours, works once, and is also the first sign-in."}
          </p>
        </div>
        {notice.name && <p className="text-xs text-slate-500">For {notice.name}. Ask them to check spam if it does not arrive.</p>}
        {error && <p role="alert" className="text-sm text-blush-700">{error}</p>}
        {status === "invited" && (
          confirmRevoke ? (
            <div className="rounded-xl border border-blush-200 bg-blush-50 p-3">
              <p className="text-sm font-semibold text-blush-800">Revoke this invitation? The current link stops working immediately.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => setConfirmRevoke(false)} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">Keep invite</button>
                <button type="button" disabled={busy} onClick={() => void revoke()} className="min-h-11 flex-1 rounded-xl bg-blush-700 text-sm font-bold text-white">Yes, revoke</button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={busy} onClick={() => void resend()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white disabled:opacity-60">
                <Send size={15} /> {busy ? "Working…" : "Resend invite"}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmRevoke(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blush-200 bg-white px-3 text-sm font-bold text-blush-700 disabled:opacity-60">
                <ShieldX size={15} /> Revoke invite
              </button>
            </div>
          )
        )}
        {status === "revoked" && (
          <button type="button" disabled={busy} onClick={() => void resend()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white disabled:opacity-60">
            <Send size={15} /> Send a new invite
          </button>
        )}
        <button type="button" onClick={onClose} className="min-h-11 w-full text-sm font-semibold text-slate-500 underline">Close</button>
      </div>
    </Modal>
  );
}

export function PasswordResultModal({ tempPassword, onClose }: { tempPassword: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Password reset" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-bold">⚠️ Save this temporary password</p>
          <p>The user must set a new password on their next sign-in.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs text-slate-500">Temporary password</p>
          <p className="break-all font-mono text-sm font-bold">{tempPassword}</p>
        </div>
        <button onClick={() => { void navigator.clipboard.writeText(tempPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy password</>}
        </button>
      </div>
    </Modal>
  );
}
