import { useEffect, useState } from 'react';
import docsText from '../docs/QOMO_TECH_PAPER.md?raw';

const BRAND = 'onboard';
const X_HANDLE = '@onbrd';
const X_URL = 'https://x.com/onbrd';
const CA = '5Ya5MEehcWSHMD8ptmKN33MMD4V5yJxm74pGMd6afomo';
const REFRESH_MS = 30_000;
const PUMP_JOIN_URL = 'https://pump.fun/join/x';

type DexPair = {
  marketCap?: number;
  fdv?: number;
  priceUsd?: string;
  url?: string;
  chainId?: string;
  dexId?: string;
  pairCreatedAt?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
};

function isValidMint(mint: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint);
}

function usd(value?: number | null) {
  if (value == null || Number.isNaN(value)) return 'pending';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pct(value?: number | null) {
  if (value == null || Number.isNaN(value)) return 'pending';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function short(value: string) {
  return value ? `${value.slice(0, 5)}...${value.slice(-5)}` : 'CA soon';
}

function bestMarket(pair: DexPair | null) {
  return pair?.marketCap ?? pair?.fdv ?? null;
}

async function loadDexPair(): Promise<DexPair | null> {
  if (!isValidMint(CA)) return null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CA}`);
    if (!res.ok) return null;
    const body = await res.json();
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    if (!pairs.length) return null;
    return pairs.sort((a: DexPair, b: DexPair) => Number(b?.volume?.h24 ?? 0) - Number(a?.volume?.h24 ?? 0))[0] as DexPair;
  } catch {
    return null;
  }
}

const points = [
  ['Tag qomo', `Reply ${X_HANDLE} under any post with a ticker, CA, meme, or coin question.`],
  ['It gets the context', 'Onboard reads the post, linked coin socials, and quoted tweet context to understand the narrative.'],
  ['It checks FOMO', 'Market cap, volume, age, flow, confidence, and risk flags in one fast scan.'],
  ['It replies clean', 'No public CAs, no backend names, just the reason the coin exists and the live market read.'],
] as const;

const examples = [
  ['$COIN', 'Find the strongest matching pair and chart.'],
  ['66HV...pump', 'Lookup a CA directly and summarize live stats.'],
  ['is there a coin for this?', 'Resolve the meme into likely launches.'],
  ['which ticker is real?', 'Rank matches by confidence, and volume.'],
] as const;

export default function App() {
  const isDocs = window.location.pathname.replace(/\/$/, '') === '/docs';

  return isDocs ? <DocsPage /> : <HomePage />;
}

function HomePage() {
  const [pair, setPair] = useState<DexPair | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const dex = await loadDexPair();
      if (alive) setPair(dex);
    }
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const marketCap = bestMarket(pair);
  const volume = pair?.volume?.h24 ?? null;
  const change = pair?.priceChange?.h24 ?? null;

  function copyCa() {
    if (!isValidMint(CA)) return;
    void navigator.clipboard.writeText(CA);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="qomo-page">
      <header className="qomo-nav">
        <a className="qomo-brand" href="#top" aria-label="onbrd home">
          <span>{BRAND}</span>
        </a>
        <div className="qomo-actions">
          <a href="/docs">docs</a>
          <a href={X_URL} target="_blank" rel="noreferrer">tag the bot</a>
          <button type="button" onClick={copyCa}>{copied ? 'copied' : short(CA)}</button>
        </div>
      </header>

      <section id="top" className="qomo-hero">
        <h1>ask onboard.</h1>
        <p>
          Tag {X_HANDLE} under any X post. Onboard reads the context, detects tickers and CAs, fetches live FOMO market data, and replies with the cleanest coin scan.
        </p>
        <div className="qomo-cta-row">
          <a href={X_URL} target="_blank" rel="noreferrer">open X</a>
          <a href="#tech">see tech</a>
          <a href="/docs">docs</a>
        </div>
      </section>

      <section className="onbrd-invite" aria-label="get started">
        <div className="onbrd-invite-copy">
          <span>your way in</span>
          <h2>Pumpfun invited you to pump.fun.</h2>
          <p>Trade internet trends, then come back to Onboard when you want a clearer starting point and a human-friendly next step.</p>
          <div className="qomo-cta-row">
            <a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">join with X</a>
            <a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">sign up</a>
          </div>
        </div>
        <div className="onbrd-invite-media">
          <img src="/pump-invite.png" alt="Pumpfun invited you to pump.fun" />
        </div>
      </section>

      <section className="qomo-strip" aria-label="live stats">
        <Stat label="market cap" value={usd(marketCap)} />
        <Stat label="24h volume" value={usd(volume)} />
        <Stat label="24h move" value={pct(change)} />
      </section>

      <section id="tech" className="qomo-grid">
        <div className="qomo-panel qomo-panel-bright">
          <span>sample reply</span>
          <h2>{sampleReply(pair)}</h2>
        </div>
        <div className="qomo-panel">
          <span>what it does</span>
          <div className="qomo-points">
            {points.map(([title, body], index) => (
              <article key={title}>
                <b>0{index + 1}</b>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="qomo-examples">
        <div>
          <span>ask it like this</span>
          <h2>context, chart, flow, risk, confidence.</h2>
        </div>
        <div className="qomo-example-list">
          {examples.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}


function age(value?: number | null) {
  if (!value) return 'pending';
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sampleReply(pair: DexPair | null) {
  const symbol = '$ONBRD';
  const marketCap = usd(bestMarket(pair));
  const volume = usd(pair?.volume?.h24 ?? null);
  const coinAge = age(pair?.pairCreatedAt ?? null);
  return `Found ${symbol}. MC ${marketCap}, vol24 ${volume}, age ${coinAge}. Context: X-native coin context bot for fast FOMO scans.`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

function DocsPage() {
  return (
    <main className="qomo-page qomo-docs-page">
      <header className="qomo-nav">
        <a className="qomo-brand" href="/" aria-label="onbrd home">
          <span>{BRAND}</span>
        </a>
        <div className="qomo-actions">
          <a href="/">home</a>
          <a href={X_URL} target="_blank" rel="noreferrer">tag the bot</a>
        </div>
      </header>

      <section className="qomo-docs-hero">
        <span>technical paper</span>
        <h1>onboard docs.</h1>
        <p>The on-site technical paper for how Onboard reads X context, resolves coins, and returns fast FOMO-native scans.</p>
      </section>

      <MarkdownDoc text={docsText} />
    </main>
  );
}

function MarkdownDoc({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  let code: string[] = [];
  let inCode = false;

  function flushList() {
    if (!list.length) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item) => <li key={item}>{item}</li>)}</ul>);
    list = [];
  }

  function flushCode() {
    if (!code.length) return;
    blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>);
    code = [];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(raw);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      blocks.push(<h1 key={`h1-${blocks.length}`}>{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      flushList();
      blocks.push(<h2 key={`h2-${blocks.length}`}>{line.slice(3)}</h2>);
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      list.push(line.replace(/^\d+\. /, ''));
    } else if (line.startsWith('> ')) {
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{line.slice(2)}</blockquote>);
    } else {
      flushList();
      blocks.push(<p key={`p-${blocks.length}`}>{line}</p>);
    }
  }
  flushList();
  flushCode();

  return <article className="qomo-docs">{blocks}</article>;
}
