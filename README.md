# n8n Personal Content Engine

This repository captures a local n8n-based content engine for Instagram carousel posts and related workflow experiments.

## Local setup

1. Copy one of the env templates:
   - `.env.sqlite.example` for local experiments
   - `.env.postgres.example` for local Postgres
2. Start the stack:
   - `docker compose up -d`
3. Open the editor at:
   - `http://localhost:5678`
4. Import the relevant workflow JSON from `artifacts/hosted-import/`.

## Notes about the current local setup

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
