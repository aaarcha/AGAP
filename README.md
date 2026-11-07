# ASPIRE: An Emergency Reporting and Incident Prioritization PWA Using AHP-SAW for Sinalhan Elementary School
Emergency reporting and incident prioritization for Sinalhan Elementary School.
Sinalhan Elementary School · Barangay Sinalhan · CDRRMO

A single Node service that hosts the API **and** the installable PWA.
Four roles share one live data store, so a report from a teacher appears on the
Principal, Parent/PTA and Barangay/CDRRMO devices within about a second.

| Role | What they do |
|---|---|
| Teacher | 3-tap report (sent immediately; "Cancel this alert" on the last-report panel undoes a mistake), headcount prompt for group-scope alerts, edit own profile/room, personal history and account |
| Principal | Command queue, can also report, Analytics (post-incident breakdowns); the rail is **Command · Report · Analytics · More**, where More holds Safety (hazard/drill switches), the Headcount status feed, the official Incidents & Records (browser, drills and archives), the teacher roster, About and Account |
| Parent/PTA | Sees only alerts for their child's section (plus whole-school alerts); "All clear" when closed; advisory in English/Filipino; one Contact School button |
| Barangay Sinalhan · CDRRMO | One account per organization (never shared): priority dispatch queue — Acknowledge → On-Site → Resolve / False alarm. Both orgs respond to the same ticket independently, each with its own ETA and transport; History |

## Run locally
```bash
npm install
npm test                 # API tests (roles, scoping, merging, offline replay, SSE…) + the Select component test
npm run dev:all          # starts BOTH the API (:3000) and the app (:5173) in one terminal
# (or separately: npm run dev:server  and  npm run dev -- --host)
npm run seed:history     # dev only: sample resolved/archived incidents and drill logs
# or production-style:
npm run build && npm start   # http://localhost:3000
```

## Deploy on Railway (recommended)
The repo ships `railway.json` (build, start command, `/api/health` check), so a
git-push deploy needs only the project wiring below.

1. **Project** → *New Project* → *Deploy from GitHub repo* → pick this repo.
   Every push to the connected branch redeploys.
2. In the same project: **New** → **Database** → **Add PostgreSQL**.
3. Open the app service → **Variables** → *Raw Editor* and add:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ASPIRE_SECRET=<long random string>
   ASPIRE_PRINCIPAL_EMAIL=principal@gmail.com
   ASPIRE_PRINCIPAL_PASSWORD=<strong password>
   ASPIRE_REQUIRE_GMAIL=1
   APP_BASE_URL=https://<your-app>.up.railway.app
   ```

   `${{Postgres.DATABASE_URL}}` must match the Postgres service's name; it resolves
to the private `postgres.railway.internal` address, which is what you want.
   `ASPIRE_SECRET` signs login tokens — if it changes, everyone is signed out.
4. **Settings** → **Networking** → *Generate Domain* to get the public URL, then
   set `APP_BASE_URL` to that URL (used in invitation emails).
5. Open the URL on an Android phone in Chrome → **Install app**.

The first Principal account is bootstrapped into Postgres on first boot when
`ASPIRE_PRINCIPAL_EMAIL` / `ASPIRE_PRINCIPAL_PASSWORD` are set. Changing those
variables later does **not** change an existing password — use Account → Change
password in the app instead.

Notes specific to Railway:
* **Keep one replica.** All state is held by a single process that writes one
  `app_state` row; two replicas would fight over it.
* The filesystem is ephemeral, so **Postgres is the only durable store** — the JSON
  file is used only when `DATABASE_URL` is absent (local dev/tests).
* If you use the public TCP proxy URL (`*.proxy.rlwy.net`) instead of the internal
  one, TLS is enabled automatically; set `PGSSLMODE=disable` to override.
* The service exits with a clear `FATAL` log if `DATABASE_URL` is set but
  unreachable, instead of starting with an empty database.
* Free/trial plans sleep when idle — the first request after a sleep can take a
  while. Fine for demos; use a paid plan for a real pilot.

## Deploy on Render
1. Push this folder to GitHub.
2. Use the blueprint: *New +* → *Blueprint* → pick this repo (it creates the web
   service and the Postgres database and wires `DATABASE_URL`).
3. In the service's Environment tab set `ASPIRE_PRINCIPAL_EMAIL`, `ASPIRE_PRINCIPAL_PASSWORD`, and optionally `ASPIRE_ACCESS_CODE`.
4. Open the app URL on an Android phone in Chrome → **Install app**.

In production, set `ASPIRE_REQUIRE_GMAIL=1` to require teacher accounts to use real Gmail addresses; otherwise the app remains compatible with the existing school-domain workflow used in local/dev testing.

### Free vs paid (important for an emergency tool)
* **Free plan**: the service sleeps after ~15 min idle (first request can take about a minute). Data itself is safe because it lives in Postgres.
* **Starter**: always on. Use this for any real pilot.
* Run **one instance only** — state is held by a single process.

### Environment variables
| Var | Purpose |
|---|---|
| `ASPIRE_SECRET` | Signs login tokens (auto-generated by the blueprint) |
| `ASPIRE_ACCESS_CODE` | Optional shared code required at login |
| `ASPIRE_SCHOOL_PHONE` | School contact number shown in About and on the parent's “Contact School” button. Leave empty to hide the button and show “Contact the school office”. |
| `DATA_DIR` | Where `aspire-db.json` is stored (mount a disk here) |
| `ALLOW_DEMO_RESET` | `1` enables the demo reset endpoint (off by default) |
| `ESCALATION_MINUTES` | Minutes without acknowledgement before escalating to Barangay then CDRRMO (default `3,6`) |
| `HISTORY_DAYS` | How long closed incidents are kept before auto-removal (default 90) |
| `SEED_DEMO_INCIDENT` / `SEED_DEMO_ACCOUNTS` | `1` seeds demo incidents / demo accounts (both off by default) |
| `MAIL_DRIVER` | Optional override: `console`, `smtp`, or `resend`. If left blank, the app auto-detects valid SMTP or Resend settings and falls back to console only for local development/tests. |
| `MAIL_FROM` | Sender address for smtp/resend, e.g. `ASPIRE <no-reply@school.example>`. |
| `APP_BASE_URL` | Public app URL used to build `/#/invite?token=…` links (default `http://localhost:5173`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP transport. For Gmail, use `smtp.gmail.com`, `587`, `0`, and a Google App Password. |
| `RESEND_API_KEY` | Resend API key. Use this driver when the host blocks outbound SMTP ports. |

### Email verification and invitations
With a configured mail driver, creating an account (Admin provisioning or Principal → Add teacher) sends a 72-hour, single-use invitation and creates the account as **Invited**; the creator sees only the masked address, with **Resend invite** and **Revoke invite**, never a password. The link lands on `/#/invite?token=…`, which asks for a new password using the live policy checklist and then signs the user in — the invite is also the first sign-in. If mail is not configured or fails, the server keeps the existing behaviour: an active account with a one-time temporary password. Existing demo accounts are unchanged and are never forced to verify.

Forgot password sends a 6-digit code valid for 10 minutes (5 attempts, single use) and never reveals whether an address exists. Success revokes every session and does not sign anyone in automatically. Change email sends a code to the **new** address; the old address stays valid until the code is confirmed, then other sessions are revoked. Sending is limited to 3 messages per account per 15 minutes plus a per-IP limit; only SHA-256 invite hashes and HMAC code hashes are stored, never raw tokens or codes.

`MAIL_DRIVER=console` is for development and tests only: it prints the full message (including the invite link) to the server log and keeps an in-memory outbox. It is disabled in production. If `MAIL_DRIVER` is left blank but `SMTP_HOST` or `RESEND_API_KEY` is set, the app auto-detects the correct mail transport. Demo/fake `@sinalhanes.deped.ph` addresses are never sent real mail unless the console driver is selected. Some hosts block outbound SMTP ports; use `resend` in that case. See `.env.example` for every variable.

## What "PWA" means here
Installable (manifest + icons incl. maskable), app shell cached by a service worker so it opens with no signal,
`/api` is never cached, reports made offline are queued on the device and auto-sent (idempotent) when the connection returns,
live updates over Server-Sent Events with polling fallback, browser notifications for new alerts while the app is open/backgrounded.
**Not included:** true push notifications when the app is fully closed (needs Web Push/VAPID keys + a push service) — a good next step.

## Things to verify before real use
* Agency contacts live in **one** file, `shared/agencies.js` (name, focus, how it differs from CDRRMO, contacts, source and lastVerified per agency). `VERIFIED_DATE` is `null`, so the responder Escalation page is captioned "Numbers from the Santa Rosa City Directory" and each card reads "Not yet verified" — set it once the Expert Panel confirms the directory. Numbers appear **only** on that page (plus the school's own number on Parent → Contact School and About).
* Weights, CR and score bands are illustrative until the Expert Panel session. They are read-only in Principal → Admin → System Settings.
* The demo reset endpoint is disabled unless `ALLOW_DEMO_RESET=1`, and demo accounts/incidents are only seeded when their flags are set.
* Time Sensitivity is fixed at 3 (as in the prototype).

## History, archive, hide and purge
Every resolved, false-alarm or cancelled incident moves to **History** for teachers, parents and responders (the responder rail reads **Queue · Escalation · History · Account** — their queue stays open tickets only, closed work lives on History), with full details (urgency reasons in plain words, timeline, who acknowledged/closed). The Principal's official record is **More → Incidents & Records** — three tabs (Real Incidents, Drill Records, System Archives) with a Records → School Year → Month → Category → Zone browser and reporter-by-role detail; past drill logs are read-only there, so Safety only carries the drill/hazard switches. The post-incident breakdown charts live on their own **Analytics** rail tab. Scoring math is not shown to teachers or parents. **Nothing is ever deleted through the UI or the API — no route accepts HTTP `DELETE`.**
* **Per-organization response** — Barangay Sinalhan and CDRRMO each keep their own track (`incident.responses`): the responder's "Your response" card, its stepper and the single next-action button follow only that org, "Other responders" is read-only below it, and the status line names who is furthest ("On site · Barangay Sinalhan") or who closed the ticket ("Resolved by …"). The acting org always comes from the signed-in account — never from the request — each track's timestamps are written once, ticket-level stamps stay the earliest across orgs, and an org may only resolve after its own on-site step. Principal, Teacher and Parent keep the shared ticket-level stepper.
* **My Reports visibility** — a teacher sees a ticket when they are one of its reporters, when its linked section is their class, or when it is whole-school; rows are labelled "You reported", "You also reported" or "Reported in your class" (never another teacher's name) and sit under **Active** or **Earlier** in ONE list with ONE filter. Top chips are All · Active · Resolved · Archived · Hidden; the Filters section carries Status, Relation and Period. Drill tickets go only to the teachers who took part, the archive follows the same rule, and hiding stays per user.
* **HIDE** (Teacher for their own reports, Parent for closed alerts) — a per-user "remove from my list": reversible from the **Hidden** chip, the record itself is unchanged and stays visible to everyone else. Responders have **no hide and no delete**; they can only filter closed tickets out of their queue.
* **ARCHIVE** (Principal) — organization-wide, from **More → Incidents & Records → Real Incidents**: the archive icon on any resolved record moves just that ticket, and the **Archive all resolved** action at the top of the tab moves every resolved report at once (active and ongoing tickets are never touched). A sweep also runs on server start and then hourly (`ASPIRE_ARCHIVE_AFTER_DAYS`, placeholder) and writes one audit entry per run. Archived tickets leave `/api/state` for **every** role and live behind `GET /api/incidents/archive` (paginated, limit 50): Principal/Admin see all, a Responder every archived ticket, a Teacher the same rule as the live list (reporter, their linked section or the whole school), a Parent gets 403. **Restore** on an archived row puts a ticket back in Real Incidents. Archived records live in **System Archives**, which is split into two dedicated archives — **Archived tickets** and **Archived accounts** (Admin only); Responder: **History → View archive**, Teacher: **My Reports → Archived**. A Parent never sees archived tickets.
* **Accounts** — Admin can archive/restore an account (archived = sessions revoked, sign-in blocked with the generic "Invalid email or password.", hidden from rosters; restore forces a password change). The Principal can archive a teacher from the roster, which archives that account. Self-archive and archiving the last active Principal are refused.
* **PURGE** (Admin, typed confirmation) — erases/anonymises personal data of an **archived** record, keeping ids, roles and statistics. The purge icon on an archived ticket is enabled as soon as the record is archived (a typed `PURGE` + a reason are the gate); already-purged rows are not offered again. The placeholder retention periods themselves (set by the school's data protection contact via the `ASPIRE_RETENTION_*` env vars, see `server/retention.js`) are reported as guidance under **About ASPIRE → Retention and purge rules**. Data requests (restrict / erase) are processed from the account detail and need a reference and a reason.

## Principal admin console
Everything the former Super Admin console did lives inside the Principal's **Admin** tab: **Users · Analytics · System Settings · More** switch with an inline row under the single Principal header (there is no second rail). School year, the audit log, Incidents & Records and Account are entries inside **More**, not rail tabs. The default landing (Users) is the interactive user roster whose compact dashboard — Total users, Active responders, Recent security events (last 24 h) — is three equal cards directly under the search and filter row. **More** is a plain list of row links (no duplicate archive widget). The retention policy table is deliberately *not* on the landing: it sits in **About ASPIRE → Retention and purge rules** (expandable), which every role can read.
* `/api/admin/reset` stays POST-only behind `ALLOW_DEMO_RESET`, is refused whenever `NODE_ENV=production`, and is never surfaced in the UI.
* Reporters can cancel their own alert until a responder is on site, unless other people also reported it.

## Dropdowns
Every form dropdown in the app is the shared `src/components/Select.tsx` — never a native `<select>`
(its popup is drawn by the OS and can't follow the design). It keeps the `<select>`-like API
(`value`, `onChange(value)`, `options: { value, label, description?, disabled? }`, `placeholder`,
`label`, `disabled`, `error`), renders a popover on screens ≥ 640px and a bottom sheet below that,
and is keyboard accessible (arrows/Home/End, type-ahead, Enter, Esc closes only the menu).
Use it for form fields. **Filter panels never use a dropdown**: every filter is a section of
tappable chips (single-choice sections start with an "Any …" chip and use `role="radiogroup"`,
multi-choice chips use `aria-pressed`), with counts inside the chip, zero-count chips visible but
disabled, 20px gaps and hairline dividers between sections, and a sticky Reset / "Show N results"
footer under the scrolling body.

## Dates
Date fields use the shared `src/components/DatePicker.tsx` — never a native `<input type="date">`
(its calendar is drawn by the OS and can't follow the design). Type `2026-10-27` or `10/27/2026`
— Enter or blur commits and normalizes to `YYYY-MM-DD`, anything else falls back to the last valid
day and emptying clears it — or open the calendar (popover at ≥ 640px, bottom sheet below), where
the header walks day → month → year grids (and picks walk back out), so nobody arrow-clicks through
a year, a month or a decade.
Record lists (every role's History/My Reports, the Principal audit log, Analytics) choose their
period from the **Period** section inside the Filters panel — Any time, Today, Last 7 days, Last 30
days, This school year, Custom range (which reveals the From/To pickers inline under the chips) —
backed by the pure helpers in `src/lib/filters.ts` (`DateRangeState`, `setPeriod`, `setDateBound`,
`inDateRange`). The period counts as an active filter on the Filters badge and in the results
summary. A page header with a stand-alone filter/period control puts a single Filter icon in the
`actions` slot of the shared back bar instead (the audit log does this).

## Branding
The product name is **ASPIRE**, set in one place: `src/lib/brand.ts`
(keep `index.html` `<title>`, `public/manifest.webmanifest` `name`/`short_name`, and the icon in `public/icons/` in sync).
Palette tokens live in `src/index.css` (`@theme`): brand blue `#425B9A`, sky `#76C0EC`, cream `#FFF6DC`, blush `#FF95A5`.

## Priority-rule features (added on top of AHP–SAW)
| # | Feature | Where |
|---|---|---|
| 1 | **Pupil headcount verification** – group-scope reports only (classroom or whole school); aggregate counts (e.g. 27/28) compared with today's registry; a mismatch forces Critical | Teacher headcount card, Principal More → Headcount status, Parent section count |
| 2 | **Hazard mode** – Principal switches on a flood/typhoon state; Location Risk +2 for ground-floor / low-lying zones, open tickets re-scored live | Principal → More → Safety |
| 3 | **Time-based escalation** – unacknowledged ticket escalates to Barangay Sinalhan (Time Sensitivity +1) then CDRRMO (+2) | automatic |
| 4 | **Critical override (non-compensatory)** – Severity 5 or a headcount mismatch is always CRITICAL | automatic |
| 5 | **Drill mode** – tickets tagged DRILL, parents not alarmed, passive metrics (time to report/acknowledge/on-site/headcount, taps per report) saved per drill | Principal → More → Safety (logs in Incidents & Records) |
| 7 | **English / Filipino advisory templates** for parents (with copy button) | Parent view |
| 8 | **Responder ETA** by transport mode + **approach-route status** (passable / flooded / blocked), report→on-site metric | Responder acknowledge + route control; Principal sees route status read-only in Details |

Not built (listed as future work): #9 nearest-facility escalation map (needs verified facility locations).
All thresholds, boosts and speeds are illustrative until the expert panel validates them.
Remember to update your objectives, Table 14, the HIPO diagrams and the SFD/DFD for anything you keep in scope.
