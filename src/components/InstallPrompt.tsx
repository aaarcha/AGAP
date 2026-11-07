import { Download, Share, X } from "lucide-react";
import { usePwaInstall } from "../lib/pwa";

/**
 * Home-screen install dialog. Chrome/Edge/Android fire `beforeinstallprompt` and
 * get a real one-tap install; iOS Safari has no install API, so the same dialog
 * explains Share → Add to Home Screen instead. Dismissal is remembered for a
 * week by usePwaInstall, so this never nags on every launch.
 */
export function InstallPrompt() {
  const { canInstall, iosHint, install, dismiss } = usePwaInstall();
  if (!canInstall && !iosHint) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="install-title"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 p-3 sm:items-center">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 px-4 pt-4">
          <img src="/icons/icon-192.png" alt="" width={48} height={48}
            className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-cream object-contain" />
          <div className="min-w-0 flex-1">
            <h2 id="install-title" className="text-base font-black leading-tight text-slate-800">Install ASPIRE</h2>
            <p className="mt-1 text-xs leading-snug text-slate-600">
              Add it to the home screen so it opens full screen, like any other app on your phone.
            </p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Not now"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <ul className="mt-3 space-y-1 px-4 text-xs text-slate-600">
          <li>Opens without the browser bar</li>
          <li>One tap from the home screen</li>
          <li>Keeps the last known information when the signal drops</li>
        </ul>

        {iosHint && (
          <div className="mx-4 mt-3 rounded-xl bg-brand-100 px-3 py-2.5 text-xs text-brand-900">
            <p className="font-bold">On this iPhone or iPad</p>
            <p className="mt-1 flex items-center gap-1">
              Tap <Share size={13} aria-hidden /> <b>Share</b> in Safari, then <b>Add to Home Screen</b>.
            </p>
          </div>
        )}

        <div className="flex gap-2 p-4">
          {canInstall && (
            <button type="button" onClick={() => void install()}
              className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white">
              <Download size={16} /> Install app
            </button>
          )}
          <button type="button" onClick={dismiss}
            className={`min-h-12 rounded-xl px-4 text-sm font-bold ${canInstall ? "bg-slate-100 text-slate-700" : "flex-1 bg-brand-700 text-white"}`}>
            {canInstall ? "Not now" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
