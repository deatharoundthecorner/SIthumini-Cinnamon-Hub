# Sithumini Cinnamon Hub — Cloudflare Workers & D1 Deployment Guide

This guide documents the verified zero-monthly-cost starting architecture for Sithumini Cinnamon Hub on Cloudflare, including exact limits, D1 database provisioning, cron triggers, password security, Meta WhatsApp Cloud API rules, and pre-deployment safety precautions.

---

## 1. Cloudflare Workers & D1 Free-Tier Limits & Quotas

| Resource | Official Cloudflare Free Plan Quota | Important Distinction / Behavior |
| :--- | :--- | :--- |
| **Static Assets** | **Free & Unlimited** | Requests to HTML, CSS, JavaScript, WebP images, and static files in `./dist` are served from Cloudflare's edge cache and **do NOT consume Worker request quota**. |
| **Worker Invocations** | **100,000 requests / day** | Applies only to dynamic Worker code executions (e.g. `/api/*` routes, webhooks, and cron triggers). Quota resets daily at 00:00 UTC. |
| **D1 Database Max Size** | **10 GB per database** | The maximum storage capacity supported for an individual Cloudflare D1 database is **10 GB**. |
| **D1 Free Plan Storage** | **5 GB total storage** | The Cloudflare Free tier includes **5 GB total D1 storage** across all databases in the account. |
| **D1 Operations (Free Plan)** | **5,000,000 rows read / day**<br>**100,000 rows written / day** | Explicit daily operational quotas on the Cloudflare Free tier. Resets at 00:00 UTC. |
| **Cloudflare Cron Triggers** | **Up to 3 schedules per Worker** | Permitted frequency down to once per minute (`* * * * *`). Executes the Worker's `scheduled()` handler. |
| **Worker Subdomain** | **Free `*.workers.dev` subdomain** | Provided automatically without requiring purchase of a custom domain or DNS setup. |

### Quota Exhaustion & Error Handling
When the 100,000 requests/day limit or D1 row write quota is reached:
- Cloudflare returns HTTP `1015` or `503 Service Unavailable` for Worker requests.
- D1 queries reject with `D1_ERROR: database or disk full / quota exceeded`.
- **Honest error reporting**: The application frontend does not fake success or fall back to temporary mock states that falsely inform the user or admin that a write succeeded. When a database write fails, the UI displays an explicit error message and preserves unsaved draft inputs.

---

## 2. Meta WhatsApp Cloud API Pricing & Limits

> [!WARNING]
> **Do not promise or assume that all WhatsApp messages are free.**

Meta WhatsApp Cloud API enforces a conversation-based pricing model:
- **Free Tier Allowance**: **1,000 user-initiated Service conversations per calendar month** per WhatsApp Business Account (WABA).
- **Service Conversations**: When a customer messages your business first, a 24-hour customer service window opens. Free tier applies to these inbound-initiated conversations.
- **Business-Initiated Conversations**: Any outbound message sent outside the 24-hour service window requires a pre-approved template and is **charged per conversation according to Meta's regional rate card** (Sri Lanka and international destination rates vary).
- **Billing Requirements**: A valid credit card or payment method must be attached in Meta Business Manager to avoid delivery interruptions when sending outbound notifications.

---

## 3. Pre-Deployment Review & Secret Protection Rules

> [!CAUTION]
> **CRITICAL PRECAUTION: Do NOT set production secrets during the local review phase.**
> Running `wrangler secret put <NAME>` automatically creates and **immediately deploys a new Worker version** with that secret.
> Keep all secrets local in `.dev.vars` until the implementation is approved for production deployment.

1. **Local Configuration**: Copy `.dev.vars.example` to `.dev.vars` for local testing with `npx wrangler dev`.
2. **Never Commit Secrets**: Ensure `.dev.vars` remains in `.gitignore`.
3. **No Hardcoded Passwords**: All admin passwords must use salted PBKDF2-SHA256 hashes.

---

## 4. Admin Password Hashing Format (PBKDF2-SHA256)

Store password hashes in the versioned format:
```
pbkdf2_sha256$100000$<32_hex_salt>$<64_hex_hash>
```

### How to Generate a Compliant Hash Locally
Run the following Node.js one-liner in your terminal:
```bash
node -e "const crypto=require('crypto'); const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.pbkdf2Sync('YOUR_STRONG_PASSWORD', Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex'); console.log('pbkdf2_sha256$100000$' + salt + '$' + hash)"
```

The generated string should be assigned to `ADMIN_PASSWORD_HASH` in your Worker configuration.

---

## 5. Step-by-Step Deployment Instructions (When Approved)

### Step 5.1: Create the Cloudflare D1 Database
```bash
npx wrangler d1 create sithumini-hub-db
```
Output example:
```text
✅ Successfully created DB 'sithumini-hub-db' with ID 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
```

Update `wrangler.jsonc` with the real database ID returned by Cloudflare:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "sithumini-hub-db",
    "database_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "migrations_dir": "d1/migrations"
  }
]
```

### Step 5.2: Apply Migrations to Remote D1
Execute the initial schema and seed migrations on the remote Cloudflare D1 database:
```bash
npx wrangler d1 migrations apply sithumini-hub-db --remote
```
Verify remote catalog parity:
```bash
npx wrangler d1 execute sithumini-hub-db --remote --command "SELECT id, name, stock, is_active FROM products LIMIT 5;"
```

### Step 5.3: Set Production Secrets (One-time, only upon deployment approval)
```bash
# 1. Admin Credentials
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put SESSION_SECRET

# 2. Meta WhatsApp Cloud API
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put OWNER_PHONE_NUMBER

# 3. Cron & Diagnostic Token
npx wrangler secret put CRON_SECRET
```

### Step 5.4: Build & Deploy Frontend and Worker
```bash
# 1. Build Vite frontend to ./dist
npm run build

# 2. Deploy Worker with Static Assets and Cron Triggers
npx wrangler deploy
```

The site will be live at:
`https://sithumini-cinnamon-hub.<your-subdomain>.workers.dev`

### Step 5.5: Configure Meta WhatsApp Webhook in App Dashboard
1. Go to **Meta for Developers** > **Your App** > **WhatsApp** > **Configuration**.
2. Set **Callback URL**: `https://sithumini-cinnamon-hub.<your-subdomain>.workers.dev/api/whatsapp/webhook`
3. Set **Verify Token**: Matching `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and Save**.
5. Under **Webhook fields**, subscribe to **`messages`**.

---

## 6. Architecture & File Reference

- `wrangler.jsonc`: Cloudflare Worker configuration, D1 database binding, static asset directory (`./dist`), and cron trigger schedule.
- `worker/index.js`: Primary entry point handling static asset serving, SPA client routing, and `/api/*` route handling.
- `worker/db.js`: D1 SQLite database interface with atomic transactions, price recalculation, and durable inbox queueing.
- `worker/auth.js`: PBKDF2-SHA256 password hashing and Web Crypto HMAC-SHA256 stateless cookie session management.
- `worker/whatsapp.js`: Meta WhatsApp Cloud API integration, raw-body HMAC-SHA256 verification, and conversation state machine.
- `worker/inboxWorker.js`: Durable inbox queue worker with exponential backoff and dead-letter protection.
- `d1/migrations/`: Versioned SQLite migrations (`0001_initial_schema.sql`, `0002_seed_catalogue.sql`).
- `scripts/compare_catalogue.js`: Integrity and parity verification script ensuring 100% catalog fidelity and zero invented inventory.
