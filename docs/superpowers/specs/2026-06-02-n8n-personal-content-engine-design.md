# n8n Personal Content Engine Design

## Goal
Build a personal LinkedIn content system in n8n that:
- discovers ideas from free, reliable sources,
- turns them into human-like LinkedIn posts,
- optionally generates an image,
- auto-publishes some posts when confidence is high,
- routes lower-confidence posts to human approval,
- logs every step so the workflow stays debuggable and maintainable.

## Scope
This design covers a personal-use workflow stack, not a multi-user product.

In scope:
- topic ingestion from free sources,
- scoring and deduplication,
- post drafting in a personal voice,
- optional image generation,
- auto-publish vs review branching,
- publishing to LinkedIn,
- logging and failure handling.

Out of scope:
- multi-tenant user management,
- paid source aggregation services,
- social listening on private data,
- complex editorial team workflows,
- real-time streaming ingest.

## Recommended Architecture
Use three n8n workflows with shared state storage:

1. **Ingest workflow**
   - pulls topics from feeds and source pages on a schedule,
   - normalizes records,
   - deduplicates and scores them,
   - stores candidate topics in a queue table.

2. **Draft workflow**
   - selects a topic from the queue,
   - generates a brief,
   - writes a LinkedIn post in your voice,
   - decides whether an image is needed,
   - stores draft output and confidence metadata.

3. **Publish workflow**
   - checks auto-publish eligibility,
   - sends some drafts directly to LinkedIn,
   - routes others to human approval,
   - updates the source record with final outcome.

This separation keeps the system easy to reason about and lets each workflow fail independently without breaking the whole pipeline.

## Source Strategy
Use free, reliable, mostly machine-readable sources.

### Primary sources
- Official company blogs and newsroom pages
- Product update pages
- Investor relations pages
- Earnings release pages
- Official AI lab announcements
- Research feeds such as arXiv

### Secondary sources
- Reuters
- TechCrunch
- VentureBeat
- MIT Technology Review
- Google Trends
- Hacker News
- Product Hunt

### Source policy
- Prefer official announcements for factual claims.
- Use secondary sources for topic discovery and framing.
- Use community/trend sources only for idea generation, not as the final factual basis.
- Avoid random social posts as primary evidence.

## Data Model
Store each topic as a single record with these fields:
- `id`
- `source_name`
- `source_type`
- `title`
- `url`
- `published_at`
- `fetched_at`
- `summary`
- `category`
- `dedupe_hash`
- `source_trust_score`
- `topic_relevance_score`
- `freshness_score`
- `post_potential_score`
- `auto_publish_score`
- `status`
- `draft_text`
- `image_required`
- `image_prompt`
- `approval_state`
- `publish_result`
- `error_message`
- `linkedin_post_url`
- `final_post_text`

Suggested statuses:
- `new`
- `normalized`
- `scored`
- `queued`
- `drafted`
- `image_ready`
- `needs_review`
- `approved`
- `auto_publish_ready`
- `published`
- `failed`
- `quarantined`

## n8n Workflow 1: Ingest

### Purpose
Collect fresh ideas from trusted sources and convert them into structured topic records.

### Node flow
1. **Schedule Trigger**
   - runs 2 to 4 times per day for personal use.

2. **RSS / HTTP fetch nodes**
   - one node per source group, not one per individual source when possible.

3. **Code / Set normalization node**
   - extracts title, URL, timestamp, short summary, and source metadata.

4. **Deduplication check**
   - hash title + source + normalized URL,
   - skip if the same idea already exists in the recent history window.

5. **Scoring node**
   - assigns scores for relevance, freshness, trust, and post potential.

6. **Queue writer**
   - saves approved candidates to shared storage.

### Ingest scoring rules
Score each incoming item from 0 to 100.

Recommended weights:
- relevance to AI / corporate change: 35
- source trust: 25
- freshness: 20
- post potential: 20

Suggested ingest thresholds:
- `80+`: strong candidate, queue for drafting
- `60-79`: queue only if inventory is low
- `<60`: ignore or store for reference only

## n8n Workflow 2: Draft

### Purpose
Turn a queued topic into a human-like post and decide whether an image should be generated.

### Node flow
1. **Manual trigger or queue trigger**
   - run on demand or when a new high-score item appears.

2. **Topic selector**
   - loads the next queued item with the highest score.

3. **Angle selector**
   - classifies the topic into one of:
     - trend summary
     - practical implication
     - contrarian take
     - executive insight
     - lesson / takeaway

4. **Brief generator**
   - creates a short content brief with hook, angle, audience, CTA, and length target.

5. **Style prompt node**
   - injects your personal writing rules:
     - concise,
     - factual,
     - human,
     - no jargon unless needed,
     - no cringe startup language,
     - no unsupported hype.

6. **LLM post writer**
   - drafts the post in LinkedIn-ready form.

7. **Quality checks**
   - length under limit,
   - no obvious duplication,
   - no banned phrases,
   - no unsupported factual claims,
   - tone matches target style.

8. **Image decision node**
   - sets `image_required = true` when:
     - the topic is visual by nature,
     - the post is a list, framework, or comparison,
     - the post will benefit from a visual summary,
     - the score is high enough to justify extra effort.

9. **Image prompt generator**
   - if needed, creates a prompt for image generation.

10. **Draft saver**
   - stores final draft, confidence, and image fields.

### Drafting rules
The post writer should produce:
- a strong hook in the first 1-2 lines,
- a short middle section with one clear takeaway,
- a practical implication for business or careers,
- a closing line that invites reflection or discussion,
- optional hashtags, kept minimal.

### Human-like writing constraints
The content engine should:
- avoid generic “thought leadership” filler,
- vary sentence length,
- prefer plain language,
- use concrete examples,
- avoid overusing em dashes, emojis, and buzzwords,
- preserve a natural, opinionated but measured tone.

## n8n Workflow 3: Publish

### Purpose
Route a draft to the correct publish path: auto-publish or human review.

### Node flow
1. **Draft loader**
   - loads the next draft ready for publish.

2. **Publish gate**
   - checks:
     - source trust,
     - topic sensitivity,
     - factual confidence,
     - uniqueness,
     - image readiness,
     - personal publish cadence.

3. **Branch: auto-publish**
   - only for high-confidence, low-risk content.

4. **Branch: human review**
   - sends a review request with:
     - post draft,
     - source URL,
     - summary,
     - confidence score,
     - image preview or prompt if available.

5. **LinkedIn publisher**
   - posts text-only or text-plus-image content.

6. **Final logger**
   - stores publication result, post URL, timestamps, and any errors.

### Auto-publish policy
Auto-publish only when all are true:
- source is trusted,
- topic is not breaking news,
- topic is not controversial,
- post score is above threshold,
- confidence is high,
- image, if needed, is successfully generated,
- no manual review flag is set.

Suggested auto-publish threshold:
- `auto_publish_score >= 85`

Suggested review threshold:
- `70 <= auto_publish_score < 85`

Suggested reject/quarantine threshold:
- `< 70`

## Image Strategy
Use images selectively, not for every post.

### When to generate an image
- comparisons
- frameworks
- trend summaries
- key takeaways
- posts that benefit from a visual hook

### When not to generate an image
- breaking news commentary
- short opinion posts
- highly factual or nuanced updates
- posts where a visual would add little value

### Image generation behavior
- generate only after the post draft is approved by the drafting stage,
- create an image prompt from the final angle, not from raw source text,
- if image generation fails, fall back to text-only publish or human review depending on confidence.

## Human Review Model
For personal use, review should be fast and lightweight.

Review packet should include:
- final draft,
- source link,
- scoring breakdown,
- image preview or prompt,
- one-line reason for auto-publish eligibility or review.

Review actions:
- `approve`
- `edit`
- `reject`
- `hold`

If the user edits the post, the system should re-run only the final publish checks, not the full ingest pipeline.

## Error Handling
Handle failures at the smallest useful boundary.

### Ingest failures
- retry transient RSS/HTTP failures,
- quarantine sources that repeatedly fail,
- keep a source health score.

### Draft failures
- fall back to human review when the model output is malformed,
- keep the last good prompt version,
- log prompt and output pair for debugging.

### Image failures
- do not fail the entire workflow on image generation issues,
- downgrade to text-only publish when allowed,
- send to review if the post depends on the image.

### Publish failures
- retry transient LinkedIn/API failures,
- avoid duplicate publish attempts by storing a publish lock,
- record exact error messages and timestamps.

### Data safety
- keep raw source content separate from final written drafts,
- store published results separately from draft records,
- never overwrite the original topic record without versioning.

## Observability
Add lightweight visibility from day one.

Track:
- how many topics were ingested,
- how many were deduped,
- how many were drafted,
- how many were auto-published,
- how many required review,
- how many failed at each step,
- which sources produce the best posts.

Use a simple dashboard or sheet if you want to stay lightweight.

## Testing Plan
Test the pipeline in layers.

### Source tests
- RSS feeds parse correctly,
- HTTP pages return expected fields,
- broken feeds do not break the whole run.

### Scoring tests
- AI/corporate trend topics score higher than generic news,
- weak or duplicate topics score lower,
- stale items do not get queued.

### Draft tests
- output stays within LinkedIn length limits,
- tone matches the personal style rules,
- hallucination risk is caught before publish.

### Publish tests
- auto-publish gate only passes high-confidence content,
- review branch gets triggered for uncertain content,
- image and text-only branches both work.

### Operational tests
- duplicate prevention works,
- retries do not create duplicate posts,
- logs contain enough data to diagnose failures.

## Implementation Notes
- Keep the first version simple.
- Favor RSS and official pages over scraping-heavy sources.
- Use one canonical storage layer for topics and states.
- Avoid creating too many special cases early.
- Tune thresholds after the first 20 to 30 posts.

## Success Criteria
The system is successful when:
- it reliably finds relevant AI/corporate topics,
- it drafts posts that sound human,
- it can optionally attach an image,
- it can safely auto-publish low-risk posts,
- it routes ambiguous posts to review,
- it logs enough detail to troubleshoot and improve it.
