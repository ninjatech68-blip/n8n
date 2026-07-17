-- Curator schema additions for PRD amendment v1.1, Change A (agentic curator).
--
-- The workflow also creates these tables itself on first use (see the shared
-- `ensureCuratorTables` runtime in tools/create-instagram-carousel-workflow.js,
-- used by the Redundancy Check, Concept Pairing, Model Knowledge Lane, and Mark
-- Concepts Used nodes), so running this file by hand is optional. It exists so
-- the schema is reviewable and so `concept_library` starts seeded instead of
-- empty on a fresh database.
--
-- Note: the existing `content_topics` table is an n8n-managed Data Table
-- (schema owned by the n8n UI, not by this repo), so the new curator fields
-- introduced in this amendment - sourceEngine, nerve, concept, inversion,
-- readerArchetype, indiaContext, juxtapositionPair, payloadType, numberless,
-- subScores, justifications, punchSlideIndex, bandReport, rhythmScore - are
-- carried inside its existing `candidatePoolJson` text column rather than as
-- new typed columns, since this script cannot alter a managed Data Table's
-- column list. If you want those fields queryable as real columns later, add
-- them via the n8n Data Table UI and update the Insert Backlog Cards / Upsert
-- Draft Record / Upsert Published Record nodes to map them directly.

CREATE TABLE IF NOT EXISTS circulating_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  source_engine text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS circulating_takes_created_at_idx ON circulating_takes (created_at DESC);

CREATE TABLE IF NOT EXISTS concept_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  nerve text NOT NULL,
  description text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO concept_library (name, nerve, description) VALUES
  ('loss aversion', 'money', 'People weigh a potential loss roughly twice as heavily as an equivalent gain.'),
  ('sunk cost fallacy', 'money', 'Continuing a bad bet because of what has already been spent, not what remains to be gained.'),
  ('anchoring', 'money', 'The first number seen quietly sets the frame every later number is judged against.'),
  ('mental accounting', 'money', 'The same rupee is spent differently depending on which mental envelope it is filed under.'),
  ('present bias', 'money', 'A smaller reward now beats a larger reward later, even when the math says otherwise.'),
  ('status quo bias', 'status', 'The default option keeps winning simply because changing it takes visible effort.'),
  ('social proof', 'status', 'People copy the crowd as a shortcut for figuring out what is correct or safe.'),
  ('impression management', 'status', 'Behavior calibrated for an audience, not for the actor''s own preference.'),
  ('halo effect', 'status', 'One good trait quietly rewrites how every other trait gets judged.'),
  ('gatekeeping by process', 'status', 'A hoop to jump through exists to protect status, not to protect quality.'),
  ('in-group loyalty', 'belonging', 'Trust extended automatically to people who read as "one of us."'),
  ('reciprocity norm', 'belonging', 'A favor received creates a debt that gets repaid even when unwanted.'),
  ('pluralistic ignorance', 'belonging', 'Everyone privately doubts the norm while assuming everyone else believes it.'),
  ('face-saving', 'belonging', 'A decision optimized to avoid public embarrassment, not to reach the best outcome.'),
  ('parasocial trust', 'belonging', 'Familiarity with a stranger''s public persona gets mistaken for an actual relationship.'),
  ('locus of control', 'control', 'The line between "I did this" and "this happened to me" moves depending on the outcome.'),
  ('decision fatigue', 'control', 'Judgment quality quietly degrades after too many small choices in a row.'),
  ('planning fallacy', 'control', 'A task is expected to take the best-case time even after every past task overran.'),
  ('learned helplessness', 'control', 'Repeated unfixable setbacks train people to stop trying even once a fix becomes possible.'),
  ('hedonic adaptation', 'control', 'A new gain feels thrilling for a while, then quietly resets to the old baseline.'),
  ('curiosity gap', 'curiosity', 'An open question the mind cannot leave alone until it is closed.'),
  ('novelty bias', 'curiosity', 'The new option gets credit it has not earned yet, just for being unfamiliar.'),
  ('narrative bias', 'curiosity', 'A tidy story is believed over a messier, more accurate account of the same facts.'),
  ('survivorship bias', 'curiosity', 'The visible successes are studied while the invisible failures that tried the same thing are ignored.'),
  ('IKEA effect', 'curiosity', 'Effort invested in building something inflates how valuable it is judged to be.')
ON CONFLICT (name) DO NOTHING;
