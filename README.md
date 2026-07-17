---
title: Piyush LinkedIn Engine
emoji: 🐳
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
---

# n8n local Docker setup

This repository uses PostgreSQL as the default local n8n setup, pinned to the current stable n8n release (`2.22.5`).

## Prerequisites

- Docker
- Docker Compose

## Run default stack

1. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
2. Update `POSTGRES_PASSWORD` in `.env` before starting.
3. Compose reads `.env` for substitution and passes it into the containers.
4. Start n8n with PostgreSQL:
   ```bash
   docker compose up -d
   ```
5. Open:
   - http://localhost:5678

## Approval links and mobile access

If you use approval emails or any other n8n webhook-based callback from a phone or another device, n8n must be reachable at a URL that the device can open.

By default, this repo points n8n at `http://localhost:5678/`, which only works on the same machine. For mobile approval testing, set these values in `.env` to a reachable address:

- `N8N_HOST`
- `N8N_PROTOCOL`
- `N8N_EDITOR_BASE_URL`
- `WEBHOOK_URL`

Examples:

- Same Wi-Fi / LAN: `http://192.168.1.25:5678/`
- Tunnel or reverse proxy: `https://n8n.yourdomain.com/`

After changing the URL, restart the stack:

```bash
docker compose down
docker compose up -d
```

If you want the fastest local workaround, run n8n behind a tunnel and point `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` at that public URL. That is the most reliable fix for Gmail approval buttons on a phone.

### Cloudflare Tunnel option

This repo also includes an optional `cloudflared` service for remote access.

Use this if you want a stable, permanent public URL for Gmail approval links.

1. Create a named Cloudflare Tunnel in Zero Trust.
2. Copy the tunnel token into `.env` as `CLOUDFLARED_TUNNEL_TOKEN`.
3. Route a public hostname, for example `n8n.yourdomain.com`, to the tunnel.
4. Set `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` in `.env` to that public HTTPS URL.
5. Set `N8N_PROXY_HOPS=1`.
6. Start the tunnel profile:

```bash
docker compose --profile tunnel up -d
```

For approval links, the important part is not the tunnel container itself. It is that n8n must generate emails that point to a public HTTPS URL your phone can open. With a named tunnel, that URL stays stable.

## Optional SQLite stack

If you want the lighter SQLite-backed setup instead:

1. Create a SQLite env file:
   ```bash
   cp .env.sqlite.example .env.sqlite
   ```
2. Compose reads `.env.sqlite` for substitution and passes it into the container.
3. Start it:
   ```bash
   docker compose --env-file .env.sqlite -f docker-compose.sqlite.yml up -d
   ```

## Update to the latest stable n8n

Default Postgres stack:

```bash
docker compose pull
docker compose up -d
```

SQLite stack:

```bash
docker compose --env-file .env.sqlite -f docker-compose.sqlite.yml pull
docker compose --env-file .env.sqlite -f docker-compose.sqlite.yml up -d
```

## Data persistence

- n8n data persists in the `n8n_data` Docker volume.
- PostgreSQL data persists in the `postgres_data` Docker volume.

## Hugging Face Space option

If you want the cheapest public host without buying a domain, deploy the `Dockerfile` in this repo to a Hugging Face Docker Space and point n8n at Supabase Postgres.

Recommended files:

- `Dockerfile`
- `.env.hf.example`
- `docs/deployment/hf-space-config.md`
- `docs/deployment/hf-spaces-supabase-plan.md`

Heartbeat idea:
- Use GitHub Actions or another external scheduler to `GET https://ps2109-n8n.hf.space/healthz` every 8 hours.
- That can reduce sleep risk on free Spaces, but it is still a workaround.
- The workflow can use the public health URL directly, so no GitHub secret is required for the ping itself.

DB clearance idea:
- Use the scheduled GitHub Action in `.github/workflows/instagram-carousel-db-cleanup.yml` to purge stale carousel rows from the production `content_topics` table.
- The cleanup policy is defined in `artifacts/hosted-import/instagram-carousel-retention.sql`.
- Required secrets: `PROD_DB_HOST`, `PROD_DB_PORT`, `PROD_DB_NAME`, `PROD_DB_USER`, `PROD_DB_PASSWORD`.

Production smoke test:
- Use `.github/workflows/instagram-carousel-production-smoke.yml` to verify the live Space health endpoint and the debug preview routes.
- It checks:
  - `GET /healthz`
  - `GET /webhook/instagram-carousel-preview`
  - `GET /webhook/instagram-carousel-preview?set=1`
- No secrets are required for the smoke test itself.

For the Hugging Face route, you will need to set the Space env vars manually in the Hugging Face UI from the values in `.env.hf.example`.

If you are using the Instagram carousel renderer, keep `NODE_FUNCTION_ALLOW_EXTERNAL=sharp,pg` set so the n8n Code node can load `sharp` (PNG rendering) and `pg` (curator tables, see below).

The production publishing path also expects these Supabase storage settings in the Hugging Face Space:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

The bucket should be public so Buffer can fetch the uploaded PNG URLs directly.
The preview webhook routes are for manual debugging; the Buffer publish path uses the Supabase public URLs generated during the main workflow run.

Important:
- `private` Spaces are not a good fit for email approval from a phone because the app is not publicly reachable.
- For the Gmail approval flow, use `public` unless you are okay with logging into Hugging Face on the device doing the approval.
- The repo page (`https://huggingface.co/spaces/PS2109/Content_private`) is not the callback URL. The callback URL is the deployed app URL on `hf.space`, for example `https://ps2109-n8n.hf.space/`.
Production bootstrap:
- The Instagram carousel workflow is regenerated from `tools/create-instagram-carousel-workflow.js`, imported, and then repaired on container boot.
- On every boot it refreshes the workflow definition, restores `activeVersionId`, and ensures the preview and slide webhook registrations match the export.
- The import targets hosted project `eY86xW2dysjsQrAK`.
- The import is idempotent by workflow id, so restarts update the same workflow instead of creating duplicates.

## Curator pipeline (agentic sourcing)

Each trigger run harvests candidates (RSS/Reddit feeds plus Google Trends India), then runs them through a
curator pipeline before anything gets drafted:

1. **Harvest & Categorize** scores and dedupes raw candidates from all sources.
2. **Gate Candidates** applies a banned-topic list and reweights scores to fill gaps in the existing backlog
   (so one category or nerve doesn't dominate).
3. **Verify Numeric Claims** fetches the source page for any candidate with a number in it; if the number
   can't be confirmed on the page, the claim is rewritten numberless rather than asserted.
4. **Redundancy Check** kills anything too similar (Jaccard similarity) to recent backlog rows or to
   `circulating_takes`, a running log of ideas that have already circulated.
5. **Concept Pairing** attaches at most one behavioral concept from `concept_library` per card, respecting a
   90-day reuse cooldown.
6. **Model Knowledge Lane** occasionally proposes an evergreen, numberless behavioral card from the model's
   own knowledge (capped at 30% of the backlog, checked against `circulating_takes` at a stricter threshold).
7. **Curator Enrich & Score** is the one high-value LLM call: it takes the gated candidates and produces
   topic cards with an inversion, a named reader archetype, an India-causal explanation, and six sub-scores.
8. **Two-Reader Recheck & Quotas** re-scores a sample with a cheaper model (hostile on freshness for
   model-knowledge cards) and enforces the model-knowledge cap.
9. Surviving cards are upserted into `content_topics` as backlog (`status: 'queued'`); the drafting flow then
   always picks the highest-scoring queued card, so the backlog naturally builds and drains over time instead
   of every run being forced to harvest something fresh.

Two extra Postgres tables back this (`circulating_takes`, `concept_library`); the workflow creates them itself
on first use (`CREATE TABLE IF NOT EXISTS`), or you can apply
`artifacts/hosted-import/instagram-curator-schema.sql` by hand to seed `concept_library` up front. The new
curator metadata (inversion, reader archetype, concept, sub-scores, etc.) is carried inside the existing
`candidatePoolJson` column on `content_topics` rather than as new typed columns, since that table is an
n8n-managed Data Table whose schema this script can't alter.

Optional env vars: `CURATOR_MODEL_TOP` (the enrich-and-score call, defaults to `gpt-5.4`) and
`CURATOR_MODEL_MINI` (recheck, model-knowledge proposals, and band rewrites, defaults to `gpt-5.4-mini`).

## Rhythm and word-band enforcement

After the carousel copy is written, an `Enforce Word Bands & Rhythm` step runs before anything is rendered:

- Slides 1 and 7 are bookends (38-55 words), one slide among 2-6 is the declared punch slide (28-40 words),
  and the rest are essay slides (50-65 words). Slides outside the soft band get one targeted expand/cut
  rewrite; slides still outside the hard band after that get a mechanical safety trim.
- Any slide over 45 words is split into two paragraphs at the sentence boundary closest to the midpoint
  (punch slides stay single-paragraph).
- The renderer enforces a hard 10-line cap per slide at the fitted font size (line-height 1.45, with a 0.8
  line-height gap between paragraph blocks); this is checked pre-render (with one cut rewrite if needed) and
  clamped again defensively inside the SVG renderers themselves.

This replaced the old advisory-only `very_short_slide` / `no_short_punch_slide` checks with hard enforcement.

## Known limitation: Reddit pre-validation

The curator model prompt references upvotes as "pre-validation" for Reddit-sourced cards, but this workflow
fetches Reddit via its public `.rss` feeds, which don't include upvote counts (unlike Reddit's JSON listing
API). `preValidation` is left `null` for Reddit-sourced candidates rather than faked. Switching the Reddit
fetch from RSS to `https://www.reddit.com/r/<sub>/top.json` would restore real upvote/comment numbers if
that matters enough to add the extra HTTP branch.
