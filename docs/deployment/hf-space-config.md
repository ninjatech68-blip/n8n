# Hugging Face Space Config

## Recommended Space Settings

- SDK: `Docker`
- App port: `7860`
- Visibility: `public` for remote approval, or `private` only if you are okay with HF-login-gated access
- Space URL: `https://ps2109-n8n.hf.space/`

## Important visibility note

If you want Gmail approval links to work from a phone or any external browser without Hugging Face login, the Space must be publicly reachable.

`private` Spaces are not a good fit for that flow because the app itself is not publicly accessible.

## Files to put in the Space repo root

- `README.md` with Docker Space YAML metadata
- `Dockerfile`
- any app-specific helper files

## README.md front matter

```yaml
---
title: Piyush LinkedIn Engine
emoji: 🐳
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
---
```

## Dockerfile

Use the repo’s [Dockerfile](/Users/piyushsharma/Documents/n8n/Dockerfile) as the base. It already starts n8n on port `7860`.

## Runtime environment variables

Set these in the Space settings:

```env
GENERIC_TIMEZONE=Asia/Kolkata
TZ=Asia/Kolkata
N8N_HOST=0.0.0.0
N8N_PORT=7860
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://ps2109-n8n.hf.space/
WEBHOOK_URL=https://ps2109-n8n.hf.space/
N8N_PROXY_HOPS=1
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
N8N_RUNNERS_ENABLED=true
NODE_OPTIONS=--dns-result-order=ipv4first
NODE_FUNCTION_ALLOW_EXTERNAL=sharp

DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=aws-1-ap-south-1.pooler.supabase.com
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=postgres
DB_POSTGRESDB_USER=postgres.nlmthljrbgnaevheszvg
DB_POSTGRESDB_PASSWORD=<store as HF secret>
DB_POSTGRESDB_SCHEMA=public
DB_POSTGRESDB_SSL_MODE=require
```

## Secrets to add in Hugging Face Space settings

- `DB_POSTGRESDB_PASSWORD`
- optionally `N8N_ENCRYPTION_KEY` if you want stable credential encryption across rebuilds

## External module note

The Instagram carousel renderer uses `sharp` inside an n8n Code node to convert slide SVG layouts into PNGs.

For that to work in the hosted Space:

- build with the repo's [Dockerfile](/Users/piyushsharma/Documents/n8n/Dockerfile)
- keep `NODE_FUNCTION_ALLOW_EXTERNAL=sharp` in the Space environment
- make sure the image builds with `sharp` installed into the n8n runtime

## Supabase pooler note

For Hugging Face Spaces, use the Supabase Session pooler connection values from the Supabase `Connect` panel:

- host: `aws-1-ap-south-1.pooler.supabase.com`
- port: `5432`
- user: `postgres.nlmthljrbgnaevheszvg`
- database: `postgres`

## Heartbeat

Use an external ping so the free Space is less likely to sleep.

Recommended:
- GitHub Actions cron every 8 hours
- ping `https://ps2109-n8n.hf.space/healthz` directly

If you keep the Space private, Gmail approval from a phone will only work if the approving browser can access the private Space (for example, if the device is logged into Hugging Face and the app allows it). For normal unauthenticated remote approval, use `public`.
