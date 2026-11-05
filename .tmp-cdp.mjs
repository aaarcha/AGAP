// TEMP verification driver — drives headless Chrome over CDP (Node 22 built-in WebSocket).
// Usage: node .tmp-cdp.mjs <role> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173/";
const PORT = 9333;
const OUT = path.resolve("tmp-shots");
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNTS = {
  super_admin: ["superadmin@sinalhanes.deped.ph", "Dev-Console-2026!"],
  principal: ["principal@sinalhanes.deped.ph", "Dev-Head-2026!"],
  teacher: ["t1@sinalhanes.deped.ph", "Dev-Staff-2026!"],
  responder: ["responder@sinalhanes.deped.ph", "Dev-Brgy-2026!"],
  parent: ["parent-grade-3-sec-a@sinalhanes.deped.ph", "Dev-Guardian-2026!"],
};
const TABS = {
  super_admin: ["Users", "Audit", "Year", "System Settings", "Profile"],
  principal: ["Command", "Report", "Safety", "History", "More"],
  teacher: ["Report", "My Reports", "Account"],
  responder: ["Queue", "History", "Escalation", "Account"],
  parent: ["Alerts", "Account"],
};

function launchChrome() {
  const dir = fs.mkdtempSync(path.join(process.env.TMP || "/tmp", "cdp-profile-"));
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: "ignore" });
  return proc;
}

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error("could not create a Chrome target");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) {
      listeners.forEach((fn) => fn(m));
    }
  };
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error("ws error"));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ready, send, close: () => ws.close(), onEvent: (fn) => listeners.push(fn) };
}

async function main() {
  const role = process.argv[2] || "super_admin";
  const W = Number(process.argv[3] || 1440);
  const H = Number(process.argv[4] || 900);
  const [email, password] = ACCOUNTS[role];

  const chrome = launchChrome();
  const target = await getTarget();
  const c = cdp(target.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Network.enable");
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });

  const evalJs = async (expr) => {
    const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  const shot = async (name) => {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  // ---- navigate + login -------------------------------------------------
  await c.send("Page.navigate", { url: BASE });
  await sleep(2500);
  // Wait until the login form (or the app shell) is actually mounted.
  for (let i = 0; i < 40; i++) {
    const ready = await evalJs(`!!document.getElementById('email') || !!document.querySelector('main')`);
    if (ready) break;
    await sleep(250);
  }
  // Sign in over the API and drop the token into localStorage, then reload —
  // far more reliable than driving React's controlled inputs.
  const login = await evalJs(`
    (async () => {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }),
      });
      const j = await r.json();
      if (!r.ok) return 'login failed: ' + (j.error || r.status);
      localStorage.setItem('aspire.token', j.token);
      return 'ok';
    })()
  `);
  if (login !== 'ok') throw new Error(login);
  await c.send("Page.reload", {});
  await sleep(1500);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const inApp = await evalJs(`!!document.querySelector('aside nav[aria-label="Sections"]') || !!document.querySelector('main')`);
    if (inApp) break;
  }
  await sleep(1200);
  const who = await evalJs(`document.querySelector('header') ? document.querySelector('header').innerText.replace(/\\n/g,' | ') : 'no header'`);
  console.log(`SIGNED IN [${role}] @ ${W}x${H} :: ${who}`);

  // ---- reports ----------------------------------------------------------
  const REPORT = `
    (() => {
      const desc = (el) => {
        const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 70);
        const txt = (el.innerText || '').trim().split('\\n')[0].slice(0, 40);
        return el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') +
          ' ."' + cls + '" "' + txt + '"';
      };
      const main = document.querySelector('main');
      const mr = main.getBoundingClientRect();
      const cs = getComputedStyle(main);

      // 1. Does main itself scroll? Can scrollTop move?
      const mainBefore = main.scrollTop;
      const prevSb = main.style.scrollBehavior;
      main.style.scrollBehavior = 'auto'; // neutralise the app's smooth-scroll for measurement
      main.scrollTop = 99999;
      const mainScrollable = { sh: main.scrollHeight, ch: main.clientHeight, movedTo: main.scrollTop, max: main.scrollHeight - main.clientHeight };
      main.scrollTop = mainBefore;
      main.style.scrollBehavior = prevSb;

      // 2. Every scroll container: is it actually scrollable, and does it scroll?
      const areas = [...document.querySelectorAll('.scroll-area, [style*="overflow"]')].map((el) => ({
        el,
        sh: el.scrollHeight, ch: el.clientHeight,
        oy: getComputedStyle(el).overflowY,
        rect: el.getBoundingClientRect(),
      })).filter((a) => a.sh > a.ch + 1);

      // 3. Content stuck below the fold that NOTHING can scroll into view.
      const buried = [];
      const canReveal = (el) => {
        let p = el.parentElement;
        while (p && p !== document.documentElement) {
          const pcs = getComputedStyle(p);
          if ((pcs.overflowY === 'auto' || pcs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
          p = p.parentElement;
        }
        return mainScrollable.max > 1;
      };
      for (const el of main.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.height < 4 || r.width < 4) continue;
        if (r.bottom <= mr.bottom + 2) continue;
        if (el.querySelector('main') ) continue;
        const isScrollArea = el.classList.contains('scroll-area') || getComputedStyle(el).overflowY === 'auto';
        if (isScrollArea) continue;
        if (canReveal(el)) continue;
        buried.push(desc(el) + ' @bottom+' + Math.round(r.bottom - mr.bottom));
      }

      // 4. Sibling overlap: two non-nested elements with real boxes intersecting.
      const cands = [...main.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) return false;
        const c = typeof el.className === 'string' ? el.className : '';
        return /bg-white|rounded-2xl|rounded-xl border|shadow/.test(c);
      });
      const overlaps = [];
      for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
          const a = cands[i], b = cands[j];
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ox > 4 && oy > 4) overlaps.push({ a: desc(a), b: desc(b), ox: Math.round(ox), oy: Math.round(oy) });
        }
      }

      // 5. Content clipped by an ancestor that can NOT scroll it into view.
      const clipperOf = (el) => {
        let p = el.parentElement;
        while (p && p !== document.documentElement) {
          const o = getComputedStyle(p);
          if (o.overflowY !== 'visible' || o.overflowX !== 'visible') return { el: p, o };
          p = p.parentElement;
        }
        return null;
      };
      const clipped = [];
      for (const el of main.querySelectorAll('*')) {
        if (getComputedStyle(el).position === 'fixed') continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 4 || r.width < 4) continue;
        const c = clipperOf(el);
        if (!c) continue;
        const cr = c.el.getBoundingClientRect();
        const overY = Math.max(0, r.bottom - cr.bottom) + Math.max(0, cr.top - r.top);
        const overX = Math.max(0, r.right - cr.right) + Math.max(0, cr.left - r.left);
        const scrollY = (c.o.overflowY === 'auto' || c.o.overflowY === 'scroll') && c.el.scrollHeight > c.el.clientHeight + 1;
        const scrollX = (c.o.overflowX === 'auto' || c.o.overflowX === 'scroll') && c.el.scrollWidth > c.el.clientWidth + 1;
        if ((overY > 2 && !scrollY) || (overX > 2 && !scrollX)) {
          clipped.push(desc(el) + '  cut by  ' + desc(c.el) + '  y:' + Math.round(overY) + ' x:' + Math.round(overX));
        }
      }

      return {
        main: mainScrollable,
        overflowingAreas: areas.map((a) => ({ cls: (typeof a.el.className === 'string' ? a.el.className : '').slice(0, 60), sh: a.sh, ch: a.ch, oy: a.oy })),
        buried: [...new Set(buried)].slice(0, 8),
        unreachable: [...new Set(clipped)].slice(0, 8),
        overlaps: overlaps.slice(0, 8),
      };
    })()
  `;

  // Real wheel event over the middle of the content area: what actually scrolls?
  const wheel = async () => {
    const snap = `(() => {
      const m = document.querySelector('main');
      const areas = [...document.querySelectorAll('.scroll-area')].map((e, i) => ({ i, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), top: e.scrollTop }));
      return { main: m.scrollTop, mainMax: m.scrollHeight - m.clientHeight, areas };
    })()`;
    const spin = async () => {
      await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(W / 2), y: Math.round(H / 2 + 80) });
      await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(W / 2), y: Math.round(H / 2 + 80), deltaX: 0, deltaY: 600, modifiers: 0 });
      await sleep(900);
    };
    const diff = (before, after) => {
      const moved = { main: after.main - before.main };
      after.areas.forEach((a, i) => {
        const d = a.top - (before.areas[i] ? before.areas[i].top : 0);
        if (d !== 0) moved[`area${i}:${a.cls}`] = d;
      });
      return moved;
    };
    const before = await evalJs(snap);
    await spin();
    let after = await evalJs(snap);
    let moved = diff(before, after);
    let retried = false;
    // If nothing moved although main has room, test whether `overscroll-behavior:
    // contain` on non-overflowing panes is swallowing the wheel chain.
    if (after.mainMax > 0 && Object.values(moved).every((v) => v === 0)) {
      retried = true;
      await evalJs(`document.querySelectorAll('.scroll-area').forEach((e) => { e.style.overscrollBehavior = 'auto'; });`);
      await sleep(200);
      await spin();
      after = await evalJs(snap);
      moved = diff(before, after);
    }
    return { wheelDelta: moved, mainMax: after.mainMax, overscrollRetry: retried };
  };

  const tabs = TABS[role];
  for (let i = 0; i < tabs.length; i++) {
    const label = tabs[i];
    if (i > 0) {
      await evalJs(`
        (() => {
          const b = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
            .find((x) => (x.getAttribute('aria-label') || '').trim() === ${JSON.stringify(label)});
          if (b) b.click();
          return !!b;
        })()
      `);
      await sleep(900);
    }
    const rep = await evalJs(REPORT);
    const name = `${role}-${i}-${label.replace(/\s+/g, "_")}`;
    await shot(name);
    console.log(`\n=== ${role} / ${label} (${W}x${H}) → tmp-shots/${name}.png`);
    console.log(JSON.stringify(rep, null, 2));
    console.log('  WHEEL:', JSON.stringify(await wheel()));

    // Drill into known sub-screens (long content is where scrolling matters).
    for (const sub of ["About ASPIRE", "Teacher roster", "Open archive"]) {
      const opened = await evalJs(`
        (() => {
          const b = [...document.querySelectorAll('main button')]
            .find((x) => (x.innerText || '').trim().includes(${JSON.stringify(sub)}));
          if (!b) return false;
          b.click();
          return true;
        })()
      `);
      if (!opened) continue;
      await sleep(900);
      const subRep = await evalJs(REPORT);
      const subName = `${role}-${i}-${label.replace(/\s+/g, "_")}-${sub.replace(/\s+/g, "_")}`;
      await shot(subName);
      console.log(`  --- ${role} / ${label} → ${sub} → tmp-shots/${subName}.png`);
      console.log(JSON.stringify(subRep, null, 2));
      console.log('  WHEEL(sub):', JSON.stringify(await wheel()));
      await evalJs(`
        (() => {
          const b = document.querySelector('[data-testid="back-bar"] button') ||
            [...document.querySelectorAll('main button')].find((x) => /\u2190 More|Back/.test((x.innerText || '')));
          if (b) b.click();
          return !!b;
        })()
      `);
      await sleep(700);
    }
  }

  c.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });