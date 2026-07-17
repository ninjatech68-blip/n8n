#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Shared runtime snippets, interpolated into multiple n8n Code node jsCode strings so the
// word-band / gating / corpus-similarity / Postgres logic has one source of truth in this
// generator even though each Code node executes in its own isolated n8n sandbox.

const WORD_BAND_RUNTIME = `
const WORD_BANDS = {
  essay: { target: [50, 65], soft: { under: [40, 49], over: [66, 80] }, hard: { min: 30, max: 80 } },
  punch: { target: [28, 40], soft: { over: [41, 48] }, hard: { min: 18, max: 48 } },
  bookend: { target: [38, 55], soft: { under: [30, 37], over: [56, 65] }, hard: { min: 25, max: 70 } },
  mini: { target: [45, 65], soft: { under: [35, 44], over: [66, 75] }, hard: { min: 25, max: 80 } },
  observation: { target: [38, 50], soft: { under: [30, 37], over: [51, 58] }, hard: { min: 22, max: 60 } },
  card: { target: [30, 60], soft: { under: [22, 29], over: [61, 70] }, hard: { min: 15, max: 75 } },
};

function countWords(text) {
  return String(text || '').trim().split(/\\s+/).filter(Boolean).length;
}

function classifySlideRole(order, total, punchSlideIndex) {
  if (order === 1 || order === total) return 'bookend';
  if (punchSlideIndex && Number(punchSlideIndex) === Number(order)) return 'punch';
  return 'essay';
}

function checkBand(role, wordCount) {
  const band = WORD_BANDS[role] || WORD_BANDS.essay;
  const result = { role: role, wordCount: wordCount, target: band.target, hardMin: band.hard.min, hardMax: band.hard.max };
  if (wordCount < band.hard.min || wordCount > band.hard.max) {
    result.verdict = 'hard_fail';
    result.direction = wordCount < band.hard.min ? 'expand' : 'cut';
    return result;
  }
  if (wordCount >= band.target[0] && wordCount <= band.target[1]) {
    result.verdict = 'target';
    result.direction = null;
    return result;
  }
  if (band.soft.under && wordCount >= band.soft.under[0] && wordCount <= band.soft.under[1]) {
    result.verdict = 'soft_under';
    result.direction = 'expand';
    return result;
  }
  if (band.soft.over && wordCount >= band.soft.over[0] && wordCount <= band.soft.over[1]) {
    result.verdict = 'soft_over';
    result.direction = 'cut';
    return result;
  }
  result.verdict = 'target';
  result.direction = null;
  return result;
}

function wrapLines(text, maxCharsPerLine) {
  const words = String(text || '').split(/\\s+/).filter(Boolean);
  const out = [];
  let line = [];
  for (const word of words) {
    const candidate = line.concat([word]).join(' ');
    if (candidate.length > maxCharsPerLine && line.length) {
      out.push(line.join(' '));
      line = [word];
    } else {
      line.push(word);
    }
  }
  if (line.length) out.push(line.join(' '));
  return out;
}

function splitSentences(text) {
  const matches = String(text || '').match(/[^.!?]+[.!?]*/g);
  return matches ? matches.map(function (entry) { return entry.trim(); }).filter(Boolean) : [String(text || '').trim()].filter(Boolean);
}

function splitParagraphs(text, maxWordsBeforeSplit) {
  const trimmed = String(text || '').trim();
  const threshold = maxWordsBeforeSplit || 45;
  if (countWords(trimmed) <= threshold) return [trimmed];
  const sentences = splitSentences(trimmed);
  if (sentences.length < 2) return [trimmed];
  const midpointChar = trimmed.length / 2;
  let bestIndex = 0;
  let bestDistance = Infinity;
  let runningLength = 0;
  for (let i = 0; i < sentences.length - 1; i++) {
    runningLength += sentences[i].length + 1;
    const distance = Math.abs(runningLength - midpointChar);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const first = sentences.slice(0, bestIndex + 1).join(' ').trim();
  const second = sentences.slice(bestIndex + 1).join(' ').trim();
  return [first, second].filter(Boolean);
}

function renderedLineCount(paragraphs, maxCharsPerLine) {
  let total = 0;
  for (const paragraph of paragraphs) {
    total += wrapLines(paragraph, maxCharsPerLine).length;
  }
  return total;
}

function sentenceMixWarnings(text) {
  const wordCounts = splitSentences(text).map(function (sentence) {
    return sentence.split(/\\s+/).filter(Boolean).length;
  });
  const warnings = [];
  if (!wordCounts.some(function (count) { return count <= 8; })) warnings.push('no_short_sentence');
  for (let i = 0; i < wordCounts.length - 1; i++) {
    if (wordCounts[i] > 20 && wordCounts[i + 1] > 20) warnings.push('consecutive_long_sentences');
  }
  return warnings;
}
`;

const BANNED_LIST_RUNTIME = `
const BANNED_PATTERNS = [
  { name: 'partisan_politics', pattern: /\\b(bjp|congress party|\\baap\\b|\\brss\\b|modi govt|election (rigging|fraud)|vote for|political party)\\b/i },
  { name: 'named_person_criticism', pattern: /\\b(elon musk|mark zuckerberg|narendra modi|rahul gandhi) is (a fraud|a scammer|an idiot|corrupt)\\b/i },
  { name: 'medical_directive', pattern: /\\b(take (this|these) (pill|medicine|dose)|stop taking your medication|cures? (cancer|diabetes)|do not vaccinate)\\b/i },
  { name: 'financial_directive', pattern: /\\b(buy (this )?stock|guaranteed returns|invest all your (savings|money) in|financial advice ?:)\\b/i },
  { name: 'religion_as_opinion', pattern: /\\breligion is (fake|a lie|the problem)|god does not exist|only .* religion is true\\b/i },
  { name: 'west_first', pattern: /\\b(in america|in the u\\.?s\\.?|americans (always|never)|in the west)\\b/i },
  { name: 'doom_without_floor', pattern: /\\b(everything is (ruined|doomed|over)|there is no (hope|way out|solution)|nothing (can|will) (fix|change) this)\\b/i },
];

function findBannedMatch(text) {
  const value = String(text || '');
  for (const entry of BANNED_PATTERNS) {
    if (entry.pattern.test(value)) return entry.name;
  }
  return null;
}
`;

const CORPUS_SIMILARITY_RUNTIME = `
function normalizeCorpusText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

const CORPUS_STOPWORDS = ['the','and','for','with','from','that','this','have','will','your','you','are','new','how','can','our','their','about','into','what','when','why','who','but','not','all','now','use','uses','used','india','indian','very','more','most','just','also','than','then','them','they','been'];

function tokenizeCorpusText(text) {
  return normalizeCorpusText(text)
    .split(' ')
    .filter(Boolean)
    .filter(function (token) { return token.length > 2; })
    .filter(function (token) { return CORPUS_STOPWORDS.indexOf(token) === -1; });
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenizeCorpusText(a));
  const setB = new Set(tokenizeCorpusText(b));
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  for (const token of setA) if (setB.has(token)) overlap++;
  const union = new Set(Array.from(setA).concat(Array.from(setB)));
  return overlap / union.size;
}
`;

const PG_CONNECTION_RUNTIME = `
async function withPgClient(fn) {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST,
    port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
    database: process.env.DB_POSTGRESDB_DATABASE,
    user: process.env.DB_POSTGRESDB_USER,
    password: process.env.DB_POSTGRESDB_PASSWORD,
    ssl: String(process.env.DB_POSTGRESDB_SSL_MODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureCuratorTables(client) {
  await client.query(
    'CREATE TABLE IF NOT EXISTS circulating_takes (' +
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ' +
    'text text NOT NULL, ' +
    'source_engine text, ' +
    'category text, ' +
    'created_at timestamptz NOT NULL DEFAULT now())'
  );
  await client.query(
    'CREATE TABLE IF NOT EXISTS concept_library (' +
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ' +
    'name text UNIQUE NOT NULL, ' +
    'nerve text NOT NULL, ' +
    'description text, ' +
    'last_used_at timestamptz, ' +
    'created_at timestamptz NOT NULL DEFAULT now())'
  );
}
`;

function id() {
  return crypto.randomUUID();
}

function node({ name, type, typeVersion, position, parameters = {}, credentials, webhookId }) {
  const out = {
    id: id(),
    name,
    type,
    typeVersion,
    position,
    parameters,
  };
  if (credentials) out.credentials = credentials;
  if (webhookId) out.webhookId = webhookId;
  return out;
}

function buildWorkflow() {
  const scheduleTrigger = node({
    name: 'Schedule Trigger',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.3,
    position: [-1680, -160],
    parameters: {
      rule: {
        interval: [
          {
            hoursInterval: 8,
          },
        ],
      },
    },
  });

  const webhook = node({
    name: 'Instagram Slide Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-1680, 320],
    webhookId: id(),
    parameters: {
      path: 'instagram-carousel-slide',
      options: {},
      httpMethod: 'GET',
      responseMode: 'responseNode',
    },
  });

  const previewWebhook = node({
    name: 'Instagram Preview Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-1680, 520],
    webhookId: id(),
    parameters: {
      path: 'instagram-carousel-preview',
      options: {},
      httpMethod: 'GET',
      responseMode: 'responseNode',
    },
  });

  const buildSourceList = node({
    name: 'Build Source List',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1440, -160],
    parameters: {
      jsCode: `const sources = [
  {
    sourceName: 'RBI RSS',
    sourceType: 'official',
    feedUrl: 'https://www.rbi.org.in/Scripts/rss.aspx',
    trustScore: 5,
    category: 'finance',
    notes: 'Anchor source for credit, EMIs, inflation, lending, and rates.',
  },
  {
    sourceName: 'Reuters Business',
    sourceType: 'news',
    feedUrl: 'https://feeds.reuters.com/reuters/businessNews',
    trustScore: 5,
    category: 'business',
    notes: 'Clean macro and business context.',
  },
  {
    sourceName: 'Scroll',
    sourceType: 'news',
    feedUrl: 'https://scroll.in/feed',
    trustScore: 4,
    category: 'india',
    notes: 'India context with readable editorial framing.',
  },
  {
    sourceName: 'Google Trends India',
    sourceType: 'trends',
    feedUrl: 'https://trends.google.com/trending/rss?geo=IN',
    trustScore: 3,
    category: 'india',
    notes: 'Live-moment signal for the curator and the daily micro-run.',
  },
  {
    sourceName: 'r/AmItheAsshole',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/AmItheAsshole/.rss',
    trustScore: 2,
    category: 'drama',
    notes: 'Moral tension, conflict, and judgment bait.',
  },
  {
    sourceName: 'r/relationship_advice',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/relationship_advice/.rss',
    trustScore: 2,
    category: 'relationships',
    notes: 'Relationship friction and emotionally sticky situations.',
  },
  {
    sourceName: 'r/tifu',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/tifu/.rss',
    trustScore: 2,
    category: 'drama',
    notes: 'Mistakes, embarrassment, and human drama.',
  },
  {
    sourceName: 'r/unpopularopinion',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/unpopularopinion/.rss',
    trustScore: 2,
    category: 'controversy',
    notes: 'Hot takes and opinion tension.',
  },
  {
    sourceName: 'r/mildlyinfuriating',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/mildlyinfuriating/.rss',
    trustScore: 2,
    category: 'viral',
    notes: 'Small annoyances and relatable irritation.',
  },
  {
    sourceName: 'r/interestingasfuck',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/interestingasfuck/.rss',
    trustScore: 2,
    category: 'curiosity',
    notes: 'Fast curiosity hooks and shareable weirdness.',
  },
  {
    sourceName: 'r/oddlysatisfying',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/oddlysatisfying/.rss',
    trustScore: 2,
    category: 'viral',
    notes: 'Visual dopamine and oddly satisfying loops.',
  },
  {
    sourceName: 'r/aww',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/aww/.rss',
    trustScore: 2,
    category: 'animals',
    notes: 'Cute animal content for lighter dopamine breaks.',
  },
  {
    sourceName: 'r/worldnews',
    sourceType: 'reddit',
    feedUrl: 'https://www.reddit.com/r/worldnews/.rss',
    trustScore: 2,
    category: 'news',
    notes: 'Broad current events signal and headline gravity.',
  },
];

return sources.map((source) => ({ json: source }));`,
    },
  });

  const fetchRss = node({
    name: 'Fetch RSS Feed',
    type: 'n8n-nodes-base.rssFeedRead',
    typeVersion: 1.2,
    position: [-1200, -160],
    parameters: {
      url: '={{ $json.feedUrl }}',
      options: {
        customFields: 'author,contentSnippet,content',
        ignoreSSL: false,
      },
    },
  });

  const harvestAndCategorize = node({
    name: 'Harvest & Categorize',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-960, -160],
    parameters: {
      jsCode: `const items = $input.all();

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\\./, '');
  } catch (error) {
    return '';
  }
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !['the','and','for','with','from','that','this','have','will','your','you','are','new','how','can','our','their','about','into','what','when','why','who','but','not','all','now','use','uses','used','india','indian'].includes(token));
}

function pickCategory(text) {
  if (/cricket|match|ipl|bcci|world cup|sports?/.test(text)) return 'sports';
  if (/food|restaurant|dosa|biryani|cafe|eat|chef|menu/.test(text)) return 'food';
  if (/bollywood|actor|actress|movie|film|celebrity|star/.test(text)) return 'culture';
  if (/startup|founder|business|funding|company|market|economy/.test(text)) return 'business';
  if (/work|office|job|salary|manager|meeting|career|productivity/.test(text)) return 'work';
  if (/dating|relationship|marriage|wedding|family|parent|parents|relative|single|breakup|divorce|situationship/.test(text)) return 'relationships';
  if (/delhi|mumbai|bengaluru|bangalore|pune|hyderabad|chennai|kolkata|city|metro|traffic|weather/.test(text)) return 'cities';
  if (/tax|invest|mutual fund|stock|price|money|inflation|budget|bank|loan/.test(text)) return 'finance';
  if (/health|fitness|gym|workout|weight|body|skin|skincare|diet|sleep|mental|mindset|therapy|stress/.test(text)) return 'fitness';
  if (/travel|trip|flight|hotel|destination|tour|vacation|budget travel|backpack/.test(text)) return 'travel';
  if (/reddit|viral|satisfying|oddly|interesting|funny|meme|wtf|wow|crazy|shocking|insane/.test(text)) return 'viral';
  if (/animal|dog|cat|pet|wildlife|nature|aww/.test(text)) return 'animals';
  if (/opinion|hot take|controversy|outrage|drama|argument|fight|asshole|tifu/.test(text)) return 'drama';
  if (/curious|obscure|weird|hidden|unknown|history|atlas obscura|wikipedia|nautilus|wait but why/.test(text)) return 'curiosity';
  return 'india';
}

function scoreItem(item) {
  const sourceUrl = String(item.json.link || item.json.url || '').trim();
  const title = String(item.json.title || '').trim();
  const summary = String(item.json.contentSnippet || item.json.content || item.json.summary || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
  const text = normalize(title + ' ' + summary + ' ' + sourceUrl);
  const host = hostnameFromUrl(sourceUrl);
  const category = pickCategory(text);

  const officialHosts = ['rbi.org.in', 'sebi.gov.in', 'pib.gov.in'];
  const sourceTrust = officialHosts.some((domain) => host.includes(domain))
    ? 5
    : host.includes('news.google.com')
      ? 3
      : 2;

  const positiveTerms = [
    /india/i,
    /indian/i,
    /cricket/i,
    /bollywood/i,
    /food/i,
    /restaurant/i,
    /city/i,
    /metro/i,
    /traffic/i,
    /startup/i,
    /business/i,
    /work/i,
    /office/i,
    /career/i,
    /relationship/i,
    /marriage/i,
    /family/i,
    /finance/i,
    /money/i,
    /tax/i,
    /travel/i,
    /trip/i,
    /flight/i,
    /hotel/i,
    /fitness/i,
    /gym/i,
    /workout/i,
    /skin/i,
    /animal/i,
    /dog/i,
    /cat/i,
    /habit/i,
    /mindset/i,
    /people/i,
    /culture/i,
  ];

  const twistTerms = [
    /why/i,
    /how/i,
    /what/i,
    /problem/i,
    /issue/i,
    /fails?/i,
    /why.*matter/i,
    /trend/i,
    /viral/i,
    /viral/i,
    /launch/i,
    /new/i,
    /finally/i,
    /relatable/i,
    /funny/i,
    /awkward/i,
    /absurd/i,
    /meme/i,
    /same/i,
    /so true/i,
    /real/i,
  ];

  let score = 0;
  for (const pattern of positiveTerms) if (pattern.test(text)) score += 1.25;
  for (const pattern of twistTerms) if (pattern.test(text)) score += 0.75;

  if (category === 'cities') score += 2;
  if (category === 'food') score += 2;
  if (category === 'culture') score += 1.5;
  if (category === 'work') score += 1.5;
  if (category === 'finance') score += 1.5;
  if (category === 'business') score += 1;
  if (category === 'relationships') score += 1.5;
  if (category === 'fitness') score += 1.25;
  if (category === 'travel') score += 1;
  if (category === 'curiosity') score += 1.25;
  if (category === 'viral') score += 1.5;
  if (category === 'animals') score += 1;
  if (category === 'drama') score += 1.75;
  if (category === 'mindset') score += 1;
  if (/funny|awkward|relatable|absurd|same|so true|meme|lol|haha|irony|ironic/i.test(text)) score += 2;

  if (title.length > 45 && title.length < 130) score += 1;
  if (summary.length > 100) score += 1;

  const publishedAt = String(item.json.isoDate || item.json.pubDate || item.json.publishedAt || '');
  const recencyBoost = publishedAt ? Math.max(0, 2 - Math.min(2, Math.floor((Date.now() - Date.parse(publishedAt)) / 86400000))) : 0;
  score = Math.max(0, score + recencyBoost);

  const keywordSignature = tokenize(title + ' ' + summary)
    .slice(0, 8)
    .join('-');
  const dedupeKey = [category, keywordSignature || tokenize(title).slice(0, 5).join('-')].filter(Boolean).join('|');

  return {
    title,
    summary,
    sourceUrl,
    host,
    sourceTrust,
    score,
    category,
    publishedAt,
    dedupeKey,
  };
}

const ranked = items
  .map(scoreItem)
  .filter((entry, index, all) => all.findIndex((other) => other.dedupeKey === entry.dedupeKey) === index)
  .sort((a, b) => b.score - a.score || b.sourceTrust - a.sourceTrust || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));

const angleMap = {
  food: 'food for thought',
  cities: 'observation',
  culture: 'story',
  work: 'mindset',
  business: 'framework',
  finance: 'concept',
  relationships: 'story',
  fitness: 'mindset',
  travel: 'story',
  curiosity: 'concept',
  viral: 'witty observation',
  animals: 'observation',
  drama: 'story',
  sports: 'witty observation',
  mindset: 'mindset',
  india: 'observation',
};

function sourceEngineFor(host, sourceTrust) {
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('trends.google.com')) return 'trend';
  return sourceTrust >= 4 ? 'official' : 'news';
}

// Harvest is a tool call, not a decision: keep a raw candidate pool (Gate Candidates
// applies the five gates + banned list downstream). Cap at 25 to bound curator token spend.
const survivors = ranked.filter((entry) => entry.score >= 3).slice(0, 25);

return survivors.map((picked) => {
  const sourceEngine = sourceEngineFor(picked.host, picked.sourceTrust);
  return {
    json: {
      sourceHash: picked.dedupeKey,
      sourceName: picked.host,
      sourceType: sourceEngine === 'official' ? 'official' : sourceEngine === 'reddit' ? 'reddit' : sourceEngine === 'trend' ? 'trend' : 'news',
      sourceEngine,
      title: picked.title,
      sourceUrl: picked.sourceUrl,
      publishedAt: picked.publishedAt || new Date().toISOString(),
      summary: picked.summary,
      category: picked.category,
      relevanceScore: Math.min(10, picked.score),
      trustScore: picked.sourceTrust,
      // Reddit RSS (unlike Reddit's JSON listing API) does not expose upvote counts, so
      // pre-validation strength is unavailable here; left null rather than faked.
      preValidation: sourceEngine === 'reddit' ? null : undefined,
      angle: angleMap[picked.category] || 'observation',
    },
  };
});`,
    },
  });

  const fetchRecentTopics = node({
    name: 'Fetch Recent Topics',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [-720, -320],
    parameters: {
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      returnAll: true,
    },
  });

  const gateCandidates = node({
    name: 'Gate Candidates',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-480, -320],
    parameters: {
      jsCode: BANNED_LIST_RUNTIME + `
const backlogRows = $input.all().map((item) => item.json).filter(Boolean);
const candidates = $items("Harvest & Categorize").map((item) => item.json).filter(Boolean);

const queuedBacklog = backlogRows.filter((row) => row.status === 'queued');

const categoryCounts = {};
const engineCounts = {};
for (const row of queuedBacklog) {
  const cat = String(row.category || 'india');
  categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  let engine = row.sourceType || 'news';
  try {
    const parsed = row.candidatePoolJson ? JSON.parse(row.candidatePoolJson) : {};
    engine = parsed.sourceEngine || engine;
  } catch (error) {
    // keep sourceType fallback
  }
  engineCounts[engine] = (engineCounts[engine] || 0) + 1;
}

const totalQueued = queuedBacklog.length || 1;
const backlogStats = { totalQueued: queuedBacklog.length, categoryCounts, engineCounts };

function gapFillWeight(category) {
  const share = (categoryCounts[category] || 0) / totalQueued;
  if (share < 0.05) return 1.35;
  if (share < 0.12) return 1.15;
  if (share > 0.30) return 0.75;
  return 1;
}

const gated = [];
for (const candidate of candidates) {
  const text = [candidate.title, candidate.summary].filter(Boolean).join(' ');
  if (findBannedMatch(text)) continue;
  gated.push({
    ...candidate,
    adjustedScore: Number(candidate.relevanceScore || 0) * gapFillWeight(candidate.category),
    hasNumericClaim: /\\d/.test(text),
    _backlogStats: backlogStats,
  });
}

const survivors = gated
  .sort((a, b) => b.adjustedScore - a.adjustedScore)
  .slice(0, 20);

return survivors.map((entry) => ({ json: entry }));`,
    },
  });

  const verifyNumericClaims = node({
    name: 'Verify Numeric Claims',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, -320],
    parameters: {
      jsCode: WORD_BAND_RUNTIME + `
const candidates = $input.all().map((item) => item.json);
const MAX_FETCHES = 8;
let fetchesUsed = 0;

function stripNumericClauses(text) {
  const kept = splitSentences(text).filter((sentence) => !/\\d/.test(sentence));
  return kept.join(' ').trim();
}

async function verifyNumberOnPage(url, text) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (curator-verifier)' } });
    if (!response.ok) return false;
    const pageText = (await response.text()).replace(/<[^>]*>/g, ' ');
    const numbers = (text.match(/\\d[\\d,.]*/g) || []).map((entry) => entry.replace(/,/g, ''));
    return numbers.some((number) => number.length >= 2 && pageText.includes(number));
  } catch (error) {
    return false;
  }
}

const results = [];
for (const candidate of candidates) {
  const text = [candidate.title, candidate.summary].filter(Boolean).join(' ');
  if (!candidate.hasNumericClaim) {
    results.push({ ...candidate, numberless: false, numberVerified: null });
    continue;
  }
  if (candidate.sourceType === 'official') {
    results.push({ ...candidate, numberless: false, numberVerified: true });
    continue;
  }
  if (fetchesUsed >= MAX_FETCHES || !candidate.sourceUrl) {
    // Budget spent or nothing to fetch: never assert an unverified figure, rewrite numberless instead.
    results.push({ ...candidate, summary: stripNumericClauses(candidate.summary) || candidate.summary, numberless: true, numberVerified: false });
    continue;
  }
  fetchesUsed += 1;
  const verified = await verifyNumberOnPage(candidate.sourceUrl, text);
  if (verified) {
    results.push({ ...candidate, numberless: false, numberVerified: true });
  } else {
    results.push({ ...candidate, summary: stripNumericClauses(candidate.summary) || candidate.summary, numberless: true, numberVerified: false });
  }
}

return results.map((entry) => ({ json: entry }));`,
    },
  });

  const redundancyCheck = node({
    name: 'Redundancy Check',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [0, -320],
    parameters: {
      jsCode: CORPUS_SIMILARITY_RUNTIME + PG_CONNECTION_RUNTIME + `
const candidates = $input.all().map((item) => item.json);
const backlogRows = $items("Fetch Recent Topics").map((item) => item.json).filter(Boolean).slice(0, 60);

const survivors = [];

await withPgClient(async (client) => {
  await ensureCuratorTables(client);
  const takesResult = await client.query('SELECT text FROM circulating_takes ORDER BY created_at DESC LIMIT 200');
  const circulatingTakes = takesResult.rows;

  for (const candidate of candidates) {
    const candidateText = [candidate.title, candidate.summary].filter(Boolean).join(' ');
    const threshold = candidate.sourceEngine === 'model_knowledge' ? 0.80 : 0.86;

    let maxSimilarity = 0;
    for (const row of backlogRows) {
      const rowText = [row.title, row.summary, row.category].filter(Boolean).join(' ');
      maxSimilarity = Math.max(maxSimilarity, jaccardSimilarity(candidateText, rowText));
    }
    for (const take of circulatingTakes) {
      maxSimilarity = Math.max(maxSimilarity, jaccardSimilarity(candidateText, take.text));
    }

    if (maxSimilarity >= threshold) {
      await client.query(
        'INSERT INTO circulating_takes (text, source_engine, category) VALUES ($1, $2, $3)',
        [candidateText.slice(0, 2000), candidate.sourceEngine || 'unknown', candidate.category || null]
      );
      continue;
    }

    survivors.push({ ...candidate, noveltyScore: Number((1 - maxSimilarity).toFixed(3)) });
  }
});

return survivors.map((entry) => ({ json: entry }));`,
    },
  });

  const conceptPairing = node({
    name: 'Concept Pairing',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, -320],
    parameters: {
      jsCode: PG_CONNECTION_RUNTIME + `
const candidates = $input.all().map((item) => item.json);

const NERVE_KEYWORDS = {
  money: ['finance', 'business'],
  status: ['work', 'culture', 'sports'],
  belonging: ['relationships', 'drama'],
  control: ['fitness', 'mindset'],
  curiosity: ['curiosity', 'viral', 'animals', 'travel', 'food', 'cities', 'india'],
};

function nerveForCategory(category) {
  for (const nerve of Object.keys(NERVE_KEYWORDS)) {
    if (NERVE_KEYWORDS[nerve].includes(category)) return nerve;
  }
  return 'curiosity';
}

const paired = await withPgClient(async (client) => {
  await ensureCuratorTables(client);
  const result = await client.query(
    "SELECT id, name, nerve, description FROM concept_library WHERE last_used_at IS NULL OR last_used_at < now() - interval '90 days' ORDER BY random() LIMIT 200"
  );
  const available = result.rows;

  return candidates.map((candidate) => {
    const nerve = nerveForCategory(candidate.category);
    const match = available.find((concept) => concept.nerve === nerve) || available[0] || null;
    return {
      ...candidate,
      nerve,
      concept: match ? { id: match.id, name: match.name, description: match.description } : null,
    };
  });
});

return paired.map((entry) => ({ json: entry }));`,
    },
  });

  const modelKnowledgeLane = node({
    name: 'Model Knowledge Lane',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, -320],
    parameters: {
      jsCode: CORPUS_SIMILARITY_RUNTIME + PG_CONNECTION_RUNTIME + `
const candidates = $input.all().map((item) => item.json);
const backlogStats = candidates[0]?._backlogStats || { totalQueued: 0, engineCounts: {} };
const modelKnowledgeCount = Number(backlogStats.engineCounts?.model_knowledge || 0);
const ratio = backlogStats.totalQueued ? modelKnowledgeCount / backlogStats.totalQueued : 0;

// Cap already at or above 30% of the backlog, or this run simply did not roll the lane: pass through.
if (ratio >= 0.30 || Math.random() > (1 / 3)) {
  return candidates.map((entry) => ({ json: entry }));
}

const model = process.env.CURATOR_MODEL_MINI || 'gpt-5.4-mini';
const recentTitles = candidates.slice(0, 15).map((c) => c.title).filter(Boolean);

const systemPrompt = 'You propose ONE evergreen behavioral observation card from your own knowledge for an ' +
  'Indian Instagram insight-carousel account (startups, consumer behaviour, psychology, D2C). It must be ' +
  'numberless (never state a statistic), timeless (not tied to a news event), and genuinely fresh, not a take ' +
  'that already circulates widely online. Output strict JSON: { "title": "...", "summary": "one to two sentence ' +
  'behavioral observation", "category": "mindset|work|relationships|business|finance|culture|fitness" }.';

const userPrompt = 'Avoid anything resembling these recently curated titles:\\n' + recentTitles.map((t) => '- ' + t).join('\\n');

let proposal = null;
try {
  const response = await this.helpers.httpRequestWithAuthentication.call(this, 'openAiApi', {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    body: {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    },
    json: true,
  });
  proposal = JSON.parse(response.choices?.[0]?.message?.content || '{}');
} catch (error) {
  proposal = null;
}

if (!proposal || !proposal.title || !proposal.summary) {
  return candidates.map((entry) => ({ json: entry }));
}

const candidateText = [proposal.title, proposal.summary].join(' ');

const accepted = await withPgClient(async (client) => {
  await ensureCuratorTables(client);
  const takesResult = await client.query('SELECT text FROM circulating_takes ORDER BY created_at DESC LIMIT 200');
  let maxSimilarity = 0;
  for (const take of takesResult.rows) {
    maxSimilarity = Math.max(maxSimilarity, jaccardSimilarity(candidateText, take.text));
  }
  await client.query(
    'INSERT INTO circulating_takes (text, source_engine, category) VALUES ($1, $2, $3)',
    [candidateText.slice(0, 2000), 'model_knowledge', proposal.category || null]
  );
  return maxSimilarity < 0.80;
});

if (!accepted) {
  return candidates.map((entry) => ({ json: entry }));
}

const modelKnowledgeCard = {
  sourceHash: 'mk-' + Buffer.from(candidateText).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24),
  sourceName: 'model_knowledge',
  sourceType: 'model_knowledge',
  sourceEngine: 'model_knowledge',
  title: proposal.title,
  summary: proposal.summary,
  sourceUrl: '',
  publishedAt: new Date().toISOString(),
  category: proposal.category || 'mindset',
  relevanceScore: 6,
  trustScore: 3,
  preValidation: null,
  numberless: true,
  numberVerified: null,
  angle: 'observation',
  nerve: 'curiosity',
  concept: null,
  _backlogStats: backlogStats,
};

return candidates.concat([modelKnowledgeCard]).map((entry) => ({ json: entry }));`,
    },
    credentials: {
      openAiApi: {
        id: '7Ji76LZT6LXmqLQT',
        name: 'OpenAI account',
      },
    },
  });

  const curatorEnrichScore = node({
    name: 'Curator Enrich & Score',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [720, -320],
    parameters: {
      jsCode: `const candidates = $input.all().map((item) => item.json);
if (!candidates.length) return [];

const model = process.env.CURATOR_MODEL_TOP || 'gpt-5.4';

const systemPrompt = 'You are the topic curator for an Indian insight-carousel account (startups, consumer ' +
  'behaviour, psychology, D2C). You run this session over pre-harvested candidates - you are a filter and a ' +
  'collider, not a writer: your output is topic cards, never prose.\\n\\n' +
  'WHAT MAKES A CARD (all four, or drop it):\\n' +
  '1. A behavioral contradiction, a one-breath verified statistic, a pre-validated confession pattern, or a ' +
  'person who proves a thesis.\\n' +
  '2. An India-causal explanation (family, history, infrastructure) - if it works for any country, dig or drop.\\n' +
  '3. An unclaimed angle - candidates already passed a corpus-redundancy gate, but if two survivors are the ' +
  'same angle, keep only the sharper one.\\n' +
  '4. A reader who will comment "that is me" - name that person specifically in readerArchetype.\\n' +
  'For reframes, produce an inversion in the exact form "It is not X. It is Y." in the inversion field.\\n\\n' +
  'DISCIPLINE:\\n' +
  '- Fill backlog gaps from backlogStats, do not over-serve one category.\\n' +
  '- Numbers exist only if numberVerified is true; if numberless is true, write the card with no figures at all.\\n' +
  '- Pair each card with the provided concept only if it genuinely fits; otherwise omit concept.\\n\\n' +
  'OUTPUT: strict JSON { "cards": [ { "sourceHash", "title", "summary", "category", "angle", "inversion", ' +
  '"readerArchetype", "indiaContext", "juxtapositionPair", "payloadType", "nerve", "concept", ' +
  '"subScores": { "s1": 0-2, "s2": 0-2, "s3": 0-2, "s4": 0-2, "s5": 0-2, "s6": 0-2 }, ' +
  '"justifications": { "s1": "...", "s2": "...", "s3": "...", "s4": "...", "s5": "...", "s6": "..." } } ] }. ' +
  'Target 8 to 12 cards for this run. Fewer good cards beat the target count.';

const userPayload = {
  backlogStats: candidates[0]?._backlogStats || null,
  candidates: candidates.map((c) => ({
    sourceHash: c.sourceHash,
    title: c.title,
    summary: String(c.summary || '').slice(0, 600),
    category: c.category,
    sourceEngine: c.sourceEngine,
    numberless: !!c.numberless,
    numberVerified: c.numberVerified,
    preValidation: c.preValidation,
    nerve: c.nerve,
    concept: c.concept ? c.concept.name : null,
    noveltyScore: c.noveltyScore,
  })),
};

const response = await this.helpers.httpRequestWithAuthentication.call(this, 'openAiApi', {
  method: 'POST',
  url: 'https://api.openai.com/v1/chat/completions',
  body: {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
    response_format: { type: 'json_object' },
  },
  json: true,
});

let parsed = {};
try {
  parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
} catch (error) {
  parsed = {};
}

const cardsByHash = new Map(candidates.map((c) => [c.sourceHash, c]));
const cards = Array.isArray(parsed.cards) ? parsed.cards : [];

const enriched = cards
  .map((card) => {
    const original = cardsByHash.get(card.sourceHash);
    if (!original) return null;
    const subScores = card.subScores || {};
    const total = ['s1', 's2', 's3', 's4', 's5', 's6'].reduce((sum, key) => sum + Number(subScores[key] || 0), 0);
    return {
      ...original,
      title: card.title || original.title,
      summary: card.summary || original.summary,
      angle: card.angle || original.angle,
      inversion: card.inversion || null,
      readerArchetype: card.readerArchetype || null,
      indiaContext: card.indiaContext || null,
      juxtapositionPair: card.juxtapositionPair || null,
      payloadType: card.payloadType || null,
      nerve: card.nerve || original.nerve,
      concept: card.concept ? original.concept : null,
      subScores,
      justifications: card.justifications || {},
      totalScore: total,
    };
  })
  .filter(Boolean);

return enriched.map((entry) => ({ json: entry }));`,
    },
    credentials: {
      openAiApi: {
        id: '7Ji76LZT6LXmqLQT',
        name: 'OpenAI account',
      },
    },
  });

  const twoReaderRecheck = node({
    name: 'Two-Reader Recheck & Quotas',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [960, -320],
    parameters: {
      jsCode: `const cards = $input.all().map((item) => item.json);
if (!cards.length) return [];

const model = process.env.CURATOR_MODEL_MINI || 'gpt-5.4-mini';
const sample = cards.slice(0, Math.min(cards.length, 6));

const systemPrompt = 'You are a hostile second reader. For each card, re-score s1 (does it truly meet the card ' +
  'bar) and s4 (will a specific reader actually comment "that is me") from 0-2, and for any model_knowledge ' +
  'card be hostile about freshness: if it reads like a take you have seen circulate before, score it low and ' +
  'set freshnessFlag true. Output strict JSON { "rechecks": [ { "sourceHash", "s1", "s4", "freshnessFlag" } ] }.';

const userPayload = sample.map((card) => ({
  sourceHash: card.sourceHash,
  title: card.title,
  summary: card.summary,
  sourceEngine: card.sourceEngine,
  readerArchetype: card.readerArchetype,
}));

let rechecks = [];
try {
  const response = await this.helpers.httpRequestWithAuthentication.call(this, 'openAiApi', {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    body: {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      response_format: { type: 'json_object' },
    },
    json: true,
  });
  const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
  rechecks = Array.isArray(parsed.rechecks) ? parsed.rechecks : [];
} catch (error) {
  rechecks = [];
}

const rechecksByHash = new Map(rechecks.map((r) => [r.sourceHash, r]));

let rescored = cards.map((card) => {
  const recheck = rechecksByHash.get(card.sourceHash);
  if (!recheck) return card;
  const subScores = { ...card.subScores, s1: recheck.s1 ?? card.subScores?.s1, s4: recheck.s4 ?? card.subScores?.s4 };
  const total = ['s1', 's2', 's3', 's4', 's5', 's6'].reduce((sum, key) => sum + Number(subScores[key] || 0), 0);
  return { ...card, subScores, totalScore: total, freshnessFlag: !!recheck.freshnessFlag };
});

rescored = rescored.filter((card) => !card.freshnessFlag);

const cap = Math.floor(rescored.length * 0.30);
const modelKnowledgeCards = rescored
  .filter((card) => card.sourceEngine === 'model_knowledge')
  .sort((a, b) => b.totalScore - a.totalScore)
  .slice(0, cap);
const otherCards = rescored.filter((card) => card.sourceEngine !== 'model_knowledge');
const final = otherCards.concat(modelKnowledgeCards).sort((a, b) => b.totalScore - a.totalScore);

return final.map((entry) => ({ json: entry }));`,
    },
    credentials: {
      openAiApi: {
        id: '7Ji76LZT6LXmqLQT',
        name: 'OpenAI account',
      },
    },
  });

  const markConceptsUsed = node({
    name: 'Mark Concepts Used',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1200, -320],
    parameters: {
      jsCode: PG_CONNECTION_RUNTIME + `
const cards = $input.all().map((item) => item.json);
const conceptIds = Array.from(new Set(
  cards.map((card) => (card.concept && typeof card.concept === 'object' ? card.concept.id : null)).filter(Boolean)
));

if (conceptIds.length) {
  await withPgClient(async (client) => {
    await ensureCuratorTables(client);
    for (const conceptId of conceptIds) {
      await client.query('UPDATE concept_library SET last_used_at = now() WHERE id = $1', [conceptId]);
    }
  });
}

return cards.map((card) => {
  const flattened = {
    ...card,
    concept: card.concept && typeof card.concept === 'object' ? card.concept.name : (card.concept || null),
  };
  return { json: { ...flattened, candidatePoolJson: JSON.stringify(flattened) } };
});`,
    },
  });

  const insertBacklogCards = node({
    name: 'Insert Backlog Cards',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [1440, -320],
    parameters: {
      operation: 'upsert',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      filters: {
        conditions: [
          {
            keyName: 'sourceHash',
            keyValue: '={{ $json.sourceHash }}',
          },
        ],
      },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['sourceHash'],
        value: {
          sourceHash: '={{ $json.sourceHash }}',
          sourceName: '={{ $json.sourceName }}',
          sourceType: '={{ $json.sourceType }}',
          title: '={{ $json.title }}',
          sourceUrl: '={{ $json.sourceUrl }}',
          publishedAt: '={{ $json.publishedAt }}',
          summary: '={{ $json.summary }}',
          category: '={{ $json.category }}',
          relevanceScore: '={{ $json.totalScore }}',
          trustScore: '={{ $json.trustScore }}',
          autoPublish: true,
          status: 'queued',
          angle: '={{ $json.angle }}',
          draftText: '',
          imagePrompt: '',
          approvalToken: '',
          approvalStatus: 'queued',
          approvalDecision: '',
          candidatePoolJson: '={{ $json.candidatePoolJson }}',
          error: '',
          bufferPostId: '',
          bufferDueAt: '',
          bufferStatus: '',
          imageUrl: '',
        },
      },
      options: {},
    },
  });

  const collapseAfterInsert = node({
    name: 'Collapse After Insert',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1680, -320],
    parameters: {
      jsCode: `const insertedCount = $input.all().length;
return [{ json: { insertedCount } }];`,
    },
  });

  const fetchBacklogForSelection = node({
    name: 'Fetch Backlog For Selection',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [-720, -160],
    parameters: {
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      returnAll: true,
    },
  });

  const selectTopBacklogTopic = node({
    name: 'Select Top Backlog Topic',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-480, -160],
    parameters: {
      jsCode: `const rows = $input.all().map((item) => item.json).filter(Boolean);
const queued = rows.filter((row) => row.status === 'queued');

if (!queued.length) return [];

const best = queued.sort((a, b) =>
  Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0)
  || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)
)[0];

let curated = {};
try {
  curated = best.candidatePoolJson ? JSON.parse(best.candidatePoolJson) : {};
} catch (error) {
  curated = {};
}

return [{
  json: {
    sourceHash: best.sourceHash,
    sourceName: best.sourceName,
    sourceType: best.sourceType,
    sourceEngine: curated.sourceEngine || best.sourceType,
    title: best.title,
    sourceUrl: best.sourceUrl,
    publishedAt: best.publishedAt,
    summary: best.summary,
    category: best.category,
    relevanceScore: best.relevanceScore,
    trustScore: best.trustScore,
    autoPublish: true,
    angle: best.angle,
    status: 'selected',
    nerve: curated.nerve || null,
    concept: curated.concept || null,
    inversion: curated.inversion || null,
    readerArchetype: curated.readerArchetype || null,
    indiaContext: curated.indiaContext || null,
    juxtapositionPair: curated.juxtapositionPair || null,
    payloadType: curated.payloadType || null,
    numberless: !!curated.numberless,
    subScores: curated.subScores || null,
  },
}];`,
    },
  });

  const writeCarouselPlan = node({
    name: 'Write Carousel Plan',
    type: '@n8n/n8n-nodes-langchain.openAi',
    typeVersion: 2.3,
    position: [-480, -160],
    parameters: {
      modelId: {
        __rl: true,
        value: 'gpt-5.4-mini',
        mode: 'list',
        cachedResultName: 'GPT-5.4-MINI',
      },
      jsonOutput: true,
      messages: {
        values: [
          {
            role: 'system',
            content: `You write short Instagram carousel copy for an Indian audience.

Voice:
- observational
- relatable
- a little witty only when the topic allows it
- simple English
- clear argument, not a generic thread
- the lens must stay rooted in unfiltered insights on startups, consumer behaviour, psychology, and D2C

Rules:
- output only valid JSON
- make exactly 7 slides unless the topic truly does not support it
- each slide should be short enough to fit on a clean Instagram card
- no long paragraphs
- no marketing speak
- no forced inspiration
- keep it useful, memorable, or quietly sharp
- prefer a clear point of view over generic inspiration
- when a topic is ordinary, find the hidden mechanism inside it
- when a topic is serious, stay calm and exact
- every slide must add new information
- the post must build like an argument, not a list
- the final slide must reframe the entire post
- if the topic card is numberless, do not invent or estimate any figure

Framework:
- Slide 1 (bookend): sharp claim
- Slide 2: reject the obvious explanation
- Slide 3: reveal the real system or force
- Slide 4: show how it appears in ordinary life
- Slide 5: show the hidden cost
- Slide 6: show what people misread
- Slide 7 (bookend): close with a blunt, memorable truth

RHYTHM:
- Cruising altitude is 50-65 words per slide. Count silently.
- Exactly ONE slide among slides 2 through 6 is a punch slide: 28-40 words, declared in
  "punchSlideIndex" as that slide's order number. Make it the shock (slide 2) or the
  juxtaposition landing (slide 6), whichever lands harder for this topic.
- Bookend slides (1 and 7) run 38-55 words.
- Any slide over 45 words breaks into two short paragraphs at the natural pause.
- Every slide contains at least one sentence of eight words or fewer.
- Never pad to reach a count. Never compress to fit one. Add a concrete detail, or cut a clause.

Tone reference:
- certain
- calm
- specific
- unsentimental
- empathetic without being soft
- plainspoken, not performative
- the point of view should feel like a sharp X post, not an Instagram caption

JSON schema:
{
  "framework": {
    "claim": "one sentence",
    "system": "one sentence",
    "cost": "one sentence",
    "reframe": "one sentence"
  },
  "angle": "story | concept | mindset | framework | food for thought | observation | witty observation",
  "caption": "short supporting caption",
  "hashtags": ["#tag1", "#tag2"],
  "punchSlideIndex": 2,
  "slides": [
    {
      "order": 1,
      "role": "claim | correction | system | ordinary_life | cost | misread | close",
      "text": "short slide copy",
      "styleNote": "tiny note about layout or emphasis"
    }
  ]
}`,
          },
          {
            content: `Topic title: {{$json.title}}
Topic summary: {{$json.summary}}
Topic category: {{$json.category}}
Topic angle: {{$json.angle}}
Numberless: {{$json.numberless}}
Curator inversion: {{$json.inversion}}
Curator reader archetype: {{$json.readerArchetype}}
Curator India context: {{$json.indiaContext}}
Curator juxtaposition pair: {{$json.juxtapositionPair}}
Curator nerve: {{$json.nerve}}
Curator concept: {{$json.concept}}
Audience: Indian Instagram users
Tone reference: calm, sharp, specific, unsentimental

Use the framework exactly:
1. sharp claim (bookend)
2. reject the obvious explanation
3. reveal the real system or force
4. show how it appears in ordinary life
5. show the hidden cost
6. show what people misread
7. close with a blunt, memorable truth (bookend)

Use the curator's inversion, reader archetype, India context, and juxtaposition pair above when they are
present - they were produced by a separate collision pass and should sharpen, not just decorate, the copy.

Do not make every slide independently clever. Make the sequence build.
The first slide should create a question.
The middle slides should tighten the argument.
The last slide should reframe the whole thing.`,
          },
        ],
      },
      options: {},
    },
    credentials: {
      openAiApi: {
        id: '7Ji76LZT6LXmqLQT',
        name: 'OpenAI account',
      },
    },
  });

  const enforceWordBandsRhythm = node({
    name: 'Enforce Word Bands & Rhythm',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-360, -160],
    parameters: {
      jsCode: WORD_BAND_RUNTIME + `
const upstream = $json.message?.content || $json;
const plan = (upstream && typeof upstream === 'object') ? upstream : {};
const rawSlides = Array.isArray(plan.slides) ? plan.slides : [];
const total = rawSlides.length;

function resolvePunchSlideIndex() {
  const declared = Number(plan.punchSlideIndex);
  const validRange = rawSlides.some((slide) => Number(slide.order) === declared) && declared > 1 && declared < total;
  if (declared && validRange) return declared;
  const midSlides = rawSlides.filter((slide) => Number(slide.order) > 1 && Number(slide.order) < total);
  if (!midSlides.length) return null;
  let shortest = { order: Number(midSlides[0].order), words: countWords(midSlides[0].text) };
  for (const slide of midSlides) {
    const words = countWords(slide.text);
    if (words < shortest.words) shortest = { order: Number(slide.order), words };
  }
  return shortest.order;
}

const punchSlideIndex = resolvePunchSlideIndex();
const MAX_CHARS_PER_LINE = 28;
const MAX_LINES = 10;

let working = rawSlides.map((slide) => {
  const order = Number(slide.order) || 0;
  const role = classifySlideRole(order, total, punchSlideIndex);
  return { ...slide, order, role, text: String(slide.text || '').trim() };
});

function bandCheckFor(slide) {
  return checkBand(slide.role, countWords(slide.text));
}

async function rewriteSlides(targets, instructionForTarget) {
  if (!targets.length) return {};
  const model = process.env.CURATOR_MODEL_MINI || 'gpt-5.4-mini';
  const payload = targets.map((slide) => ({
    order: slide.order,
    role: slide.role,
    currentText: slide.text,
    instruction: instructionForTarget(slide),
  }));
  const systemPrompt = 'You rewrite single Instagram carousel slides to hit a word-count band without ' +
    'padding or over-compressing. For an expand instruction, add one concrete detail or one beat of the ' +
    'character - never filler words. For a cut instruction, remove a clause - never delete words until the ' +
    'sentence becomes a choppy fragment. Preserve meaning and voice. Output strict JSON ' +
    '{ "rewrites": [ { "order": 1, "text": "..." } ] }.';
  try {
    const response = await this.helpers.httpRequestWithAuthentication.call(this, 'openAiApi', {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      body: {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
      },
      json: true,
    });
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : [];
    const byOrder = {};
    for (const entry of rewrites) byOrder[Number(entry.order)] = String(entry.text || '').trim();
    return byOrder;
  } catch (error) {
    return {};
  }
}

const bandTargets = working.filter((slide) => bandCheckFor(slide).verdict !== 'target');

if (bandTargets.length) {
  const rewrites = await rewriteSlides(bandTargets, (slide) => {
    const check = bandCheckFor(slide);
    return check.direction === 'expand'
      ? ('Expand to ' + check.target[0] + '-' + check.target[1] + ' words by adding one concrete detail or one beat of the character. Never pad with adjectives.')
      : ('Cut to ' + check.target[0] + '-' + check.target[1] + ' words by removing a clause. Never produce a choppy fragment.');
  });
  working = working.map((slide) => (rewrites[slide.order] ? { ...slide, text: rewrites[slide.order] } : slide));
}

function paragraphsFor(slide) {
  if (slide.role === 'punch') return [slide.text];
  return splitParagraphs(slide.text, 45);
}

const overflowTargets = working.filter((slide) => renderedLineCount(paragraphsFor(slide), MAX_CHARS_PER_LINE) > MAX_LINES);
if (overflowTargets.length) {
  const rewrites = await rewriteSlides(overflowTargets, () =>
    ('Cut this slide so it renders in at most ' + MAX_LINES + ' lines on a phone card. Remove a clause, never compress into a fragment.')
  );
  working = working.map((slide) => (rewrites[slide.order] ? { ...slide, text: rewrites[slide.order] } : slide));
}

const bandReport = [];
working = working.map((slide) => {
  const wordCount = countWords(slide.text);
  const band = checkBand(slide.role, wordCount);
  let finalParagraphs = paragraphsFor(slide);
  let renderOverflow = false;
  if (renderedLineCount(finalParagraphs, MAX_CHARS_PER_LINE) > MAX_LINES) {
    renderOverflow = true;
    const words = slide.text.split(/\\s+/).filter(Boolean);
    const approxWordsPerLine = MAX_CHARS_PER_LINE / 6;
    const keepWords = Math.max(10, Math.floor(MAX_LINES * approxWordsPerLine));
    const trimmedText = words.slice(0, keepWords).join(' ');
    finalParagraphs = slide.role === 'punch' ? [trimmedText] : splitParagraphs(trimmedText, 45);
  }
  const finalText = finalParagraphs.join('\\n\\n');
  bandReport.push({
    order: slide.order,
    role: slide.role,
    wordCount: countWords(finalText),
    verdict: band.verdict,
    lineCount: renderedLineCount(finalParagraphs, MAX_CHARS_PER_LINE),
    renderOverflow,
    sentenceMixWarnings: sentenceMixWarnings(finalText),
  });
  return { ...slide, text: finalText, paragraphs: finalParagraphs, wordCount: countWords(finalText) };
});

const punchCount = working.filter((slide) => slide.role === 'punch').length;
const lengthVariety = new Set(working.map((slide) => slide.wordCount)).size > 1;
const hasOverflow = bandReport.some((entry) => entry.renderOverflow);
const hasHardFail = bandReport.some((entry) => entry.verdict === 'hard_fail');
let rhythmScore = 5;
if (punchCount !== 1) rhythmScore -= 1;
if (!lengthVariety) rhythmScore -= 1;
if (hasOverflow) rhythmScore -= 2;
if (hasHardFail) rhythmScore -= 1;
rhythmScore = Math.max(1, Math.min(5, rhythmScore));

return [{
  json: {
    ...plan,
    slides: working,
    punchSlideIndex,
    bandReport,
    rhythmScore,
  },
}];`,
    },
    credentials: {
      openAiApi: {
        id: '7Ji76LZT6LXmqLQT',
        name: 'OpenAI account',
      },
    },
  });

  const prepareCarouselPayload = node({
    name: 'Prepare Carousel Payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, -160],
    parameters: {
      jsCode: `const plan = $json || {};
const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const slideCount = Array.isArray(plan.slides) ? plan.slides.length : 0;
const supabaseUrl = String(process.env.SUPABASE_URL || 'https://nlmthljrbgnaevheszvg.supabase.co').replace(/\\/+$/, '');
const supabaseBucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'instagram-carousel-assets').trim();
const carouselBaseUrl = supabaseUrl + '/storage/v1/object/public/' + supabaseBucket;

return [{
  json: {
    ...$json,
    angle: plan.angle || $json.angle || 'observation',
    captionText: plan.caption || '',
    hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
    slides: Array.isArray(plan.slides) ? plan.slides : [],
    slideCount,
    carouselToken: token,
    approvalToken: token,
    imagePrompt: JSON.stringify(plan, null, 2),
    candidatePoolJson: JSON.stringify(plan),
    draftText: plan.caption || '',
    carouselAssetBase: carouselBaseUrl,
    carouselAssets: [],
    carouselStoragePrefix: 'instagram-carousel/' + token,
    storageBucket: supabaseBucket,
    bufferChannelId: '',
    publishStatus: 'queued',
    publishUrl: '',
  }
}];`,
    },
  });

  const uploadCarouselSlides = node({
    name: 'Upload Carousel Slides',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-40, -160],
    parameters: {
      jsCode: `const sharp = require('sharp');
const plan = $json;
const slides = Array.isArray(plan.slides) ? plan.slides : [];
const token = String(plan.approvalToken || plan.carouselToken || '').trim();
const supabaseUrl = String(process.env.SUPABASE_URL || 'https://nlmthljrbgnaevheszvg.supabase.co').replace(/\\/+$/, '');
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseBucket = String(process.env.SUPABASE_STORAGE_BUCKET || plan.storageBucket || 'instagram-carousel-assets').trim();
const storagePrefix = String(plan.carouselStoragePrefix || ('instagram-carousel/' + token)).replace(/^\\/+|\\/+$/g, '');
const channelName = 'thoughts @ 3:18AM';

if (!supabaseKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to upload carousel assets.');
}

if (!supabaseBucket) {
  throw new Error('SUPABASE_STORAGE_BUCKET is required to upload carousel assets.');
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(text, max = 28) {
  const words = String(text || '').split(/\\s+/).filter(Boolean);
  const out = [];
  let line = [];
  for (const word of words) {
    const candidate = [...line, word].join(' ');
    if (candidate.length > max && line.length) {
      out.push(line.join(' '));
      line = [word];
    } else {
      line.push(word);
    }
  }
  if (line.length) out.push(line.join(' '));
  return out;
}

const MAX_CHARS_PER_LINE = 28;
const MAX_RENDER_LINES = 10;

function paragraphsFromText(text) {
  const parts = String(text || '').split('\\n\\n').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [String(text || '').trim()];
}

// render_overflow safety clamp: word-band + line-cap enforcement already runs upstream
// (Enforce Word Bands & Rhythm), so this should be a no-op in the normal path.
function layoutLines(text, maxCharsPerLine, maxLines) {
  const paragraphs = paragraphsFromText(text);
  let flat = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) flat.push({ gap: true });
    for (const lineText of lines(paragraph, maxCharsPerLine)) flat.push({ gap: false, text: lineText });
  });
  const textLineCount = flat.filter((entry) => !entry.gap).length;
  if (textLineCount > maxLines) {
    let kept = 0;
    flat = flat.filter((entry) => {
      if (entry.gap) return true;
      if (kept >= maxLines) return false;
      kept += 1;
      return true;
    });
  }
  return flat;
}

function slideSvg(text, index, total) {
  const fontSize = 54;
  const lineHeight = Math.round(fontSize * 1.45);
  const paragraphGap = Math.round(lineHeight * 0.8);
  const layout = layoutLines(text, MAX_CHARS_PER_LINE, MAX_RENDER_LINES);
  let cursorY = 250;
  const bodySvg = layout.map((entry) => {
    if (entry.gap) {
      cursorY += paragraphGap;
      return '';
    }
    const svgLine = '<text x="128" y="' + cursorY + '" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="' + fontSize + '" font-weight="700">' + esc(entry.text) + '</text>';
    cursorY += lineHeight;
    return svgLine;
  }).filter(Boolean).join('\\n    ');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
    '<rect width="1080" height="1350" fill="#ffffff"/>' +
    '<circle cx="84" cy="86" r="48" fill="#e9e2d7" stroke="#111111" stroke-width="2"/>' +
    '<circle cx="84" cy="86" r="34" fill="#d4c8b8"/>' +
    '<text x="152" y="74" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="700">' + esc(channelName) + '</text>' +
    '<text x="152" y="124" fill="#666666" font-family="Arial, Helvetica, sans-serif" font-size="30">Just now • 🌐</text>' +
    '<circle cx="980" cy="82" r="6" fill="#666666"/>' +
    '<circle cx="1002" cy="82" r="6" fill="#666666"/>' +
    '<circle cx="1024" cy="82" r="6" fill="#666666"/>' +
    '<text x="128" y="198" fill="#666666" font-family="Arial, Helvetica, sans-serif" font-size="24">' + esc('Card ' + index + ' of ' + total) + '</text>' +
    '<g font-family="Arial, Helvetica, sans-serif" fill="#111111">' +
      bodySvg +
    '</g>' +
    '</svg>';
}

async function uploadPng(buffer, filePath) {
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  const uploadUrl = supabaseUrl + '/storage/v1/object/' + supabaseBucket + '/' + path;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Supabase upload failed for ' + filePath + ': ' + response.status + ' ' + response.statusText + ' ' + body);
  }

  return supabaseUrl + '/storage/v1/object/public/' + supabaseBucket + '/' + path;
}

const assets = [];
for (let index = 0; index < slides.length; index++) {
  const slide = slides[index] || {};
  const slideNumber = Number(slide.order || index + 1);
  const text = String(slide.text || '').trim();
  const pngBuffer = await sharp(Buffer.from(slideSvg(text, slideNumber, Math.max(slides.length, 1)))).png().toBuffer();
  const objectPath = storagePrefix + '/slide-' + slideNumber + '.png';
  const publicUrl = await uploadPng(pngBuffer, objectPath);
  assets.push({
    image: {
      url: publicUrl,
    },
  });
}

return [{
  json: {
    ...plan,
    carouselAssets: assets,
    carouselAssetBase: supabaseUrl + '/storage/v1/object/public/' + supabaseBucket + '/' + storagePrefix,
    storageBucket: supabaseBucket,
    uploadedSlideCount: assets.length,
    imageUrl: assets[0]?.image?.url || '',
  }
}];`,
    },
  });

  const upsertDraftRecord = node({
    name: 'Upsert Draft Record',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [0, -160],
    parameters: {
      operation: 'upsert',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      filters: {
        conditions: [
          {
            keyName: 'sourceHash',
            keyValue: '={{ $json.sourceHash }}',
          },
        ],
      },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['sourceHash'],
        value: {
          sourceHash: '={{ $json.sourceHash }}',
          sourceName: '={{ $json.sourceName }}',
          sourceType: '={{ $json.sourceType }}',
          title: '={{ $json.title }}',
          sourceUrl: '={{ $json.sourceUrl }}',
          publishedAt: '={{ $json.publishedAt }}',
          summary: '={{ $json.summary }}',
          category: '={{ $json.category }}',
          relevanceScore: '={{ $json.relevanceScore }}',
          trustScore: '={{ $json.trustScore }}',
          autoPublish: '={{ $json.autoPublish }}',
          status: 'drafted',
          angle: '={{ $json.angle }}',
          draftText: '={{ $json.draftText }}',
          imagePrompt: '={{ $json.imagePrompt }}',
          approvalToken: '={{ $json.approvalToken }}',
          approvalStatus: 'drafted',
          approvalDecision: '',
          approvalSentAt: '',
          approvalRespondedAt: '',
          candidatePoolJson: '={{ $json.candidatePoolJson }}',
          error: '',
          bufferPostId: '',
          bufferDueAt: '',
          bufferStatus: '',
          imageUrl: '={{ $json.carouselAssets?.[0]?.image?.url || $json.imageUrl || "" }}',
        },
      },
      options: {},
    },
  });

  const generateEndResponse = node({
    name: 'Generate End Response',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, -160],
    parameters: {
      jsCode: `const slideCount = Array.isArray($json.slides) ? $json.slides.length : 0;
const endResponseText = [
  'Prepared carousel draft for Buffer.',
  slideCount + ' slides ready.',
  $json.captionText ? 'Caption is ready.' : 'Caption is empty.',
].join(' ');

return [{
  json: {
    ...$json,
    endResponseStatus: 'ready_for_buffer',
    endResponseText,
    endResponse: {
      status: 'ready_for_buffer',
      title: $json.title || '',
      category: $json.category || '',
      angle: $json.angle || '',
      slideCount,
      captionText: $json.captionText || '',
    },
  },
}];`,
    },
  });

  const getBufferOrganizations = node({
    name: 'Get Buffer Organizations',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position: [240, -160],
    parameters: {
      method: 'POST',
      url: 'https://api.buffer.com',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ { query: "query GetOrganizations { account { organizations { id name } } }" } }}',
      options: {},
    },
  });

  const pickBufferOrganization = node({
    name: 'Pick Buffer Organization',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, -160],
    parameters: {
      jsCode: `const orgs = $json.data?.account?.organizations || [];
const organization = orgs[0];
if (!organization?.id) {
  throw new Error('Buffer organization not found.');
}

return [{
  json: {
    ...$node["Prepare Carousel Payload"].json,
    bufferOrganizationId: organization.id,
  }
}];`,
    },
  });

  const getBufferChannels = node({
    name: 'Get Buffer Channels',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position: [720, -160],
    parameters: {
      method: 'POST',
      url: 'https://api.buffer.com',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ { query: `query GetChannels { channels(input: { organizationId: "${$json.bufferOrganizationId}" }) { id name displayName service avatar isQueuePaused } }` } }}',
      options: {},
    },
  });

  const pickInstagramChannel = node({
    name: 'Pick Instagram Channel',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [960, -160],
    parameters: {
      jsCode: `const channels = $json.data?.channels || [];
const instagram = channels.find((channel) => String(channel.service || '').toLowerCase() === 'instagram' && !channel.isQueuePaused);
if (!instagram?.id) {
  throw new Error('No active Instagram channel found in Buffer.');
}

return [{
  json: {
    ...$node["Prepare Carousel Payload"].json,
    bufferOrganizationId: $node["Pick Buffer Organization"].json.bufferOrganizationId,
    bufferChannelId: instagram.id,
    bufferChannelName: instagram.displayName || instagram.name || 'Instagram',
  }
}];`,
    },
  });

  const queueInBuffer = node({
    name: 'Queue in Buffer',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position: [1200, -160],
    parameters: {
      method: 'POST',
      url: 'https://api.buffer.com',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ (() => { const caption = $json.captionText || ""; const assets = ($json.carouselAssets || []).map((asset) => "{ image: { url: " + JSON.stringify(asset.image.url) + " } }").join(", "); return { query: "mutation CreatePost { createPost(input: { text: " + JSON.stringify(caption) + ", channelId: \\\"" + $json.bufferChannelId + "\\\", schedulingType: automatic, mode: addToQueue, assets: [" + assets + "] }) { ... on PostActionSuccess { post { id text dueAt status } } ... on MutationError { message } } }" }; })() }}',
      options: {},
    },
  });

  const upsertPublishedRecord = node({
    name: 'Upsert Published Record',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [1440, -160],
    parameters: {
      operation: 'upsert',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      filters: {
        conditions: [
          {
            keyName: 'sourceHash',
            keyValue: '={{ $json.sourceHash }}',
          },
        ],
      },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['sourceHash'],
        value: {
          sourceHash: '={{ $json.sourceHash }}',
          sourceName: '={{ $json.sourceName }}',
          sourceType: '={{ $json.sourceType }}',
          title: '={{ $json.title }}',
          sourceUrl: '={{ $json.sourceUrl }}',
          publishedAt: '={{ $json.publishedAt }}',
          summary: '={{ $json.summary }}',
          category: '={{ $json.category }}',
          relevanceScore: '={{ $json.relevanceScore }}',
          trustScore: '={{ $json.trustScore }}',
          autoPublish: '={{ $json.autoPublish }}',
          status: 'published',
          angle: '={{ $json.angle }}',
          draftText: '={{ $json.captionText }}',
          imagePrompt: '={{ $json.imagePrompt }}',
          approvalToken: '={{ $json.approvalToken }}',
          approvalStatus: 'published',
          approvalDecision: 'approved',
          approvalSentAt: '',
          approvalRespondedAt: '',
          candidatePoolJson: '={{ $json.candidatePoolJson }}',
          error: '',
          bufferPostId: '={{ $node["Queue in Buffer"].json.data.createPost.post.id || "" }}',
          bufferDueAt: '={{ $node["Queue in Buffer"].json.data.createPost.post.dueAt || "" }}',
          bufferStatus: '={{ $node["Queue in Buffer"].json.data.createPost.post.status || "scheduled" }}',
          imageUrl: '={{ $json.carouselAssets?.[0]?.image?.url || $json.imageUrl || "" }}',
        },
      },
      options: {},
    },
  });

  const lookupCarousel = node({
    name: 'Lookup Carousel',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [-1440, 320],
    parameters: {
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: 'JDO5bEKUCJ1T57Pf',
        cachedResultName: 'content_topics',
      },
      filters: {
        conditions: [
          {
            keyName: 'approvalToken',
            keyValue: '={{ $json.query.token }}',
          },
        ],
      },
      returnAll: true,
    },
  });

  const renderSlidePng = node({
    name: 'Render Slide PNG',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1200, 320],
    parameters: {
      jsCode: `const sharp = require('sharp');
const request = $node["Instagram Slide Webhook"]?.json || $json;
const token = String(request.query?.token || '').trim();
const slideIndex = Math.max(1, Number(request.query?.slide || 1));
const record = $input.first()?.json || {};

if (!token) {
  const errorSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#111"/><text x="70" y="110" fill="#fff" font-size="44" font-family="Arial">Missing token</text></svg>';
  const errorPng = await sharp(Buffer.from(errorSvg)).png().toBuffer();
  return [{
    json: {
      mimeType: 'image/png',
      fileName: 'instagram-slide-error.png',
    },
    binary: {
      data: await this.helpers.prepareBinaryData(errorPng, 'instagram-slide-error.png', 'image/png'),
    },
  }];
}

let plan = {};
try {
  plan = record.candidatePoolJson ? JSON.parse(record.candidatePoolJson) : {};
} catch (error) {
  plan = {};
}

const slides = Array.isArray(plan.slides) ? plan.slides : [];
const slide = slides.find((entry) => Number(entry.order || 0) === slideIndex) || slides[slideIndex - 1] || { text: 'Missing slide text.' };
const title = String(record.title || plan.title || '');
const body = String(slide.text || '').trim();
const bg = '#0b0f14';
const panel = '#11161d';
const panelEdge = '#253041';
const dark = '#f5f7fa';
const subtle = '#8b98a5';
const channelName = 'unfiltered.insights';
const handle = '@startup-psych-d2c';

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(text, max = 28) {
  const words = String(text || '').split(/\\s+/).filter(Boolean);
  const out = [];
  let line = [];
  for (const word of words) {
    const candidate = [...line, word].join(' ');
    if (candidate.length > max && line.length) {
      out.push(line.join(' '));
      line = [word];
    } else {
      line.push(word);
    }
  }
  if (line.length) out.push(line.join(' '));
  return out;
}

const MAX_CHARS_PER_LINE = 28;
const MAX_RENDER_LINES = 10;

function paragraphsFromText(text) {
  const parts = String(text || '').split('\\n\\n').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [String(text || '').trim()];
}

// render_overflow safety clamp: word-band + line-cap enforcement already runs upstream
// (Enforce Word Bands & Rhythm), so this should be a no-op in the normal path.
function layoutLines(text, maxCharsPerLine, maxLines) {
  const paragraphs = paragraphsFromText(text);
  let flat = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) flat.push({ gap: true });
    for (const lineText of lines(paragraph, maxCharsPerLine)) flat.push({ gap: false, text: lineText });
  });
  const textLineCount = flat.filter((entry) => !entry.gap).length;
  if (textLineCount > maxLines) {
    let kept = 0;
    flat = flat.filter((entry) => {
      if (entry.gap) return true;
      if (kept >= maxLines) return false;
      kept += 1;
      return true;
    });
  }
  return flat;
}

const titleLines = lines(title, 30).slice(0, 2);
const titleFontSize = 30;
const titleLineHeight = Math.round(titleFontSize * 1.45);
const titleSvg = titleLines.map((line, index) => '<text x="144" y="' + (190 + index * titleLineHeight) + '" fill="' + dark + '" font-size="' + titleFontSize + '" font-weight="700">' + esc(line) + '</text>').join('\\n    ');

const bodyFontSize = 46;
const bodyLineHeight = Math.round(bodyFontSize * 1.45);
const bodyParagraphGap = Math.round(bodyLineHeight * 0.8);
const bodyLayout = layoutLines(body, MAX_CHARS_PER_LINE, MAX_RENDER_LINES);
let bodyCursorY = 320;
const bodySvg = bodyLayout.map((entry) => {
  if (entry.gap) {
    bodyCursorY += bodyParagraphGap;
    return '';
  }
  const svgLine = '<text x="144" y="' + bodyCursorY + '" fill="' + dark + '" font-size="' + bodyFontSize + '" font-weight="700">' + esc(entry.text) + '</text>';
  bodyCursorY += bodyLineHeight;
  return svgLine;
}).filter(Boolean).join('\\n    ');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
  '<rect width="1080" height="1350" fill="' + bg + '"/>' +
  '<rect x="88" y="70" width="904" height="1210" rx="36" fill="' + panel + '" stroke="' + panelEdge + '" stroke-width="2"/>' +
  '<circle cx="150" cy="150" r="28" fill="#0f141a" stroke="' + panelEdge + '" stroke-width="2"/>' +
  '<text x="214" y="143" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">' + esc(channelName) + '</text>' +
  '<text x="214" y="180" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="24">' + esc(handle) + ' · Just now</text>' +
  '<text x="928" y="142" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">...</text>' +
  '<rect x="116" y="230" width="848" height="1" fill="' + panelEdge + '"/>' +
  '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
    titleSvg +
  '</g>' +
  '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
    bodySvg +
  '</g>' +
  '<rect x="116" y="1148" width="848" height="1" fill="' + panelEdge + '"/>' +
  '<text x="144" y="1200" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="24">Reply · Repost · Like · Bookmark</text>' +
'</svg>';

const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

return [{
  json: {
    mimeType: 'image/png',
    fileName: 'instagram-slide-' + slideIndex + '.png',
  },
  binary: {
    data: await this.helpers.prepareBinaryData(pngBuffer, 'instagram-slide-' + slideIndex + '.png', 'image/png'),
  },
}];`,
    },
  });

  const renderPreviewPng = node({
    name: 'Render Preview PNG',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1200, 520],
    parameters: {
      jsCode: `const sharp = require('sharp');
const request = $node["Instagram Preview Webhook"]?.json || $json;
const showSet = String(request.query?.set || request.query?.mode || '').toLowerCase() === '1' || String(request.query?.mode || '').toLowerCase() === 'set';
const bg = '#0b0f14';
const panel = '#11161d';
const panelEdge = '#253041';
const dark = '#f5f7fa';
const subtle = '#8b98a5';
const channelName = 'unfiltered.insights';
const handle = '@startup-psych-d2c';

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(text, max = 30) {
  const words = String(text || '').split(/\\s+/).filter(Boolean);
  const out = [];
  let line = [];
  for (const word of words) {
    const candidate = [...line, word].join(' ');
    if (candidate.length > max && line.length) {
      out.push(line.join(' '));
      line = [word];
    } else {
      line.push(word);
    }
  }
  if (line.length) out.push(line.join(' '));
  return out;
}

function slideSvg(text, idx, total) {
  const fontSize = 46;
  const lineHeight = Math.round(fontSize * 1.45);
  const bodyLines = lines(text, 28).slice(0, 10);
  let cursorY = 300;
  const bodySvg = bodyLines.map((line) => {
    const svgLine = '<text x="144" y="' + cursorY + '" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="' + fontSize + '" font-weight="700">' + esc(line) + '</text>';
    cursorY += lineHeight;
    return svgLine;
  }).join('\\n    ');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
    '<rect width="1080" height="1350" fill="' + bg + '"/>' +
    '<rect x="88" y="70" width="904" height="1210" rx="36" fill="' + panel + '" stroke="' + panelEdge + '" stroke-width="2"/>' +
    '<circle cx="150" cy="150" r="28" fill="#0f141a" stroke="' + panelEdge + '" stroke-width="2"/>' +
    '<text x="214" y="143" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">' + esc(channelName) + '</text>' +
    '<text x="214" y="180" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="24">' + esc(handle) + ' · Just now</text>' +
    '<text x="928" y="142" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">...</text>' +
    '<rect x="116" y="230" width="848" height="1" fill="' + panelEdge + '"/>' +
    '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
      bodySvg +
    '</g>' +
    '<rect x="116" y="1148" width="848" height="1" fill="' + panelEdge + '"/>' +
    '<text x="144" y="1200" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="24">Reply · Repost · Like · Bookmark</text>' +
    '</svg>';
}

const sampleSlides = [
  'The greatest creative work ever made was not made by people who had it figured out.',
  'It was made by people who felt too much, noticed too much, and cared too much.',
  'Instead of numbing it, they made something out of it.',
  'Sensitivity was not what they overcame to create.',
  'It was what they created from.',
  'Ordinary life gets harder when you feel things a little more deeply.',
  'That is not a flaw. It is the raw material.',
];

if (showSet) {
  const slideBuffers = [];
  for (let i = 0; i < sampleSlides.length; i++) {
    const png = await sharp(Buffer.from(slideSvg(sampleSlides[i], i + 1, sampleSlides.length))).png().toBuffer();
    slideBuffers.push(png);
  }

  const width = 1080;
  const height = 1350 * sampleSlides.length;
  const composite = slideBuffers.map((buffer, index) => ({
    input: buffer,
    left: 0,
    top: index * 1350,
  }));

  const sheet = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#ffffff',
    },
  }).composite(composite).png().toBuffer();

  return [{
    json: {
      mimeType: 'image/png',
      fileName: 'instagram-preview-set.png',
    },
    binary: {
      data: await this.helpers.prepareBinaryData(sheet, 'instagram-preview-set.png', 'image/png'),
    },
  }];
}

const previewPng = await sharp(Buffer.from(slideSvg(sampleSlides[0], 1, sampleSlides.length))).png().toBuffer();

return [{
  json: {
    mimeType: 'image/png',
    fileName: 'instagram-preview.png',
  },
  binary: {
    data: await this.helpers.prepareBinaryData(previewPng, 'instagram-preview.png', 'image/png'),
  },
}];`,
    },
  });

  const respondWithBinary = (name, position) => node({
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.5,
    position,
    parameters: {
      respondWith: 'binary',
      responseDataSource: 'set',
      inputFieldName: 'data',
      options: {
        responseCode: 200,
      },
    },
  });

  const respondSlide = respondWithBinary('Respond Slide PNG', [-960, 320]);
  const respondPreview = respondWithBinary('Respond Preview PNG', [-960, 520]);

  const workflow = {
    id: id(),
    name: 'Instagram Carousel Trend Engine',
    active: true,
    nodes: [
      scheduleTrigger,
      webhook,
      previewWebhook,
      buildSourceList,
      fetchRss,
      harvestAndCategorize,
      fetchRecentTopics,
      gateCandidates,
      verifyNumericClaims,
      redundancyCheck,
      conceptPairing,
      modelKnowledgeLane,
      curatorEnrichScore,
      twoReaderRecheck,
      markConceptsUsed,
      insertBacklogCards,
      collapseAfterInsert,
      fetchBacklogForSelection,
      selectTopBacklogTopic,
      writeCarouselPlan,
      enforceWordBandsRhythm,
      prepareCarouselPayload,
      uploadCarouselSlides,
      upsertDraftRecord,
      generateEndResponse,
      getBufferOrganizations,
      pickBufferOrganization,
      getBufferChannels,
      pickInstagramChannel,
      queueInBuffer,
      upsertPublishedRecord,
      lookupCarousel,
      renderSlidePng,
      renderPreviewPng,
      respondSlide,
      respondPreview,
    ],
    connections: {
      'Schedule Trigger': {
        main: [[{ node: 'Build Source List', type: 'main', index: 0 }]],
      },
      'Instagram Preview Webhook': {
        main: [[{ node: 'Render Preview PNG', type: 'main', index: 0 }]],
      },
      'Render Preview PNG': {
        main: [[{ node: 'Respond Preview PNG', type: 'main', index: 0 }]],
      },
      'Build Source List': {
        main: [[{ node: 'Fetch RSS Feed', type: 'main', index: 0 }]],
      },
      'Fetch RSS Feed': {
        main: [[{ node: 'Harvest & Categorize', type: 'main', index: 0 }]],
      },
      'Harvest & Categorize': {
        main: [[{ node: 'Fetch Recent Topics', type: 'main', index: 0 }]],
      },
      'Fetch Recent Topics': {
        main: [[{ node: 'Gate Candidates', type: 'main', index: 0 }]],
      },
      'Gate Candidates': {
        main: [[{ node: 'Verify Numeric Claims', type: 'main', index: 0 }]],
      },
      'Verify Numeric Claims': {
        main: [[{ node: 'Redundancy Check', type: 'main', index: 0 }]],
      },
      'Redundancy Check': {
        main: [[{ node: 'Concept Pairing', type: 'main', index: 0 }]],
      },
      'Concept Pairing': {
        main: [[{ node: 'Model Knowledge Lane', type: 'main', index: 0 }]],
      },
      'Model Knowledge Lane': {
        main: [[{ node: 'Curator Enrich & Score', type: 'main', index: 0 }]],
      },
      'Curator Enrich & Score': {
        main: [[{ node: 'Two-Reader Recheck & Quotas', type: 'main', index: 0 }]],
      },
      'Two-Reader Recheck & Quotas': {
        main: [[{ node: 'Mark Concepts Used', type: 'main', index: 0 }]],
      },
      'Mark Concepts Used': {
        main: [[{ node: 'Insert Backlog Cards', type: 'main', index: 0 }]],
      },
      'Insert Backlog Cards': {
        main: [[{ node: 'Collapse After Insert', type: 'main', index: 0 }]],
      },
      'Collapse After Insert': {
        main: [[{ node: 'Fetch Backlog For Selection', type: 'main', index: 0 }]],
      },
      'Fetch Backlog For Selection': {
        main: [[{ node: 'Select Top Backlog Topic', type: 'main', index: 0 }]],
      },
      'Select Top Backlog Topic': {
        main: [[{ node: 'Write Carousel Plan', type: 'main', index: 0 }]],
      },
      'Write Carousel Plan': {
        main: [[{ node: 'Enforce Word Bands & Rhythm', type: 'main', index: 0 }]],
      },
      'Enforce Word Bands & Rhythm': {
        main: [[{ node: 'Prepare Carousel Payload', type: 'main', index: 0 }]],
      },
      'Prepare Carousel Payload': {
        main: [[{ node: 'Upload Carousel Slides', type: 'main', index: 0 }]],
      },
      'Upload Carousel Slides': {
        main: [[{ node: 'Upsert Draft Record', type: 'main', index: 0 }]],
      },
      'Upsert Draft Record': {
        main: [[{ node: 'Generate End Response', type: 'main', index: 0 }]],
      },
      'Generate End Response': {
        main: [[{ node: 'Get Buffer Organizations', type: 'main', index: 0 }]],
      },
      'Get Buffer Organizations': {
        main: [[{ node: 'Pick Buffer Organization', type: 'main', index: 0 }]],
      },
      'Pick Buffer Organization': {
        main: [[{ node: 'Get Buffer Channels', type: 'main', index: 0 }]],
      },
      'Get Buffer Channels': {
        main: [[{ node: 'Pick Instagram Channel', type: 'main', index: 0 }]],
      },
      'Pick Instagram Channel': {
        main: [[{ node: 'Queue in Buffer', type: 'main', index: 0 }]],
      },
      'Queue in Buffer': {
        main: [[{ node: 'Upsert Published Record', type: 'main', index: 0 }]],
      },
      'Instagram Slide Webhook': {
        main: [[{ node: 'Lookup Carousel', type: 'main', index: 0 }]],
      },
      'Lookup Carousel': {
        main: [[{ node: 'Render Slide PNG', type: 'main', index: 0 }]],
      },
      'Render Slide PNG': {
        main: [[{ node: 'Respond Slide PNG', type: 'main', index: 0 }]],
      },
    },
    settings: {
      executionOrder: 'v1',
      callerPolicy: 'workflowsFromSameOwner',
      saveManualExecutions: true,
    },
    meta: {
      templateCredsSetupCompleted: false,
    },
    versionId: id(),
  };

  return [workflow];
}

const outPath = process.env.WORKFLOW_OUTPUT_PATH
  || process.env.N8N_BOOTSTRAP_WORKFLOW_INPUT
  || path.resolve(__dirname, '..', 'artifacts', 'hosted-import', 'instagram-carousel-content-engine.workflow.json');
fs.writeFileSync(outPath, JSON.stringify(buildWorkflow(), null, 2) + '\n');
console.log(outPath);
