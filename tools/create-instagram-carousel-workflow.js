#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

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

  const selectTopTopic = node({
    name: 'Select Top Topic',
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
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
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
  const summary = String(item.json.contentSnippet || item.json.content || item.json.summary || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

const picked = ranked[0];
if (!picked) return [];
if (picked.score < 3) return [];

const topicKey = picked.dedupeKey;
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

return [{
  json: {
    sourceHash: topicKey,
    sourceName: picked.host,
    sourceType: picked.sourceTrust >= 3 ? 'news' : 'trend',
    title: picked.title,
    sourceUrl: picked.sourceUrl,
    publishedAt: picked.publishedAt || new Date().toISOString(),
    summary: picked.summary,
    category: picked.category,
    relevanceScore: Math.min(10, picked.score),
    trustScore: picked.sourceTrust,
    autoPublish: true,
    angle: angleMap[picked.category] || 'observation',
    status: 'selected',
  }
}];`,
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

  const semanticNoveltyFilter = node({
    name: 'Semantic Novelty Filter',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-480, -320],
    parameters: {
      jsCode: `const selected = $items("Select Top Topic")[0]?.json || {};
const recentRows = $input.all().map((item) => item.json).filter(Boolean);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !['the','and','for','with','from','that','this','have','will','your','you','are','new','how','can','our','their','about','into','what','when','why','who','but','not','all','now','use','used','india','indian','very','more','most','just','also','than','then','them','they','been','been'].includes(token));
}

function setFrom(text) {
  return new Set(tokenize(text));
}

function jaccard(a, b) {
  const setA = setFrom(a);
  const setB = setFrom(b);
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  for (const token of setA) if (setB.has(token)) overlap++;
  return overlap / new Set([...setA, ...setB]).size;
}

function similarity(current, row) {
  const currentText = [current.title, current.summary, current.category, current.angle].filter(Boolean).join(' ');
  const rowText = [row.title, row.summary, row.category, row.angle, row.draftText].filter(Boolean).join(' ');
  const tokenScore = jaccard(currentText, rowText);
  const titleScore = jaccard(current.title, row.title);
  const summaryScore = jaccard(current.summary, row.summary);
  const sameCategory = String(current.category || '') && String(current.category || '') === String(row.category || '') ? 0.08 : 0;
  return Math.max(tokenScore, titleScore * 0.9, summaryScore * 0.8) + sameCategory;
}

const recent = recentRows
  .sort((a, b) => (Date.parse(b.publishedAt || b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.publishedAt || a.updatedAt || a.createdAt || '') || 0))
  .slice(0, 20);

let strongest = { score: 0, match: null };
for (const row of recent) {
  const score = similarity(selected, row);
  if (score > strongest.score) {
    strongest = {
      score,
      match: row,
    };
  }
}

if (strongest.score >= 0.38) {
  return [];
}

return [{
  json: {
    ...selected,
    noveltyScore: Number((1 - strongest.score).toFixed(3)),
    noveltyClosestMatch: strongest.match?.title || '',
    noveltyClosestCategory: strongest.match?.category || '',
  }
}];`,
    },
  });

  const onlyNewTopic = node({
    name: 'Only New Topic?',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [-720, -160],
    parameters: {
      operation: 'rowNotExists',
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

Framework:
- Slide 1: sharp claim
- Slide 2: reject the obvious explanation
- Slide 3: reveal the real system or force
- Slide 4: show how it appears in ordinary life
- Slide 5: show the hidden cost
- Slide 6: show what people misread
- Slide 7: close with a blunt, memorable truth

Tone reference:
- certain
- calm
- specific
- unsentimental
- empathetic without being soft
- plainspoken, not performative

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
Audience: Indian Instagram users
Tone reference: calm, sharp, specific, unsentimental

Use the framework exactly:
1. sharp claim
2. reject the obvious explanation
3. reveal the real system or force
4. show how it appears in ordinary life
5. show the hidden cost
6. show what people misread
7. close with a blunt, memorable truth

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

  const prepareCarouselPayload = node({
    name: 'Prepare Carousel Payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, -160],
    parameters: {
      jsCode: `const plan = $node["Write Carousel Plan"]?.json?.message?.content || {};
const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const slideCount = Array.isArray(plan.slides) ? plan.slides.length : 0;
const supabaseUrl = String(process.env.SUPABASE_URL || 'https://nlmthljrbgnaevheszvg.supabase.co').replace(/\/+$/, '');
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
const supabaseUrl = String(process.env.SUPABASE_URL || 'https://nlmthljrbgnaevheszvg.supabase.co').replace(/\/+$/, '');
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseBucket = String(process.env.SUPABASE_STORAGE_BUCKET || plan.storageBucket || 'instagram-carousel-assets').trim();
const storagePrefix = String(plan.carouselStoragePrefix || ('instagram-carousel/' + token)).replace(/^\/+|\/+$/g, '');
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
  const words = String(text || '').split(/\s+/).filter(Boolean);
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

function slideSvg(text, index, total) {
  const bodyLines = lines(text, 30).slice(0, 8);
  const bodySvg = bodyLines.map((line, i) => '<text x="128" y="' + (250 + i * 72) + '" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700">' + esc(line) + '</text>').join('\\n    ');
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
          status: 'queued',
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
const accent = '#ffffff';
const dark = '#111111';
const subtle = '#666666';
const channelName = 'thoughts @ 3:18AM';

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(text, max = 28) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
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

const bodyLines = lines(body, 30).slice(0, 8);
const titleLines = lines(title, 34).slice(0, 2);

const titleSvg = titleLines.map((line, index) => '<text x="128" y="' + (236 + index * 56) + '" font-size="34" font-weight="700">' + esc(line) + '</text>').join('\\n    ');
const bodySvg = bodyLines.map((line, index) => '<text x="128" y="' + (360 + index * 72) + '" font-size="54" font-weight="700">' + esc(line) + '</text>').join('\\n    ');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
  '<defs>' +
    '<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">' +
      '<stop offset="0%" stop-color="' + accent + '"/>' +
      '<stop offset="100%" stop-color="#ffffff"/>' +
    '</linearGradient>' +
  '</defs>' +
  '<rect width="1080" height="1350" fill="url(#bg)"/>' +
  '<circle cx="84" cy="86" r="48" fill="#e9e2d7" stroke="#111111" stroke-width="2"/>' +
  '<circle cx="84" cy="86" r="34" fill="#d4c8b8"/>' +
  '<text x="152" y="74" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="700">' + esc(channelName) + '</text>' +
  '<text x="152" y="124" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="30">' + esc('Just now • 🌐') + '</text>' +
  '<circle cx="1002" cy="82" r="6" fill="' + subtle + '"/>' +
  '<circle cx="1024" cy="82" r="6" fill="' + subtle + '"/>' +
  '<circle cx="1046" cy="82" r="6" fill="' + subtle + '"/>' +
  '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
    titleSvg +
  '</g>' +
  '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
    bodySvg +
  '</g>' +
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
const channelName = 'thoughts @ 3:18AM';
const dark = '#111111';
const subtle = '#666666';

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(text, max = 30) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
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
  const bodyLines = lines(text, 28).slice(0, 8);
  const bodySvg = bodyLines.map((line, i) => '<text x="128" y="' + (250 + i * 72) + '" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700">' + esc(line) + '</text>').join('\\n    ');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
    '<rect width="1080" height="1350" fill="#ffffff"/>' +
    '<circle cx="84" cy="86" r="48" fill="#e9e2d7" stroke="#111111" stroke-width="2"/>' +
    '<circle cx="84" cy="86" r="34" fill="#d4c8b8"/>' +
    '<text x="152" y="74" fill="' + dark + '" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="700">' + esc(channelName) + '</text>' +
    '<text x="152" y="124" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="30">Just now • 🌐</text>' +
    '<circle cx="1002" cy="82" r="6" fill="' + subtle + '"/>' +
    '<circle cx="1024" cy="82" r="6" fill="' + subtle + '"/>' +
    '<circle cx="1046" cy="82" r="6" fill="' + subtle + '"/>' +
    '<g font-family="Arial, Helvetica, sans-serif" fill="' + dark + '">' +
      bodySvg +
    '</g>' +
    '<text x="128" y="1238" fill="' + subtle + '" font-family="Arial, Helvetica, sans-serif" font-size="24">Swipe for the next card</text>' +
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
      selectTopTopic,
      fetchRecentTopics,
      semanticNoveltyFilter,
      onlyNewTopic,
      writeCarouselPlan,
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
        main: [[{ node: 'Select Top Topic', type: 'main', index: 0 }]],
      },
      'Select Top Topic': {
        main: [[{ node: 'Fetch Recent Topics', type: 'main', index: 0 }]],
      },
      'Fetch Recent Topics': {
        main: [[{ node: 'Semantic Novelty Filter', type: 'main', index: 0 }]],
      },
      'Semantic Novelty Filter': {
        main: [[{ node: 'Only New Topic?', type: 'main', index: 0 }]],
      },
      'Only New Topic?': {
        main: [[{ node: 'Write Carousel Plan', type: 'main', index: 0 }]],
      },
      'Write Carousel Plan': {
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
