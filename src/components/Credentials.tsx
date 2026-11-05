import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { TempCredential } from "../lib/types";
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
