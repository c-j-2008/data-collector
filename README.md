# Data Collector — Digital Privacy Research

An educational Cloudflare Worker application that demonstrates a small, consented set of data a website can receive: a persistent browser research UUID, the visitor connection IP visible to the server, and browser-provided location only after permission. It then provides an accessible scam prevention guide.

The site does not fingerprint visitors, obtain private network addresses, or collect data before affirmative consent. A browser UUID identifies a browser profile only; it does not establish a physical identity. Private IP discovery through techniques such as WebRTC is deliberately not implemented because it would be inappropriate for this consented research demonstration.

## Technology

- Cloudflare Workers for the application and API
- Cloudflare D1 (`data-collector-db`) for persistent records
- Plain HTML, CSS, and browser JavaScript
- Wrangler for local development, migrations, and deployment

## Setup

1. Install Node.js 20+ and run `npm install`.
2. Authenticate Wrangler: `npx wrangler login`.
3. Copy `.dev.vars.example` to `.dev.vars`, then replace `SESSION_SECRET` with a long random value. `ADMIN_PASSWORD=1256` is only for local development.
4. Apply the supplied migration to the existing remote D1 database: `npm run db:migrate:remote`.
5. Start the app: `npm run dev`.

For a deployed Worker, configure these encrypted Worker secrets before deploying:

```text
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

Use a strong admin password in every deployed environment. The Worker will only accept the `1256` fallback when the request host is `localhost`; production requires `ADMIN_PASSWORD`. `wrangler.toml` already binds the existing database ID `9226545f-7f5a-4f8c-9f65-6909b48c3914` as `DB`. Deploying or deleting this Worker does not delete the independently managed D1 database.

## Database

Migration `migrations/0001_initial.sql` creates:

- `research_profiles`: one row per browser UUID, with its first-seen UTC timestamp.
- `research_submissions`: consented visits containing UUID, optional latitude/longitude, location status, incoming IP representation, consent state, and UTC submission timestamp.

All access uses D1 prepared statements. The dashboard requires a signed, HttpOnly session cookie. Its API endpoints cannot be accessed without that session.

## Consent and data controls

The visitor must first pass the demonstration CAPTCHA, read the disclosure, tick a consent checkbox, and choose whether to share location. Selecting “Skip location” still allows the scam prevention content. The server records the connection IP from Cloudflare’s incoming request header; it cannot reliably receive a visitor’s private LAN address, and this project makes no attempt to obtain one.

Authenticated administrators can search and filter records, inspect a record, delete one record, clear all records, and export CSV or JSON. These actions happen from the **Research Data** button.

## Backup and recovery

Use the dashboard’s JSON/CSV export for routine portable backups. For an independent D1 backup, run `npx wrangler d1 export data-collector-db --remote --output=backup.sql` and store the timestamped output outside this repository. This project never deletes historical data during deployment or migrations; the clear/delete controls require an authenticated administrator’s explicit action.

## Production notes

Serve the deployed Worker via HTTPS (Cloudflare provides HTTPS for Workers routes). Set `ADMIN_PASSWORD` and `SESSION_SECRET` as Worker secrets rather than files or frontend values. Review your participant notice, retention period, lawful basis, and applicable privacy obligations before collecting research data.
