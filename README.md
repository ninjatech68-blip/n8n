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
- Use `.github/workflows/instagram-carousel-production-smoke.yml` to verify the live Space health endpoint and the preview PNG routes.
- It checks:
  - `GET /healthz`
  - `GET /webhook/instagram-carousel-preview`
  - `GET /webhook/instagram-carousel-preview?set=1`
- No secrets are required for the smoke test itself.

For the Hugging Face route, you will need to set the Space env vars manually in the Hugging Face UI from the values in `.env.hf.example`.

If you are using the Instagram carousel renderer, keep `NODE_FUNCTION_ALLOW_EXTERNAL=sharp` set so the n8n Code node can load `sharp` and return PNG slide images.

Important:
- `private` Spaces are not a good fit for email approval from a phone because the app is not publicly reachable.
- For the Gmail approval flow, use `public` unless you are okay with logging into Hugging Face on the device doing the approval.
- The repo page (`https://huggingface.co/spaces/PS2109/Content_private`) is not the callback URL. The callback URL is the deployed app URL on `hf.space`, for example `https://ps2109-n8n.hf.space/`.
Production bootstrap:
- The Instagram carousel workflow is imported automatically on container boot from `artifacts/hosted-import/instagram-carousel-content-engine.workflow.json`.
- The import targets hosted project `eY86xW2dysjsQrAK`.
- The import is idempotent by workflow id, so restarts update the same workflow instead of creating duplicates.
