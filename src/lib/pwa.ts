import { useEffect, useState } from "react";

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker failed:", err));
  });
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "aspire.installDismissedAt";

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function usePwaInstall() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < 7 * 24 * 3600 * 1000;
  });

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
  return {
    canInstall: !installed && !dismissed && Boolean(evt),
    iosHint: !installed && !dismissed && ios,
    install: async () => {
      if (!evt) return;
      await evt.prompt();
      await evt.userChoice;
      setEvt(null);
    },
    dismiss: () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setDismissed(true); },
  };
}

export const notificationsSupported = () => typeof Notification !== "undefined";

export async function showSystemNotification(title: string, body: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", vibrate: [200, 100, 200], requireInteraction: true } as NotificationOptions);
    } else {
      new Notification(title, { body, tag, icon: "/icons/icon-192.png" });
    }
  } catch { /* some browsers only allow SW notifications */ }
}
