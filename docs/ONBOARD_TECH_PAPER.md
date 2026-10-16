# Onboard Technical Paper

## Idea

Onboard is an X-native coin context bot.

Tag `@askonboard` under a post, ticker, or contract discussion. Onboard quickly answers:

> What is this coin, why does it exist, and what does the live market look like?

The product is built for fast public coin discovery. It reads the context around a coin, finds the strongest market match, and replies with a compact FOMO-native scan.

## What Onboard Returns

A Onboard reply is designed to be short, useful, and easy to read on the timeline.

It can include:

- best matching ticker
- one-line context explaining the coin narrative
- market cap
- 24h volume
- age
- buy/sell flow
- confidence
- risk flags
- FOMO search instruction

Onboard does not post contract addresses in public replies.

## Core Flow

1. A user tags `@askonboard` under an X post.
2. Onboard reads the mention, parent tweet, and quoted tweet when available.
3. Onboard extracts tickers, contract addresses, and relevant phrases.
4. Onboard finds matching coins through live market indexing.
5. Onboard ranks matches by relevance, volume, freshness, and ticker/name confidence.
6. Onboard checks token social context when available.
7. Onboard replies with one clean scan.

## Context Engine

The context line is the key feature.

Onboard should summarize the actual reason a coin exists, not just label it with a generic category.

Example:

```text
Context: viral SplashDog TikTok dog meme with creator onboarded
```

Example:

```text
Context: GMGN mascot coin after GMGN flipped PumpFun and Hyperliquid in 24h revenue
```

Context sources:

- parent tweet text
- quoted tweet text
- token name and symbol
- token social links
- linked X post from token socials

## Market Matching

Onboard supports:

- direct Solana contract lookup
- ticker search
- phrase/name search
- duplicate pair cleanup
- best-pair selection by activity

Ranking priorities:

1. Direct contract match
2. Exact ticker match
3. Token name match
4. Solana match
5. 24h volume
6. Fresh activity

## Reply Shape

```text
@user onboard scan:

Best match: $ONBOARD
Context: X-native coin context bot for fast FOMO scans
MC $42K | vol24 $31K | buys/sells 120/98
Age: 2h | confidence: high
Risk flags: fresh launch, heavy pullback

FOMO: search $ONBOARD
```

## Public Rules

- Say FOMO, not backend provider names.
- Do not post contract addresses.
- Do not post shortened contract addresses.
- Keep replies compact.
- Keep the context line simple.
- Make the scan useful without making users decode crypto slang.

## Speed Design

Onboard is optimized for quick replies.

Implemented speed choices:

- parallel market lookups
- hard timeout on market calls
- short timeout on optional language polish
- deterministic fallback reply
- short local cache for repeated lookups
- no slow research chain before posting

Default timing:

- market timeout: about 1.4 seconds
- language polish timeout: about 1.8 seconds
- cache TTL: about 90 seconds

## Current Implementation

Main files:

- `scripts/onboard-bot.mjs`: X mention listener, market matching, context engine, reply writer
- `src/App.tsx`: landing page and docs route
- `src/index.css`: site styling
- `docs/ONBOARD_TECH_PAPER.md`: this public technical paper

## Deployment

Dry run:

```bash
npm run bot:dry-run
```

Live loop:

```bash
npm run bot:loop
```

Recommended env:

```env
BOT_HANDLE=askonboard
POLL_MS=15000
MARKET_TIMEOUT_MS=1400
LLM_TIMEOUT_MS=1800
CACHE_TTL_MS=90000
FOMO_URL=https://fomo.family
```

## North Star

Onboard should feel like the fastest way to ask:

```text
what is this coin and why does it exist?
```
