# Hugging Face Spaces + Supabase Deployment Plan

## Goal
Run the n8n workflow remotely with the lowest practical cost, without buying a domain, while keeping:
- Gmail approval working from phone or desktop
- Buffer publishing working
- shared workflow state persistent
- a lightweight heartbeat to reduce free-space sleep risk

## Why this path
Hugging Face Spaces can host a Docker app, and Supabase can hold the workflow database and shared records.
This is the best low-cost option if you want a public URL without buying a domain.

## Recommended shape
- **Hugging Face Space**: runs n8n in Docker
- **Supabase**: stores workflow tables and persistent app state
- **Heartbeat ping**: external job that hits `https://ps2109-n8n.hf.space/healthz` directly to keep the Space warm
- **Gmail approval**: approval links point to the public Space URL

## Important constraint
Free Hugging Face Spaces can sleep after inactivity. A heartbeat helps, but it is still a workaround, not the same as an always-on VPS.

## Plan of work
1. Move the current local Docker setup into a Hugging Face Docker Space.
2. Replace local Postgres with Supabase Postgres.
3. Point n8n webhook/editor URLs at the Space URL.
4. Add a simple health endpoint for external pinging.
5. Add an external heartbeat job:
   - GitHub Actions cron every 8 hours, or
   - another free scheduler
6. Verify:
   - Gmail approval resumes the workflow
   - Buffer receives approved posts
   - records are written back to Supabase

## What I need from you
1. **Hugging Face account**
   - confirm you have one
   - Space name: `n8n`
   - Space URL: `https://ps2109-n8n.hf.space/`

2. **Supabase account**
   - confirm you have one
   - project URL: `https://nlmthljrbgnaevheszvg.supabase.co`

3. **Space visibility**
   - `public`

4. **Persistence preference**
   - use Supabase only for persistence
   - or also add Hugging Face persistent disk later if needed

5. **Heartbeat preference**
   - GitHub Actions cron
   - external uptime ping service
   - no heartbeat, accept sleep risk

6. **Approval mode**
   - keep Gmail approval
   - or switch to a different approval path later

7. **Buffer channel**
   - confirm the LinkedIn channel in Buffer stays the same

## What I can do next once you confirm
- rewrite the local setup for Spaces
- add a `/health` route or equivalent ping target
- prepare Supabase env mappings
- prepare the GitHub Actions heartbeat if you choose that option
- update the workflow URLs for the hosted deployment

## Recommended decision
If you want the cheapest usable setup:
- Hugging Face Space on free CPU
- Supabase free tier
- GitHub Actions heartbeat
- Gmail approval

That is the lowest-cost route that still has a real public URL and persistent state.
