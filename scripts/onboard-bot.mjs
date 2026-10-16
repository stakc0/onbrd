#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key]) process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
    }
  } catch {}
}

loadEnvFile(path.join(process.cwd(), '.env.bot.local'));
loadEnvFile(path.join(process.cwd(), '.env'));

const BOT_HANDLE = (process.env.BOT_HANDLE || 'useonboardapp').replace(/^@/, '');
const STATE_PATH = process.env.BOT_STATE_PATH || path.join(process.cwd(), 'data', 'onboard-bot-state.json');
const LOCK_PATH = process.env.BOT_LOCK_PATH || path.join(process.cwd(), 'data', 'onboard-bot.lock');
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const LOOP = process.env.LOOP === '1' || process.argv.includes('--loop');
const POLL_MS = Number(process.env.POLL_MS || 10000);
const MAX_RESULTS = Number(process.env.DEX_MAX_RESULTS || 5);
const MARKET_TIMEOUT_MS = Number(process.env.MARKET_TIMEOUT_MS || 1400);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 5000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 90_000);
const CACHE_PATH = process.env.CACHE_PATH || path.join(process.cwd(), 'data', 'onboard-context-cache.json');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const REFERRAL_BASE_URL = process.env.REFERRAL_BASE_URL || 'https://onboard.lol/signup?ref={username}';
const QR_BASE_URL = process.env.QR_BASE_URL || 'https://quickchart.io/qr?size=320&text=';
const APP_URL = process.env.APP_URL || 'https://pump.fun';
const FOMO_URL = process.env.FOMO_URL || 'https://fomo.family';
const SUPPORT_URL = process.env.SUPPORT_URL || 'https://onboard.lol';
const FOMO_LINK_CHANCE = Number(process.env.FOMO_LINK_CHANCE || 0.3);
const SUPPORT_LINK_CHANCE = Number(process.env.SUPPORT_LINK_CHANCE || 0.25);

const required = ['X_BEARER_TOKEN', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

function enc(value) {
  return encodeURIComponent(value).replace(/[!*()']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method, url, extraParams = {}) {
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
    ...extraParams,
  };
  const u = new URL(url);
  const params = [];
  for (const [key, value] of u.searchParams.entries()) params.push([key, value]);
  for (const [key, value] of Object.entries(oauth)) params.push([key, value]);
  params.sort(([a, av], [b, bv]) => (a === b ? String(av).localeCompare(String(bv)) : a.localeCompare(b)));
  const paramString = params.map(([key, value]) => `${enc(key)}=${enc(value)}`).join('&');
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = [method.toUpperCase(), enc(baseUrl), enc(paramString)].join('&');
  const signingKey = `${enc(process.env.X_API_SECRET)}&${enc(process.env.X_ACCESS_TOKEN_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${enc(key)}="${enc(value)}"`).join(', ');
}

async function xGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`X GET ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function xPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', url), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`X POST ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function acquireLock() {
  await fsp.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const handle = await fsp.open(LOCK_PATH, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    await handle.close();
    const release = async () => { try { await fsp.unlink(LOCK_PATH); } catch {} };
    process.on('exit', () => { try { fs.unlinkSync(LOCK_PATH); } catch {} });
    process.on('SIGINT', async () => { await release(); process.exit(130); });
    process.on('SIGTERM', async () => { await release(); process.exit(143); });
    return release;
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    try {
      const lock = JSON.parse(await fsp.readFile(LOCK_PATH, 'utf8'));
      const age = Date.now() - Number(lock.startedAt || 0);
      const alive = lock.pid ? process.kill(Number(lock.pid), 0) || true : false;
      if (!alive || age > 10 * 60 * 1000) {
        await fsp.unlink(LOCK_PATH).catch(() => {});
        return acquireLock();
      }
    } catch (e) {
      if (e?.code === 'ESRCH') {
        await fsp.unlink(LOCK_PATH).catch(() => {});
        return acquireLock();
      }
    }
    console.error(`another Onboard bot instance is already running; lock=${LOCK_PATH}`);
    process.exit(0);
  }
}

async function readState() {
  try { return JSON.parse(await fsp.readFile(STATE_PATH, 'utf8')); }
  catch { return { seen: [], newestId: undefined, botUserId: undefined, initialized: false }; }
}

async function writeState(state) {
  state.seen = [...new Set(state.seen)].slice(-500);
  await fsp.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fsp.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function readCache() {
  try { return JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}

async function writeCache(cache) {
  const fresh = Object.fromEntries(Object.entries(cache).filter(([, item]) => Date.now() - Number(item?.ts || 0) < CACHE_TTL_MS));
  await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fsp.writeFile(CACHE_PATH, JSON.stringify(fresh, null, 2));
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, ms = MARKET_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function byId(items = []) {
  return new Map(items.filter(Boolean).map((item) => [item.id, item]));
}

function directParentTweet(tweet, tweetsById) {
  const refs = tweet?.referenced_tweets || [];
  const reply = refs.find((ref) => ref.type === 'replied_to');
  const quote = refs.find((ref) => ref.type === 'quoted');
  return tweetsById.get(reply?.id) || tweetsById.get(quote?.id) || null;
}

async function getBotUserId(state) {
  if (state.botUserId) return state.botUserId;
  const params = new URLSearchParams({ 'user.fields': 'username' });
  const json = await xGet(`https://api.x.com/2/users/by/username/${BOT_HANDLE}?${params}`);
  state.botUserId = json.data?.id;
  if (!state.botUserId) throw new Error(`could not resolve bot user id for @${BOT_HANDLE}`);
  await writeState(state);
  return state.botUserId;
}

async function fetchMentions(state) {
  const botUserId = await getBotUserId(state);
  const params = new URLSearchParams({
    max_results: '10',
    'tweet.fields': 'author_id,conversation_id,created_at,referenced_tweets,text',
    expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id',
    'user.fields': 'username,name,description,verified,verified_type',
  });
  if (state.newestId) params.set('since_id', state.newestId);
  return xGet(`https://api.x.com/2/users/${botUserId}/mentions?${params}`);
}

async function fetchTweetWithAuthor(tweetId) {
  const params = new URLSearchParams({
    ids: tweetId,
    'tweet.fields': 'author_id,conversation_id,created_at,referenced_tweets,text',
    expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id',
    'user.fields': 'username,name,description,verified,verified_type',
  });
  const json = await xGet(`https://api.x.com/2/tweets?${params}`);
  const tweet = json.data?.[0];
  const author = json.includes?.users?.find((user) => user.id === tweet?.author_id);
  return { tweet, author, includes: json.includes || {} };
}

async function resolveOriginalTarget(startTweet, initialIncludes) {
  let target = startTweet;
  const seen = new Set();
  let tweetsById = byId([...(initialIncludes?.tweets || []), startTweet]);
  let usersById = byId(initialIncludes?.users || []);

  for (let depth = 0; target?.id && depth < 6 && !seen.has(target.id); depth++) {
    seen.add(target.id);
    let parent = directParentTweet(target, tweetsById);
    if (!parent) {
      const ref = (target.referenced_tweets || []).find((item) => item.type === 'replied_to') || (target.referenced_tweets || []).find((item) => item.type === 'quoted');
      if (ref?.id) {
        const fetched = await fetchTweetWithAuthor(ref.id);
        parent = fetched.tweet;
        tweetsById = byId([...tweetsById.values(), ...(fetched.includes?.tweets || []), parent]);
        usersById = byId([...usersById.values(), ...(fetched.includes?.users || []), fetched.author]);
      }
    }
    if (!parent) break;
    target = parent;
  }

  let author = usersById.get(target?.author_id);
  if (!author && target?.id) {
    const fetched = await fetchTweetWithAuthor(target.id);
    target = fetched.tweet || target;
    author = fetched.author || author;
  }
  return { target, author };
}

function shouldProcessMention(mention, includes, botUserId) {
  if (mention.author_id === botUserId) return false;
  const tagPattern = new RegExp(`@${BOT_HANDLE}\\b`, 'i');
  if (!tagPattern.test(mention.text || '')) return false;
  const tweetsById = byId([...(includes?.tweets || []), mention]);
  const parent = directParentTweet(mention, tweetsById);
  if (parent?.author_id === botUserId) return false;
  return true;
}

function extractQueries(text) {
  const cleaned = String(text || '').replace(new RegExp(`@${BOT_HANDLE}\\b`, 'ig'), ' ');
  const cas = [...cleaned.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((match) => match[0]);
  const tickers = [...cleaned.matchAll(/\$([A-Za-z][A-Za-z0-9_]{1,15})\b/g)].map((match) => match[1].toUpperCase());
  const quoted = [...cleaned.matchAll(/["“”']([^"“”']{3,40})["“”']/g)].map((match) => match[1].trim());
  const words = cleaned
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && word.length <= 18)
    .filter((word) => !['the', 'and', 'for', 'this', 'that', 'with', 'coin', 'token', 'what', 'where', 'chart', 'ticker'].includes(word.toLowerCase()))
    .slice(0, 4);
  return { cas: [...new Set(cas)].slice(0, 3), tickers: [...new Set(tickers)].slice(0, 4), phrases: [...new Set([...quoted, ...words])].slice(0, 4) };
}

async function dexToken(address) {
  const body = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  return Array.isArray(body?.pairs) ? body.pairs : [];
}

async function dexSearch(query) {
  const body = await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  return Array.isArray(body?.pairs) ? body.pairs : [];
}

async function cachedMarket(key, load) {
  const cache = await readCache();
  const hit = cache[key];
  if (hit && Date.now() - Number(hit.ts || 0) < CACHE_TTL_MS) return hit.value;
  const value = await load();
  cache[key] = { ts: Date.now(), value };
  await writeCache(cache).catch(() => {});
  return value;
}

function pairScore(pair, queries) {
  const symbol = String(pair?.baseToken?.symbol || '').toUpperCase();
  const name = String(pair?.baseToken?.name || '').toUpperCase();
  const address = String(pair?.baseToken?.address || '');
  let score = 0;
  if (pair?.chainId === 'solana') score += 20;
  if (queries.cas.includes(address)) score += 100;
  for (const ticker of queries.tickers) {
    if (symbol === ticker) score += 80;
    else if (symbol.includes(ticker) || name.includes(ticker)) score += 28;
  }
  for (const phrase of queries.phrases) {
    const upper = phrase.toUpperCase();
    if (name === upper || symbol === upper) score += 45;
    else if (name.includes(upper) || symbol.includes(upper)) score += 18;
  }
  score += Math.min(22, Math.log10(Number(pair?.liquidity?.usd || 0) + 1) * 4);
  score += Math.min(18, Math.log10(Number(pair?.volume?.h24 || 0) + 1) * 3);
  return score;
}

function rankPairs(pairs, queries) {
  const deduped = new Map();
  for (const pair of pairs) {
    const key = pair?.baseToken?.address || pair?.pairAddress || JSON.stringify(pair).slice(0, 80);
    const current = deduped.get(key);
    if (!current || Number(pair?.liquidity?.usd || 0) > Number(current?.liquidity?.usd || 0)) deduped.set(key, pair);
  }
  return [...deduped.values()]
    .map((pair) => ({ pair, score: pairScore(pair, queries) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

function usdShort(value) {
  if (value == null || Number.isNaN(Number(value))) return 'n/a';
  const n = Number(value);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function ageShort(pair) {
  if (!pair?.pairCreatedAt) return 'n/a';
  const ms = Date.now() - Number(pair.pairCreatedAt);
  if (ms < 0) return 'new';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function shortAddress(value) {
  return value ? `${value.slice(0, 5)}...${value.slice(-5)}` : 'n/a';
}

function confidence(score) {
  if (score >= 95) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

function riskFlags(pair) {
  const flags = [];
  if (Number(pair?.volume?.h24 || 0) < 1000) flags.push('low volume');
  if (pair?.chainId !== 'solana') flags.push(pair?.chainId || 'non-sol');
  if (!pair?.pairCreatedAt) flags.push('age unknown');
  return flags.slice(0, 3).join(', ') || 'verify official links';
}

function onboardOpinion(pair, score) {
  const mc = Number(pair?.marketCap ?? pair?.fdv ?? 0);
  const vol = Number(pair?.volume?.h24 || 0);
  const h1 = Number(pair?.priceChange?.h1 ?? pair?.priceChange?.h24 ?? 0);
  const m5 = Number(pair?.priceChange?.m5 ?? 0);
  if (score < 45) return 'messy match, I would verify the narrative first';
  if (h1 < -45 || m5 < -35) return 'active narrative, but chart is damaged right now';
  if (vol > mc * 3 && h1 > 20) return 'strong attention relative to size, worth watching closely';
  if (vol > mc && h1 > 0) return 'healthy early flow if the context keeps spreading';
  if (vol < 1000) return 'context may be real, but market activity is still quiet';
  return 'decent scan, I would watch whether FOMO flow keeps confirming it';
}

function tweetIdFromUrl(url) {
  return String(url || '').match(/status\/(\d+)/)?.[1] || null;
}

function usernameFromXUrl(url) {
  const match = String(url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  const user = match?.[1];
  if (!user || ['i', 'intent', 'share', 'search', 'home'].includes(user.toLowerCase())) return null;
  return user;
}

function communityIdFromXUrl(url) {
  return String(url || '').match(/(?:x|twitter)\.com\/i\/communities\/(\d+)/i)?.[1] || null;
}

async function fetchTweetContext(tweetId) {
  if (!tweetId) return '';
  const params = new URLSearchParams({
    ids: tweetId,
    'tweet.fields': 'author_id,created_at,text,public_metrics,referenced_tweets',
    expansions: 'referenced_tweets.id,referenced_tweets.id.author_id',
    'user.fields': 'username,name,description,verified,verified_type,public_metrics',
  });
  const json = await withTimeout(xGet(`https://api.x.com/2/tweets?${params}`), 2500, null);
  const main = json?.data?.[0]?.text || '';
  const quoted = (json?.includes?.tweets || []).map((tweet) => tweet.text).filter(Boolean).slice(0, 2).join('\n');
  return [main, quoted].filter(Boolean).join('\n');
}

async function fetchWebContext(url) {
  if (!url) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html,text/plain,*/*' } });
    if (!res.ok) return '';
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1];
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ');
    return [title, h1, description]
      .filter(Boolean)
      .map((text) => text.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim())
      .join('\n');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}


async function fetchProfileContext(username) {
  if (!username) return '';
  const params = new URLSearchParams({ 'user.fields': 'username,name,description,verified,verified_type,public_metrics' });
  const json = await withTimeout(xGet(`https://api.x.com/2/users/by/username/${username}?${params}`), 1200, null);
  const user = json?.data;
  if (!user) return '';
  const followers = user.public_metrics?.followers_count != null ? `${user.public_metrics.followers_count} followers` : '';
  return [`profile: @${user.username}`, user.name, user.description, followers].filter(Boolean).join('\n');
}

async function fetchCommunityContext(communityId) {
  if (!communityId) return '';
  const urls = [
    `https://api.x.com/2/communities/${communityId}`,
    `https://api.x.com/2/communities/${communityId}?community.fields=name,description,member_count,created_at`,
  ];
  for (const url of urls) {
    const json = await withTimeout(xGet(url), 1200, null);
    const data = json?.data;
    if (data) return [`community: ${data.name || communityId}`, data.description, data.member_count != null ? `${data.member_count} members` : ''].filter(Boolean).join('\n');
  }
  return `community: ${communityId}`;
}

async function xUrlContext(url) {
  if (!url) return '';
  const tweetText = await fetchTweetContext(tweetIdFromUrl(url));
  if (tweetText) return tweetText;
  const communityText = await fetchCommunityContext(communityIdFromXUrl(url));
  if (communityText) return communityText;
  return fetchProfileContext(usernameFromXUrl(url));
}

async function pumpMetadata(mint) {
  if (!mint) return null;
  return fetchJson(`https://frontend-api-v3.pump.fun/coins/${mint}`, 1200);
}

async function pairSocialContext(pair) {
  const socials = Array.isArray(pair?.info?.socials) ? pair.info.socials : [];
  const marketXUrl = socials.find((social) => ['twitter', 'x'].includes(String(social?.type || '').toLowerCase()))?.url;
  const meta = await withTimeout(pumpMetadata(pair?.baseToken?.address), 1200, null);
  const tokenXUrl = meta?.twitter || marketXUrl;

  // If token metadata links an X status, make that tweet the primary Context source.
  if (tweetIdFromUrl(tokenXUrl)) return xUrlContext(tokenXUrl);

  const xText = await xUrlContext(tokenXUrl);
  if (xText) return xText;

  const websiteText = await fetchWebContext(meta?.website);
  return [
    websiteText,
    meta?.description,
    meta?.name,
    meta?.symbol,
    meta?.website ? `website: ${meta.website}` : '',
  ].filter(Boolean).join('\n');
}

async function gatherMarketIntel(text) {
  const queries = extractQueries(text);
  const tasks = [
    ...queries.cas.map((ca) => cachedMarket(`token:${ca}`, () => dexToken(ca))),
    ...queries.tickers.map((ticker) => cachedMarket(`search:${ticker}`, () => dexSearch(ticker))),
    ...queries.phrases.slice(0, 3).map((phrase) => cachedMarket(`search:${phrase.toLowerCase()}`, () => dexSearch(phrase))),
  ];
  const settled = await withTimeout(Promise.allSettled(tasks), MARKET_TIMEOUT_MS + 450, []);
  const allPairs = settled.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
  return { queries, ranked: rankPairs(allPairs, queries) };
}


function smartNarrativeSummary(sourceText, pair) {
  const text = String(sourceText || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[A-Za-z0-9_]+/g, (match) => match.slice(1))
    .replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, ' ')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^profile:/i.test(text)) return '';
  const lower = text.toLowerCase();
  const name = String(pair?.baseToken?.name || '').replace(/^the\s+/i, '').trim();
  const subject = name || String(pair?.baseToken?.symbol || '').replace(/^\$+/, '').trim() || 'coin';
  if (/viral|views|upvotes|likes/.test(lower)) {
    const metric = text.match(/\b\d+(?:\.\d+)?\s*(?:k|m|b)?\s*(?:views|upvotes|likes)\b/i)?.[0];
    return `${subject} narrative built from a fresh viral post${metric ? ` with ${metric}` : ''}`;
  }
  if (/bbc|major news|news outlets|reported|reportedly/.test(lower)) return `${subject} narrative tied to fresh major-news coverage and early social spread`;
  return '';
}

async function llmNarrativeSummary(sourceText, pair) {
  if (!process.env.OPENROUTER_API_KEY || !OPENROUTER_MODEL) return '';
  const token = [pair?.baseToken?.name, pair?.baseToken?.symbol ? `$${pair.baseToken.symbol}` : ''].filter(Boolean).join(' / ');
  const cleaned = String(sourceText || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800);
  if (!cleaned || /^profile:/i.test(cleaned)) return '';
  const prompt = `Summarize the coin narrative from this token-linked X tweet/source in one sharp line.

Rules:
- Use the tweet/source only.
- Explain the actual event, post, product, character, or joke the token represents.
- Never output generic labels such as "ticker-led meme", "meme coin", or "community token" by themselves.
- Do not mention contract addresses.
- Do not say risk.
- Do not use hashtags or emojis.
- No em dashes.
- Make it trader-native and specific, not generic.
- 90 to 150 characters max.
- Return only the context line, no label.

Token: ${token}
Source: ${cleaned}`;
  const res = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://onboard.ai',
      'X-Title': 'Onboard',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: 70 }),
  }), Math.min(LLM_TIMEOUT_MS, 4500), null);
  if (!res) return '';
  const json = await res.json();
  if (!res.ok) return '';
  const summary = cleanReply(json.choices?.[0]?.message?.content || '')
    .replace(/^Context:\s*/i, '')
    .replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, (match) => match.slice(1))
    .trim()
    .slice(0, 180);
  if (/^(?:a\s+)?(?:ticker-led meme|meme coin|community token|crypto token)[.!]?$/i.test(summary)) return '';
  return summary;
}

function narrativeLine(pair, queries, sourceText = '') {
  const symbol = String(pair?.baseToken?.symbol || '').replace(/^\$+/, '');
  const name = String(pair?.baseToken?.name || '');
  const summary = smartNarrativeSummary(sourceText, pair);
  const context = summary || headlineContext(sourceText) || contextPhrase(sourceText, pair, queries);
  const base = context || (name && symbol && name.toLowerCase() !== symbol.toLowerCase() ? `${name} / ${symbol}` : symbol || name);
  const kind = narrativeKind(pair, queries, sourceText);
  if (!base && kind && kind !== 'ticker-led meme') return kind;
  if (!base) return 'linked X context is not available yet';
  if (!kind || kind === 'ticker-led meme') return base;
  return `${base} ${kind.toLowerCase()}`;
}

function headlineContext(sourceText) {
  const lines = String(sourceText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^profile:/i.test(line))
    .filter((line) => !/^\d+\s+followers$/i.test(line))
    .filter((line) => !/^@[A-Za-z0-9_]+\s+@?[A-Za-z0-9_]*\s*[A-Za-z0-9]{32,44}\b/.test(line));
  const line = lines.find((item) => /\b(abandoned|underweight|survived|alone|orphan)\b/i.test(item))
    || lines.find((item) => /\b(bbc|news|viral|views|likes|creator|onboard|predicts|reportedly|flips|mascot|launched|meme)\b/i.test(item))
    || lines.find((item) => /\b(found|posted|just in|breaking|source)\b/i.test(item))
    || lines[0];
  if (!line) return '';
  return line
    .replace(/^\s*(JUST IN|BREAKING)\s*:?\s*/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@[A-Za-z0-9_]+/g, (match) => match.slice(1))
    .replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, '')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, '')
    .replace(/[“”]/g, '')
    .replace(/^showing him\s+/i, '')
    .replace(/^its just been posted by\s+/i, 'posted by ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 118);
}

function contextPhrase(sourceText, pair, queries) {
  const symbol = String(pair?.baseToken?.symbol || '').replace(/^\$+/, '').toLowerCase();
  const nameParts = String(pair?.baseToken?.name || '').toLowerCase().split(/\s+/);
  const stop = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'coin', 'token', 'what', 'where', 'chart', 'ticker', 'onboard', BOT_HANDLE.toLowerCase(), symbol, ...nameParts]);
  const quoted = [...String(sourceText || '').matchAll(/["“”']([^"“”']{3,54})["“”']/g)].map((match) => match[1].trim())[0];
  if (quoted) return quoted.slice(0, 58);
  const words = String(sourceText || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[A-Za-z0-9_]+/g, ' ')
    .replace(/\$[A-Za-z0-9_]+/g, ' ')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && word.length <= 18 && !stop.has(word.toLowerCase()))
    .slice(0, 7);
  return words.length >= 2 ? words.join(' ') : queries.phrases[0] || '';
}

function narrativeKind(pair, queries, sourceText = '') {
  const symbol = String(pair?.baseToken?.symbol || '').replace(/^\$+/, '');
  const name = String(pair?.baseToken?.name || '');
  const source = String(sourceText || '').trim();
  const text = `${symbol} ${name} ${source || queries.phrases.join(' ')}`.toLowerCase();
  const checks = [
    [/\b(ai|agent|gpt|bot|robot|neural|compute|quantum)\b/, 'AI / agent meta'],
    [/\b(dog|cat|frog|monkey|ape|penguin|fish|shark|bird|goat|horse|seal|animal)\b/, 'animal meme'],
    [/\b(trump|biden|president|election|senate|politic|maga|america|usa)\b/, 'political meme'],
    [/\b(tiktok|youtube|instagram|x |twitter|stream|viral|meme|trend)\b/, 'viral culture meme'],
    [/\b(pepe|wojak|chad|retardio|mog|bonk|wif|popcat)\b/, 'existing meme derivative'],
    [/\b(app|api|scan|terminal|wallet|trade|chart|tool|protocol|platform)\b/, 'product / utility coin'],
    [/\b(god|jesus|angel|devil|cult|religion|soul|heaven|hell)\b/, 'mythic / belief meme'],
    [/\b(food|burger|pizza|fries|nugget|coke|drink|coffee)\b/, 'food / brand meme'],
  ];
  const hit = checks.find(([regex]) => regex.test(text));
  if (hit) return hit[1];
  if (queries.tickers.length && symbol && queries.tickers.includes(symbol.toUpperCase())) return 'ticker-led meme';
  return '';
}

async function deterministicReply({ author, queries, ranked, sourceText }) {
  const name = author?.username ? `@${author.username}` : 'scan';
  if (!ranked.length) {
    const searched = [...queries.cas.map(() => 'posted address'), ...queries.tickers.map((t) => `$${t}`), ...queries.phrases].filter(Boolean).slice(0, 4).join(', ') || 'the post';
    return `${name} onboard scan\n\nMatch: none found\nContext: no strong live FOMO market match for ${searched}\nRisk: could be unlaunched, misspelled, too new, or using a different ticker\n\nOnboard take: verify official links before buying.`;
  }

  const top = ranked[0];
  const pair = top.pair;
  const symbol = pair?.baseToken?.symbol ? `$${pair.baseToken.symbol}` : 'coin';
  const mc = pair?.marketCap ?? pair?.fdv;
  const vol = pair?.volume?.h24;
  const buys = pair?.txns?.h24?.buys;
  const sells = pair?.txns?.h24?.sells;
  const txLine = buys != null || sells != null ? ` | buys/sells ${buys ?? 0}/${sells ?? 0}` : '';
  const extras = ranked.slice(1, 4).map((item) => item.pair?.baseToken?.symbol ? `${item.pair.baseToken.symbol} ${usdShort(item.pair.marketCap ?? item.pair.fdv)}` : '').filter(Boolean);

  const narrative = await llmNarrativeSummary(sourceText, pair) || narrativeLine(pair, queries, sourceText);
  const opinion = onboardOpinion(pair, top.score);
  const searchTarget = symbol.replace(/^\$/, '');
  const searchLine = Math.random() < FOMO_LINK_CHANCE ? `Search ${searchTarget} on ${FOMO_URL}` : `Search ${searchTarget} on FOMO`;
  const supportLine = Math.random() < SUPPORT_LINK_CHANCE ? `\n\nSupport Onboard: ${SUPPORT_URL}` : '';
  return `${name} onboard scan\n\nMatch: ${symbol}\nContext: ${narrative}\nFOMO: MC ${usdShort(mc)} | vol24 ${usdShort(vol)}${txLine}\nAge: ${ageShort(pair)} | confidence: ${confidence(top.score)}\nRisk: ${riskFlags(pair)}\n\nOnboard take: ${opinion}\n${searchLine}${extras.length ? `\n\nOther matches: ${extras.join(', ')}` : ''}${supportLine}`;
}

function cleanReply(text) {
  const cleaned = String(text || '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[—–]/g, '-')
    .replace(/#[A-Za-z0-9_]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 900);
  let seenCashtag = false;
  return cleaned.replace(/\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g, (match) => {
    if (!seenCashtag) {
      seenCashtag = true;
      return match;
    }
    return match.slice(1);
  });
}

function hasExplicitCoinSignal(queries) {
  return Boolean(queries.cas.length || queries.tickers.length);
}

function friendlyClarifier({ author, mention }) {
  const name = author?.username ? `@${author.username}` : 'hey';
  const variants = [
    `${name} I can help, but I need a ticker or coin address to pull the FOMO read. Send one over and I will scan it.`,
    `${name} drop me a ticker or coin address and I can get you the stats, context, flow, and Onboard take.`,
    `${name} I am not seeing a clear ticker or coin address here. Reply with one and I will run the scan.`,
    `${name} give me a ticker or coin address and I will check the live FOMO context for you.`,
    `${name} I need one more clue. Send a ticker or coin address and I can pull the market read.`,
  ];
  const seed = String(mention?.id || name).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

async function llmPolish(context) {
  const base = await deterministicReply(context);
  if (!process.env.OPENROUTER_API_KEY) return base;
  const prompt = `Rewrite this X bot reply to be compact, clean, useful, and trader-native.

Hard rules:
- Keep the same structure: Match, Context, FOMO, Age/confidence, Risk, Onboard take, Search, optional Support Onboard line.
- Keep all numbers and the one-line context.
- Onboard take must be a short opinion, not generic safety filler.
- Do not include any contract address or shortened contract address.
- Use at most one cashtag total in the entire post.
- Never mention any backend data provider.
- Say FOMO for the market platform. Keep the FOMO URL only if it is already present in the draft. Keep Support Onboard only if it is already present in the draft.
- Plain text only. No hashtags. No emojis. No em dashes.
- Max 760 characters.

Reply to rewrite:\n\n${base}`;
  const res = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://onboard.ai',
      'X-Title': 'Onboard',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.35, max_tokens: 260 }),
  }), LLM_TIMEOUT_MS, null);
  if (!res) return base;
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(json)}`);
  return cleanReply(json.choices?.[0]?.message?.content || base);
}

function referralUrl(username = 'friend') {
  return REFERRAL_BASE_URL
    .replaceAll('{username}', encodeURIComponent(username.replace(/^@/, '')))
    .replaceAll('{handle}', encodeURIComponent(username.replace(/^@/, '')));
}

function qrUrl(url) {
  return `${QR_BASE_URL}${encodeURIComponent(url)}`;
}

function composeReply(intro, signup, qr) {
  const suffix = ` Signup: ${signup} QR: ${qr} App: ${APP_URL}`;
  const room = Math.max(20, 280 - suffix.length);
  return `${String(intro || '').trim().slice(0, room)}${suffix}`;
}

function fallbackOnboarding({ author, target, mention, signup, qr }) {
  const name = author?.username ? `@${author.username}` : '@there';
  const subject = String(target?.text || mention?.text || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  return composeReply(`${name} I read your post${subject ? ` about ${subject}` : ''}. Start here: open the link, create an account, then download the official app from the app store and sign in with the same account.`, signup, qr);
}

async function llmOnboarding({ author, target, mention, signup, qr }) {
  const original = String(target?.text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const request = String(mention?.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const profile = [author?.name, author?.username ? `@${author.username}` : '', author?.description].filter(Boolean).join(' | ').slice(0, 500);
  const fallback = fallbackOnboarding({ author, target, mention, signup, qr });
  if (!process.env.OPENROUTER_API_KEY) return fallback;
  const prompt = `You are Onboard, a warm X onboarding assistant. A user tagged you and needs a useful, personalized first reply, not a canned autoresponder.

Use the original post, the user's request, and their profile to infer what they are trying to do. Acknowledge the actual topic in one short phrase, then give the clearest next steps for getting started on the Onboard signup flow. If they seem advanced, keep it efficient. If they seem new, explain simply. Do not invent features or ask unnecessary questions.

Hard rules:
- Return plain text only, one concise X reply, maximum 120 characters before the links.
- No hashtags, emojis, markdown, hype, promises, or financial advice.
- Mention the signup link, QR link, and app link exactly once.
- Keep these exact links unchanged:
Signup: ${signup}
QR: ${qr}
App: ${APP_URL}
- If the user is new, say to download the official app from the app store and sign in with the same account.
- Do not mention being an AI, prompts, or backend systems.

User profile: ${profile || 'unknown'}
Original post: ${original || 'not available'}
Tag/request: ${request || 'help me get started'}`;
  const res = await withTimeout(fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://onboard.lol',
      'X-Title': 'Onboard',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.55, max_tokens: 120 }),
  }), LLM_TIMEOUT_MS, null);
  if (!res) return fallback;
  try {
    const json = await res.json();
    if (!res.ok) return fallback;
    const text = cleanReply(json.choices?.[0]?.message?.content || '')
      .replace(/Signup:\s*\S+/ig, '')
      .replace(/QR:\s*\S+/ig, '')
      .replace(/App:\s*\S+/ig, '')
      .trim()
      .slice(0, 170);
    return composeReply(text || fallback.split(' Signup:')[0], signup, qr);
  } catch {
    return fallback;
  }
}

async function handleMention(mention, includes) {
  const tweetsById = byId([...(includes?.tweets || []), mention]);
  const startTarget = directParentTweet(mention, tweetsById) || mention;
  const { target, author } = await resolveOriginalTarget(startTarget, includes);
  const usersById = byId(includes?.users || []);
  const finalAuthor = author || usersById.get(target?.author_id) || usersById.get(mention.author_id);
  const username = finalAuthor?.username || 'friend';
  const signup = referralUrl(username);
  const qr = qrUrl(signup);
  const text = await llmOnboarding({ author: finalAuthor, target, mention, signup, qr });
  if (DRY_RUN) {
    console.log(`\n--- DRY RUN Onboard reply to mention=${mention.id} target=${target?.id} ---\n${text}\n`);
    return;
  }
  const posted = await xPost('https://api.x.com/2/tweets', { text, reply: { in_reply_to_tweet_id: mention.id } });
  console.log(`${new Date().toISOString()} onboard reply mention=${mention.id} target=${target?.id} tweet=${posted?.data?.id}`);
}
async function runOnce() {
  const state = await readState();
  const botUserId = await getBotUserId(state);
  const json = await fetchMentions(state);
  const mentions = (json.data || []).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  if (!mentions.length) {
    console.log(`${new Date().toISOString()} no new mentions`);
    return;
  }

  // Process the first observed mention too. Skipping the initial batch makes a fresh bot silently miss its first real tag.
  state.initialized = true;

  for (const mention of mentions) {
    if (state.seen.includes(mention.id)) continue;
    if (!shouldProcessMention(mention, json.includes || {}, botUserId)) {
      state.seen.push(mention.id);
      if (!state.newestId || BigInt(mention.id) > BigInt(state.newestId)) state.newestId = mention.id;
      await writeState(state);
      continue;
    }
    try {
      await handleMention(mention, json.includes || {});
      state.seen.push(mention.id);
      if (!state.newestId || BigInt(mention.id) > BigInt(state.newestId)) state.newestId = mention.id;
      await writeState(state);
    } catch (err) {
      console.error(`failed mention=${mention.id}:`, err.message || err);
    }
  }
}

async function main() {
  const releaseLock = await acquireLock();
  try {
    if (!LOOP) return await runOnce();
    console.log(`${new Date().toISOString()} polling @${BOT_HANDLE} every ${POLL_MS}ms${DRY_RUN ? ' (dry-run)' : ''}`);
    while (true) {
      try { await runOnce(); }
      catch (err) { console.error(err.message || err); }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    if (!LOOP) await releaseLock();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
