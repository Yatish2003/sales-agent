# Mudita — Northlight Analytics assignments

Monorepo with a **React/Vite frontend** and a **Node/Express backend**. The browser never holds secrets, never talks to Postgres, and never receives webhooks. It only `fetch()`es `/api/*` (plus SSE on the agents run view).

| App | Path | Role |
| --- | --- | --- |
| Frontend | `/frontend` | Two routes: `/sales-assistant`, `/agents` |
| Backend | `/backend` | Webhooks, Prisma/Postgres, conversation engine, calendar, three agents |

## WhatsApp via Twilio Sandbox (BSP)

HR confirmed in writing that a live Meta Developer app is **not** required for WhatsApp: a BSP is acceptable. This repo uses **Twilio’s WhatsApp Sandbox** as that BSP — a real webhook + REST send path, without Meta’s app-review queue.

Point the sandbox “when a message comes in” webhook at the deployed backend:

`POST https://<your-backend>/api/webhooks/whatsapp`

(Twilio sends `application/x-www-form-urlencoded` with `From` / `Body`. Replies go out through `client.messages.create`, not Graph API.)

Instagram was **not** covered by that HR reply. The verify + inbound routes exist at `/api/webhooks/instagram`. Until Messaging API access is approved, the POST handler returns an honest `incomplete` payload instead of faking delivery.

## Architecture

```
Browser  --fetch/SSE-->  Express  --Prisma-->  Postgres
                           |-- AWS Bedrock (Claude)
                           |-- Twilio WhatsApp
                           |-- Google Calendar
                           |-- Email inbound webhook
```

**Assignment 1** — Sales assistant for fictional **Northlight Analytics**. ICP is defined first-class in `backend/src/lib/policy/businessPolicy.ts`. Qualification is LLM-structured JSON; **rep assignment is a TypeScript rules engine** (`routing.ts`), never model-decided. Named fallbacks: missing-info, ambiguous, policy-override, low-confidence, human-takeover — each logged on the action timeline.

**Assignment 2** — Intake → Planning → Review as separate functions, prompts, Zod contracts, and persisted `HandoffMessage` rows. Company rules (2-week sprints, max 3 tasks/owner, fixed 5-person roster) are re-applied in code after Planning proposes. Review can send corrections back, capped at 3 attempts.

Live agent updates: **SSE** on `GET /api/agents/:runId/stream`, with a 2.5s poll fallback. Session id is stored in `localStorage` and sent as `x-session-id` so two browsers do not share runs.

## Setup

Requires Node 18+ and a Postgres database (Neon, Supabase, or `docker compose up -d`).

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# set DATABASE_URL and AWS Bedrock vars in backend/.env

npm install
cd backend && npx prisma generate && npx prisma migrate deploy && cd ..
npm run dev:backend   # :4000
npm run dev:frontend  # :5173
```

The API **will not start** without `DATABASE_URL`, `AWS_REGION`, `BEDROCK_MODEL_ID`, and IAM keys. There is no LLM mock path — every qualification and agent step calls Bedrock.

### Env vars

**Frontend (`VITE_*` only — never secrets)**

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend origin. Empty in Vite dev uses the `/api` proxy. |

**Backend**

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 4000). Hosts often set this. |
| `FRONTEND_ORIGIN` | CORS allowlist (exactly the deployed frontend origin, no trailing slash) |
| `DATABASE_URL` | Postgres connection string |
| `AWS_REGION` | Bedrock region (model must be enabled there) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user with `bedrock:InvokeModel` |
| `BEDROCK_MODEL_ID` | e.g. `anthropic.claude-3-haiku-20240307-v1:0` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console |
| `TWILIO_WHATSAPP_NUMBER` | Sandbox sender, e.g. `whatsapp:+17372508034` |
| `TWILIO_WEBHOOK_URL` | Full public URL Twilio POSTs to (must match Console exactly) |
| `EMAIL_WEBHOOK_SECRET` / `EMAIL_FROM` | Inbound email |
| `INSTAGRAM_*` | Meta Messaging (optional; blocked without review) |
| `GOOGLE_CALENDAR_*` | Service account + calendar IDs; without them, busy/book is mocked and logged as mock |

## Tests

```bash
npm test
```

Vitest covers: routing rules, idempotent booking decisions, Zod handoff schemas, Review retry cap + max-3-per-owner enforcement.

## Approximate model cost

Logged in-process via `GET /api/agents/usage` using approximate Claude 3 Haiku on-demand list prices. A typical three-agent run with one Review bounce is usually well under a few cents (see `estimatedUsd` after a live run).

## Known limitations

- Instagram Messaging API is **not** live; blocker is Meta app review (HR only signed off WhatsApp via BSP).
- Google Calendar is wired but falls back to a lunch-hour busy mock when credentials are missing — never reports fake confirmed Google event IDs as real (`googleEventId` prefixed `mock-`).
- Email outbound is logged to the server console until an ESP is configured.
- Prisma requires a reachable `DATABASE_URL`; unit tests that import the calendar module instantiate Prisma Client but do not hit the database.
- Claude on Bedrock must be **enabled in `AWS_REGION`**. Mumbai (`ap-south-1`) does not always list every Anthropic model — if invoke fails, switch region (often `us-east-1`) and the matching model id.

## Deploy

1. **Backend** (Render or Railway): root or `backend` workspace, Node 18+, start `npm start -w backend` (or `cd backend && npm start`). Set `PORT` (platform), `DATABASE_URL`, `FRONTEND_ORIGIN`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`. Bind is `0.0.0.0`.
2. **Frontend** (Vercel): root directory `frontend`. Build env `VITE_API_BASE_URL=https://your-backend.onrender.com` (no trailing slash).
3. After the Vercel URL exists, set backend `FRONTEND_ORIGIN` to that URL and redeploy the API.
4. Twilio sandbox webhook (optional): `https://<backend>/api/webhooks/whatsapp`.
