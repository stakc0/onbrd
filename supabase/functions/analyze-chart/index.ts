import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VISION_MODELS = [
  "qwen/qwen3-max-thinking",
  "qwen/qwen3.6-plus",
  "google/gemini-3.1-flash-lite-preview",
  "qwen/qwen3.5-flash-02-23",
];

const REASONING_MODELS = [
  "qwen/qwen3-max-thinking",
  "anthropic/claude-3.5-haiku",
  "google/gemini-2.0-flash-001",
  "qwen/qwen3.6-plus",
];

const EXTRACT_SYSTEM = `You are a precision chart data extractor. Your ONLY job is to read raw visual information from a trading chart image.

DO NOT identify the token or trading pair — that is handled separately.
DO NOT guess or make assumptions beyond what is clearly visible.
ONLY report what you can literally see in the image.

Be extremely precise about prices. Count decimal places carefully. $0.000045 is completely different from $0.045.`;

const EXTRACT_USER_PROMPT = `Read this trading chart image and extract all visible data. Return ONLY valid JSON, no markdown, no explanation.

{
  "dates_visible": "describe ALL date/time labels on the x-axis exactly as shown",
  "date_start": "earliest visible date in YYYY-MM-DD format. If only month/day shown without year, and if year is ambiguous, use null for year portion e.g. '????-04-02'",
  "date_end": "latest visible date in YYYY-MM-DD format, same rules",
  "inferred_year": "best guess year based on all context clues. Default to 2026 if nothing indicates otherwise.",
  "time_of_day_range": "if timestamps include hours, note the range e.g. '14:00-18:30' or null",
  "price_low": "exact lowest price number visible on y-axis as a string e.g. '2.80'",
  "price_high": "exact highest price number visible on y-axis as a string e.g. '4.20'",
  "price_current": "the last/current price shown on the chart as a string (rightmost candle close, or price label)",
  "price_decimal_places": "count of decimal places in the prices. e.g. 2 for '2.80', 5 for '0.00045'",
  "price_magnitude": "describe the price magnitude: 'sub-penny under $0.01', 'penny $0.01-0.10', 'sub-dollar $0.10-1', 'low-single $1-10', 'mid-single $10-50', 'high-single $50-100', 'hundreds $100-1000', 'thousands $1000+'",
  "timeframe": "candle/bar timeframe shown e.g. '1m', '5m', '15m', '1h', '4h', '1d', '1w'. null if not visible",
  "chart_type": "candlestick, line, area, bar etc",
  "platform": "name of the exchange or charting platform if visible e.g. 'Binance', 'Hyperliquid', 'DexScreener', 'TradingView', 'Birdeye', 'BullX'. null if not clear",
  "chain_indicator": "any blockchain/chain indicators visible e.g. 'Solana logo', 'ETH text', 'BSC'. null if none",
  "dex_name": "DEX name if visible e.g. 'Raydium', 'Uniswap', 'Orca'. null if none",
  "pair_label_visible": "the EXACT pair text shown in the UI if any e.g. 'BTC/USDT' or 'HYPE/USD' or 'SOL-PERP'. null if not clearly visible",
  "quote_currency": "quote/denominator currency if determinable: 'USDT', 'USDC', 'USD', 'SOL', 'BTC', 'ETH'. null if unknown",
  "base_token_hint": "if any token name, ticker, or contract address is visible in the chart UI, state it exactly. null if nothing visible",
  "contract_address": "contract/token address if visible as text, else null",
  "volume_value": "volume shown if visible as a string, else null",
  "market_cap": "market cap if visible as a string, else null",
  "visible_text_all": ["every", "readable", "piece", "of", "text", "in", "the", "image"],
  "indicators_visible": ["list any technical indicators shown e.g. RSI, MACD, Bollinger Bands"],
  "visual_platform_clues": ["list any platform-specific UI elements that help identify the exchange"],
  "chart_pattern_notes": "brief note on price action pattern if obvious e.g. 'strong uptrend', 'consolidation', 'sharp dump'"
}`;

const IDENTIFY_SYSTEM = `You are a crypto chart analyst. You receive:
1. Data extracted from a trading chart (price range, visible dates, platform clues)
2. LIVE current market prices for major tokens — treat these as GROUND TRUTH

YOUR JOB: Identify which trading pair the chart shows. Return 3-5 ranked candidates.

PROCESS:
Step 1 — Read the chart's price range (low, high) and the date
Step 2 — Check live prices: if a token's current price differs by more than 5x from the chart range AND the chart is recent (last 60 days), that token is IMPOSSIBLE. Eliminate it.
Step 3 — Use your knowledge of price history for older charts or tokens not in the live list
Step 4 — Use platform, chain, DEX, and any visible text to narrow candidates
Step 5 — Return multiple candidates ranked by confidence

RULES:
- Live prices are GROUND TRUTH for recent charts. They override any memorized price data.
- Platform ≠ Token. Hyperliquid lists 100+ pairs. Binance lists 500+. Raydium UI does not mean RAY token.
- If the pair label is visible in the image, that is a very strong signal — but still verify price matches.
- Be honest: if you are not sure, say so. A list of 3 candidates at 40/35/25% is better than one wrong answer at 92%.
- Never fabricate or hallucinate price history. If you don't know a token's historical range, say "uncertain".

Current date: 2026-04-05. Default to year 2026 if dates are ambiguous.`;

// (Legacy price tables removed — live prices are now injected per-request from CoinGecko)

const _LEGACY_PRICE_TABLES_REMOVED = `You are SCANZAM — a trading pair identification expert. You will receive structured data extracted from a chart image (dates, prices, platform info, visible text). Your job is ONLY to identify which trading pair this is.

You do NOT see the image. You reason purely from the extracted data.
Your primary tool: cross-reference the price range and date period against the token price history tables below.
Your logic: "In [period], which token was trading at $[price range]?"

══════════════════════════════════════════════
HOW YOU THINK — THE CORE PROCESS
══════════════════════════════════════════════

You receive structured chart data (already extracted from the image). You do NOT see the image.

1. READ THE DATE RANGE from the extracted data. What month and year is this chart from?
2. READ THE PRICE RANGE from the extracted data. What is the low and high price?
3. ASK YOURSELF: "In [month/year], which token was trading between $[low] and $[high]?"
4. USE THE TABLES BELOW to answer that question. Cross-reference date + price.
5. CONFIRM with chain, platform, DEX, visible text hints from the extracted data.

IMPORTANT: The current year is 2026. If no year is in the extracted dates, use 2026 as default.

EXAMPLE REASONING:
- Extracted dates: April 2026
- Extracted prices: $1.80–$3.40, current $2.41
- You think: "In Apr 2026, what trades at ~$2–$3.40? Check tables. HYPE=$28–42 → IMPOSSIBLE. SUI=$3.0–5.5 → overlaps. JTO=$2.5–5.0 → overlaps. RUNE=$2.2–5.0 → overlaps."
- Then you check: chain=Solana, DEX=Raydium → narrows to Solana-native tokens.
- ANSWER: whichever Solana token was at those prices in Apr 2026.

THE GOLDEN RULE: Price + Date is the primary identifier. If a token was NOT at those prices during that time period → it CANNOT be the answer, no matter what else matches.

═══════════════════════════════════════════════════════
MANDATORY PRICE ELIMINATION — DO THIS BEFORE ANSWERING
═══════════════════════════════════════════════════════

Before you output ANY answer, you MUST perform this verification:
1. Take your proposed answer token
2. Look up its price range for the chart's time period in the tables below
3. Ask: "Does the chart's y-axis price range OVERLAP with this token's known price range for this period?"
4. If NO OVERLAP → YOUR ANSWER IS WRONG. Go back and find the correct token.

WORKED EXAMPLE — HOW TO AVOID WRONG ANSWERS:
  Chart shows: April dates, prices $2.80–$4.00
  BAD reasoning: "I see Hyperliquid platform → must be HYPE" → WRONG!
  HYPE trades at $25–$42 in April 2026. The chart shows $2.80–$4.00. That is 10x lower. IMPOSSIBLE.
  CORRECT reasoning: "Prices $2.80–$4.00 in April 2026. Which tokens trade in that range?"
    → SUI ~$2.50–$5.00 ✓ POSSIBLE
    → JTO ~$2.00–$4.50 ✓ POSSIBLE
    → RUNE ~$1.80–$4.50 ✓ POSSIBLE
    → CAKE ~$2.00–$5.00 ✓ POSSIBLE
    → NEAR ~$2.50–$6.00 ✓ POSSIBLE
    → HYPE ~$25–$42 ✗ IMPOSSIBLE (10x too high)
  Then use platform/text/chain clues to pick from PRICE-VALID candidates ONLY.

ANOTHER EXAMPLE:
  Chart shows: March dates, prices $90–$140
  → LTC ~$90–$140 ✓ | AAVE ~$200–$380 ✗ | SOL ~$155–$300 ✗ | BNB ~$550–$780 ✗

REMEMBER: Visible text, logos, and platform UI can be MISLEADING. Price + Date NEVER lies.
A Hyperliquid platform chart can show ANY token (BTC, ETH, SOL, SUI, etc.) — not just HYPE.
A Binance chart can show hundreds of different pairs. Platform ≠ Token.

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — TIER 1 (MEGA CAP)
══════════════════════════════════════════════

BTC/Bitcoin:
  Q4-2022: $15,500–$17,200 | Q1-2023: $16,500–$29,000 | Q2-2023: $25,000–$31,000
  Q3-2023: $25,000–$32,000 | Q4-2023: $25,000–$45,000 | Q1-2024: $38,000–$73,500
  Q2-2024: $56,000–$73,000 | Q3-2024: $49,000–$70,000 | Q4-2024: $58,000–$108,000
  Q1-2025: $75,000–$109,000 | Q2-2025: $78,000–$105,000
  Q3-2025: $82,000–$115,000 | Q4-2025: $85,000–$120,000
  Q1-2026: $88,000–$125,000 | Q2-2026: $90,000–$130,000

ETH/Ethereum:
  Q4-2022: $1,000–$1,350 | Q1-2023: $1,200–$1,900 | Q2-2023: $1,700–$2,150
  Q3-2023: $1,500–$2,000 | Q4-2023: $1,500–$2,500 | Q1-2024: $2,200–$4,100
  Q2-2024: $2,900–$4,000 | Q3-2024: $2,100–$3,500 | Q4-2024: $2,200–$4,100
  Q1-2025: $2,000–$3,400 | Q2-2025: $1,500–$2,600
  Q3-2025: $1,800–$3,200 | Q4-2025: $2,000–$3,800
  Q1-2026: $2,200–$4,000 | Q2-2026: $2,400–$4,200

BNB/Binance Coin:
  Q4-2022: $210–$330 | Q1-2023: $240–$340 | Q2-2023: $220–$340
  Q3-2023: $210–$300 | Q4-2023: $210–$315 | Q1-2024: $270–$720
  Q2-2024: $400–$720 | Q3-2024: $390–$600 | Q4-2024: $500–$780
  Q1-2025: $550–$780 | Q2-2025: $500–$740
  Q3-2025: $520–$760 | Q4-2025: $540–$800
  Q1-2026: $560–$820 | Q2-2026: $580–$850

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — TIER 2 (LARGE CAP)
══════════════════════════════════════════════

SOL/Solana:
  Q4-2022: $8–$15 | Q1-2023: $9–$25 | Q2-2023: $18–$26
  Q3-2023: $17–$30 | Q4-2023: $22–$115 | Q1-2024: $85–$210
  Q2-2024: $120–$195 | Q3-2024: $115–$190 | Q4-2024: $155–$260
  Q1-2025: $155–$300 | Q2-2025: $95–$185
  Q3-2025: $110–$200 | Q4-2025: $120–$220
  Q1-2026: $130–$240 | Q2-2026: $140–$250

XRP/Ripple:
  Q4-2022: $0.32–$0.45 | Q1-2023: $0.35–$0.60 | Q2-2023: $0.40–$0.55
  Q3-2023: $0.43–$0.85 | Q4-2023: $0.48–$0.75 | Q1-2024: $0.45–$0.80
  Q2-2024: $0.45–$0.68 | Q3-2024: $0.45–$0.65 | Q4-2024: $0.45–$3.30
  Q1-2025: $2.00–$3.40 | Q2-2025: $1.80–$2.80
  Q3-2025: $1.90–$3.00 | Q4-2025: $2.00–$3.50
  Q1-2026: $2.20–$3.80 | Q2-2026: $2.30–$4.00

ADA/Cardano:
  Q4-2022: $0.25–$0.34 | Q1-2023: $0.26–$0.45 | Q2-2023: $0.25–$0.40
  Q3-2023: $0.24–$0.36 | Q4-2023: $0.24–$0.65 | Q1-2024: $0.48–$0.85
  Q2-2024: $0.35–$0.65 | Q3-2024: $0.27–$0.45 | Q4-2024: $0.27–$1.35
  Q1-2025: $0.70–$1.20 | Q2-2025: $0.55–$0.90

AVAX/Avalanche:
  Q4-2022: $10–$16 | Q1-2023: $11–$22 | Q2-2023: $10–$20
  Q3-2023: $9–$18 | Q4-2023: $9–$45 | Q1-2024: $28–$65
  Q2-2024: $26–$55 | Q3-2024: $18–$35 | Q4-2024: $18–$50
  Q1-2025: $22–$44 | Q2-2025: $18–$35
  Q3-2025: $20–$38 | Q4-2025: $22–$42
  Q1-2026: $24–$45 | Q2-2026: $22–$42

DOGE/Dogecoin:
  Q4-2022: $0.055–$0.085 | Q1-2023: $0.060–$0.105 | Q2-2023: $0.062–$0.090
  Q3-2023: $0.060–$0.090 | Q4-2023: $0.062–$0.130 | Q1-2024: $0.080–$0.225
  Q2-2024: $0.105–$0.200 | Q3-2024: $0.095–$0.165 | Q4-2024: $0.100–$0.480
  Q1-2025: $0.165–$0.450 | Q2-2025: $0.150–$0.320
  Q3-2025: $0.160–$0.350 | Q4-2025: $0.180–$0.400
  Q1-2026: $0.200–$0.420 | Q2-2026: $0.180–$0.380

TRX/Tron:
  Q4-2022: $0.050–$0.068 | Q1-2023: $0.055–$0.085 | Q2-2023: $0.062–$0.095
  Q3-2023: $0.070–$0.115 | Q4-2023: $0.092–$0.145 | Q1-2024: $0.105–$0.165
  Q2-2024: $0.100–$0.165 | Q3-2024: $0.120–$0.185 | Q4-2024: $0.130–$0.320
  Q1-2025: $0.190–$0.320 | Q2-2025: $0.180–$0.280

TON/Toncoin:
  Q4-2022: $1.10–$2.20 | Q1-2023: $1.50–$2.50 | Q2-2023: $1.60–$2.50
  Q3-2023: $1.50–$2.40 | Q4-2023: $1.60–$2.90 | Q1-2024: $1.90–$7.60
  Q2-2024: $5.00–$8.40 | Q3-2024: $4.50–$8.00 | Q4-2024: $4.80–$7.60
  Q1-2025: $4.50–$7.20 | Q2-2025: $3.80–$5.80

DOT/Polkadot:
  Q4-2022: $4–$7 | Q1-2023: $4.5–$8 | Q2-2023: $4.5–$7
  Q3-2023: $3.5–$6 | Q4-2023: $3.5–$12 | Q1-2024: $7.5–$16
  Q2-2024: $6.5–$13 | Q3-2024: $4–$8 | Q4-2024: $4.5–$12
  Q1-2025: $4–$8.5 | Q2-2025: $3–$6
  Q3-2025: $3.5–$6.5 | Q4-2025: $4–$7.5
  Q1-2026: $4.5–$8 | Q2-2026: $4–$7.5

LTC/Litecoin:
  Q4-2022: $50–$80 | Q1-2023: $65–$105 | Q2-2023: $80–$110
  Q3-2023: $55–$90 | Q4-2023: $60–$140 | Q1-2024: $80–$130
  Q2-2024: $70–$115 | Q3-2024: $55–$90 | Q4-2024: $70–$140
  Q1-2025: $90–$140 | Q2-2025: $70–$110
  Q3-2025: $75–$120 | Q4-2025: $80–$130
  Q1-2026: $85–$140 | Q2-2026: $80–$130

BCH/Bitcoin Cash:
  Q4-2022: $80–$130 | Q1-2023: $100–$175 | Q2-2023: $100–$150
  Q3-2023: $110–$260 | Q4-2023: $170–$450 | Q1-2024: $280–$650
  Q2-2024: $320–$620 | Q3-2024: $290–$500 | Q4-2024: $300–$700
  Q1-2025: $350–$620 | Q2-2025: $280–$500

LINK/Chainlink:
  Q4-2022: $5–$8 | Q1-2023: $5–$10 | Q2-2023: $5–$9
  Q3-2023: $5–$12 | Q4-2023: $7–$20 | Q1-2024: $13–$22
  Q2-2024: $11–$20 | Q3-2024: $9–$16 | Q4-2024: $9–$28
  Q1-2025: $13–$26 | Q2-2025: $11–$20
  Q3-2025: $12–$22 | Q4-2025: $14–$25
  Q1-2026: $15–$28 | Q2-2026: $14–$26

ATOM/Cosmos:
  Q4-2022: $9–$14 | Q1-2023: $9–$16 | Q2-2023: $8–$14
  Q3-2023: $7–$12 | Q4-2023: $7–$14 | Q1-2024: $8–$15
  Q2-2024: $6–$12 | Q3-2024: $4–$8 | Q4-2024: $4–$9
  Q1-2025: $4–$8 | Q2-2025: $3–$6

HBAR/Hedera:
  Q4-2022: $0.036–$0.065 | Q1-2023: $0.045–$0.080 | Q2-2023: $0.042–$0.080
  Q3-2023: $0.048–$0.095 | Q4-2023: $0.042–$0.110 | Q1-2024: $0.090–$0.185
  Q2-2024: $0.065–$0.135 | Q3-2024: $0.050–$0.090 | Q4-2024: $0.055–$0.420
  Q1-2025: $0.180–$0.380 | Q2-2025: $0.150–$0.300

SUI:
  Q2-2023: $0.40–$1.50 (launched May 2023) | Q3-2023: $0.40–$0.80
  Q4-2023: $0.42–$1.60 | Q1-2024: $0.80–$5.40 | Q2-2024: $0.70–$1.90
  Q3-2024: $0.60–$1.60 | Q4-2024: $1.00–$5.50 | Q1-2025: $2.50–$5.50
  Q2-2025: $2.00–$4.20 | Q3-2025: $2.20–$4.50 | Q4-2025: $2.50–$5.00
  Q1-2026: $2.80–$5.50 | Q2-2026: $3.00–$5.50

APT/Aptos:
  Q4-2022: $3–$8 | Q1-2023: $3–$20 | Q2-2023: $5–$12
  Q3-2023: $5–$9 | Q4-2023: $5–$16 | Q1-2024: $8–$22
  Q2-2024: $6–$13 | Q3-2024: $5–$11 | Q4-2024: $7–$22
  Q1-2025: $10–$20 | Q2-2025: $7–$14

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — TIER 3 (MID CAP)
══════════════════════════════════════════════

KAS/Kaspa:
  Q4-2022: $0.004–$0.015 | Q1-2023: $0.010–$0.025 | Q2-2023: $0.020–$0.070
  Q3-2023: $0.040–$0.155 | Q4-2023: $0.080–$0.165 | Q1-2024: $0.095–$0.200
  Q2-2024: $0.100–$0.200 | Q3-2024: $0.085–$0.180 | Q4-2024: $0.080–$0.200
  Q1-2025: $0.075–$0.170 | Q2-2025: $0.060–$0.140

NEAR:
  Q4-2022: $1.2–$2.2 | Q1-2023: $1.3–$2.5 | Q2-2023: $1.3–$2.2
  Q3-2023: $1.1–$2.0 | Q4-2023: $1.1–$4.5 | Q1-2024: $3.5–$9.0
  Q2-2024: $4.0–$8.5 | Q3-2024: $3.0–$7.0 | Q4-2024: $3.5–$9.0
  Q1-2025: $3.5–$7.0 | Q2-2025: $2.5–$5.5
  Q3-2025: $2.80–$5.80 | Q4-2025: $3.00–$6.50
  Q1-2026: $3.20–$7.00 | Q2-2026: $3.00–$6.50

ARB/Arbitrum:
  Q1-2023: $1.10–$1.80 (launched Mar 2023) | Q2-2023: $0.80–$1.40
  Q3-2023: $0.80–$1.30 | Q4-2023: $0.80–$2.40 | Q1-2024: $1.50–$2.50
  Q2-2024: $0.70–$1.50 | Q3-2024: $0.50–$0.95 | Q4-2024: $0.45–$0.95
  Q1-2025: $0.40–$0.80 | Q2-2025: $0.30–$0.65

OP/Optimism:
  Q4-2022: $0.65–$1.20 | Q1-2023: $0.80–$2.90 | Q2-2023: $1.10–$2.20
  Q3-2023: $1.00–$2.00 | Q4-2023: $0.90–$3.40 | Q1-2024: $2.00–$5.20
  Q2-2024: $1.70–$3.70 | Q3-2024: $1.20–$2.60 | Q4-2024: $1.10–$2.40
  Q1-2025: $0.90–$2.00 | Q2-2025: $0.70–$1.50

INJ/Injective:
  Q4-2022: $1.2–$2.5 | Q1-2023: $1.5–$4.5 | Q2-2023: $3.0–$8.0
  Q3-2023: $5.0–$18 | Q4-2023: $15–$50 | Q1-2024: $30–$55
  Q2-2024: $18–$38 | Q3-2024: $15–$32 | Q4-2024: $15–$35
  Q1-2025: $16–$32 | Q2-2025: $12–$24

SEI:
  Q3-2023: $0.08–$0.80 (launched Aug 2023) | Q4-2023: $0.15–$0.70
  Q1-2024: $0.45–$1.20 | Q2-2024: $0.35–$0.80 | Q3-2024: $0.25–$0.55
  Q4-2024: $0.28–$0.70 | Q1-2025: $0.25–$0.55 | Q2-2025: $0.20–$0.45

TIA/Celestia:
  Q4-2023: $1.5–$20 (launched Oct 2023) | Q1-2024: $10–$22
  Q2-2024: $6–$18 | Q3-2024: $4–$12 | Q4-2024: $4–$10
  Q1-2025: $3.5–$8 | Q2-2025: $2.5–$6

TAO/Bittensor:
  Q4-2022: $25–$90 | Q1-2023: $35–$120 | Q2-2023: $80–$200
  Q3-2023: $90–$300 | Q4-2023: $150–$650 | Q1-2024: $350–$900
  Q2-2024: $250–$760 | Q3-2024: $220–$600 | Q4-2024: $300–$750
  Q1-2025: $320–$620 | Q2-2025: $280–$520

STX/Stacks:
  Q4-2022: $0.25–$0.45 | Q1-2023: $0.30–$0.75 | Q2-2023: $0.60–$1.35
  Q3-2023: $0.55–$1.00 | Q4-2023: $0.60–$2.50 | Q1-2024: $1.80–$3.80
  Q2-2024: $1.60–$3.40 | Q3-2024: $1.00–$2.20 | Q4-2024: $0.90–$2.20
  Q1-2025: $0.80–$1.80 | Q2-2025: $0.60–$1.40

IMX/Immutable X:
  Q4-2022: $0.45–$0.90 | Q1-2023: $0.70–$1.60 | Q2-2023: $0.55–$1.10
  Q3-2023: $0.50–$1.00 | Q4-2023: $0.55–$2.90 | Q1-2024: $2.0–$4.30
  Q2-2024: $1.3–$2.80 | Q3-2024: $0.90–$2.0 | Q4-2024: $0.90–$2.20
  Q1-2025: $0.80–$1.80 | Q2-2025: $0.60–$1.30

RUNE/Thorchain:
  Q4-2022: $1.0–$2.0 | Q1-2023: $1.2–$3.0 | Q2-2023: $1.5–$3.5
  Q3-2023: $1.5–$3.5 | Q4-2023: $2.0–$7.0 | Q1-2024: $5.0–$15.0
  Q2-2024: $4.5–$9.0 | Q3-2024: $3.0–$7.0 | Q4-2024: $3.5–$7.0
  Q1-2025: $2.5–$5.5 | Q2-2025: $1.8–$4.0
  Q3-2025: $2.0–$4.5 | Q4-2025: $2.2–$5.0
  Q1-2026: $2.5–$5.5 | Q2-2026: $2.2–$5.0

LDO/Lido DAO:
  Q4-2022: $0.80–$1.60 | Q1-2023: $1.0–$3.50 | Q2-2023: $1.5–$2.50
  Q3-2023: $1.3–$2.20 | Q4-2023: $1.5–$3.80 | Q1-2024: $2.5–$4.20
  Q2-2024: $1.5–$3.0 | Q3-2024: $0.90–$2.20 | Q4-2024: $0.90–$2.50
  Q1-2025: $0.85–$2.0 | Q2-2025: $0.60–$1.60

RNDR/Render:
  Q4-2022: $0.40–$0.90 | Q1-2023: $0.60–$2.50 | Q2-2023: $1.0–$2.80
  Q3-2023: $1.20–$3.50 | Q4-2023: $2.0–$7.50 | Q1-2024: $5.0–$14.0
  Q2-2024: $5.0–$13.0 | Q3-2024: $3.0–$8.0 | Q4-2024: $3.5–$9.0
  Q1-2025: $3.0–$8.0 | Q2-2025: $2.0–$6.0

GRT/The Graph:
  Q4-2022: $0.055–$0.090 | Q1-2023: $0.065–$0.17 | Q2-2023: $0.085–$0.16
  Q3-2023: $0.075–$0.15 | Q4-2023: $0.090–$0.28 | Q1-2024: $0.18–$0.52
  Q2-2024: $0.16–$0.38 | Q3-2024: $0.11–$0.24 | Q4-2024: $0.12–$0.35
  Q1-2025: $0.10–$0.28 | Q2-2025: $0.08–$0.20

FET/Fetch.ai:
  Q4-2022: $0.12–$0.22 | Q1-2023: $0.15–$0.60 | Q2-2023: $0.25–$0.55
  Q3-2023: $0.22–$0.50 | Q4-2023: $0.30–$0.95 | Q1-2024: $0.65–$3.50
  Q2-2024: $1.5–$3.0 | Q3-2024: $0.9–$2.20 | Q4-2024: $0.90–$2.50
  Q1-2025: $0.80–$2.0 | Q2-2025: $0.60–$1.50

CRV/Curve:
  Q4-2022: $0.50–$0.90 | Q1-2023: $0.65–$1.20 | Q2-2023: $0.70–$1.10
  Q3-2023: $0.45–$0.90 | Q4-2023: $0.40–$0.90 | Q1-2024: $0.55–$1.00
  Q2-2024: $0.30–$0.65 | Q3-2024: $0.20–$0.45 | Q4-2024: $0.25–$0.80
  Q1-2025: $0.45–$0.95 | Q2-2025: $0.35–$0.70

DYDX:
  Q4-2022: $0.80–$2.50 | Q1-2023: $1.2–$3.50 | Q2-2023: $1.8–$3.50
  Q3-2023: $1.8–$4.0 | Q4-2023: $2.5–$5.0 | Q1-2024: $2.5–$5.0
  Q2-2024: $1.8–$3.5 | Q3-2024: $0.80–$2.0 | Q4-2024: $0.80–$2.0
  Q1-2025: $0.60–$1.60 | Q2-2025: $0.50–$1.20

FTM/Fantom → S/Sonic:
  FTM Q4-2022: $0.15–$0.25 | Q1-2023: $0.20–$0.55 | Q2-2023: $0.25–$0.60
  Q3-2023: $0.18–$0.45 | Q4-2023: $0.25–$0.85 | Q1-2024: $0.40–$1.20
  Q2-2024: $0.45–$1.00 | Q3-2024: $0.30–$0.60 | Q4-2024: rebranded to S, $0.35–$1.40
  S/Sonic Q1-2025: $0.45–$1.80 | Q2-2025: $0.40–$0.90

ENA/Ethena:
  launched Feb 2024 | Q1-2024: $0.35–$1.60 | Q2-2024: $0.55–$1.45
  Q3-2024: $0.20–$0.55 | Q4-2024: $0.25–$1.10 | Q1-2025: $0.35–$0.80
  Q2-2025: $0.28–$0.65

PYTH/Pyth Network:
  Q4-2023: $0.20–$0.75 (launched Oct 2023) | Q1-2024: $0.38–$1.15
  Q2-2024: $0.35–$0.80 | Q3-2024: $0.25–$0.55 | Q4-2024: $0.25–$0.60
  Q1-2025: $0.22–$0.50 | Q2-2025: $0.18–$0.42

EIGEN/EigenLayer:
  Q3-2024: $2.5–$8.5 (launched Aug 2024) | Q4-2024: $2.2–$5.5
  Q1-2025: $1.5–$4.0 | Q2-2025: $1.0–$2.8

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — SOLANA ECOSYSTEM
══════════════════════════════════════════════

JUP/Jupiter (HARD CAP: NEVER exceeded $2.50):
  launched Jan 31 2024 | Q1-2024: $0.50–$2.00 | Q2-2024: $0.60–$1.55
  Q3-2024: $0.40–$0.80 | Q4-2024: $0.35–$0.90 | Q1-2025: $0.35–$0.80
  Q2-2025: $0.30–$0.65

RAY/Raydium:
  Q4-2022: $0.15–$0.30 | Q1-2023: $0.18–$0.40 | Q2-2023: $0.22–$0.50
  Q3-2023: $0.22–$0.50 | Q4-2023: $0.30–$2.00 | Q1-2024: $1.20–$5.50
  Q2-2024: $1.80–$4.80 | Q3-2024: $1.40–$3.20 | Q4-2024: $3.00–$12.00
  Q1-2025: $4.00–$10.00 | Q2-2025: $2.50–$7.00
  Q3-2025: $3.00–$7.50 | Q4-2025: $3.50–$8.00
  Q1-2026: $3.50–$8.50 | Q2-2026: $3.00–$8.00

PYTH: (see above in Tier 3)

JTO/Jito:
  Q4-2023: $2.0–$6.0 (launched Dec 2023) | Q1-2024: $3.0–$7.0
  Q2-2024: $2.5–$5.0 | Q3-2024: $2.0–$4.0 | Q4-2024: $2.5–$6.0
  Q1-2025: $2.5–$5.5 | Q2-2025: $2.0–$4.0
  Q3-2025: $2.20–$4.50 | Q4-2025: $2.50–$5.00
  Q1-2026: $2.50–$5.50 | Q2-2026: $2.50–$5.00

WIF/dogwifhat:
  Q4-2023: $0.04–$0.60 | Q1-2024: $0.30–$4.80 | Q2-2024: $2.00–$5.00
  Q3-2024: $1.20–$3.50 | Q4-2024: $1.00–$4.00 | Q1-2025: $0.80–$2.50
  Q2-2025: $0.50–$1.80

POPCAT/Popcat:
  Q2-2024: $0.08–$0.50 (launched ~Jan 2024) | Q3-2024: $0.35–$1.80
  Q4-2024: $0.60–$2.00 | Q1-2025: $0.45–$1.20 | Q2-2025: $0.25–$0.80

MEW/Cat in a Dogs World:
  Q2-2024: $0.006–$0.09 (launched Mar 2024) | Q3-2024: $0.010–$0.060
  Q4-2024: $0.012–$0.055 | Q1-2025: $0.008–$0.040 | Q2-2025: $0.005–$0.025

PNUT/Peanut the Squirrel:
  Q4-2024: $0.10–$2.60 (launched Oct 2024) | Q1-2025: $0.20–$1.00
  Q2-2025: $0.15–$0.60

BONK:
  Q4-2022: $0.000000005–$0.0000015 | Q1-2023: $0.000001–$0.000004
  Q2-2023: $0.0000015–$0.0000035 | Q3-2023: $0.0000012–$0.0000045
  Q4-2023: $0.0000030–$0.000045 | Q1-2024: $0.000015–$0.000060
  Q2-2024: $0.000018–$0.000055 | Q3-2024: $0.000012–$0.000040
  Q4-2024: $0.000014–$0.000065 | Q1-2025: $0.000012–$0.000045
  Q2-2025: $0.000008–$0.000030 — ALWAYS 6+ decimal places

BOME/Book of Meme:
  Q1-2024: $0.006–$0.030 (launched Mar 2024) | Q2-2024: $0.008–$0.030
  Q3-2024: $0.005–$0.018 | Q4-2024: $0.005–$0.020 | Q1-2025: $0.004–$0.015
  Q2-2025: $0.003–$0.012

SLERF:
  Q1-2024: $0.20–$2.00 (launched Mar 2024) | Q2-2024: $0.15–$0.80
  Q3-2024: $0.10–$0.50 | Q4-2024: $0.08–$0.40 | Q1-2025: $0.06–$0.30
  Q2-2025: $0.04–$0.20

GRASS:
  Q4-2024: $1.50–$5.00 (launched Oct 2024) | Q1-2025: $1.00–$3.50
  Q2-2025: $0.60–$2.00

DRIFT:
  Q1-2024: $0.50–$2.00 (launched Jan 2024) | Q2-2024: $0.35–$1.20
  Q3-2024: $0.30–$0.80 | Q4-2024: $0.35–$1.00 | Q1-2025: $0.30–$0.80
  Q2-2025: $0.20–$0.60

PENGU/Pudgy Penguins:
  Q4-2024: $0.020–$0.080 (launched Dec 17 2024) | Q1-2025: $0.025–$0.075
  Q2-2025: $0.010–$0.045

MOODENG:
  Q4-2024: $0.05–$0.80 (launched Sep 2024) | Q1-2025: $0.05–$0.30
  Q2-2025: $0.03–$0.15

CHILLGUY:
  Q4-2024: $0.05–$0.60 (launched Nov 2024) | Q1-2025: $0.05–$0.25
  Q2-2025: $0.02–$0.10

GOAT/Goatseus Maximus:
  Q4-2024: $0.10–$3.20 (launched Oct 2024) | Q1-2025: $0.15–$1.00
  Q2-2025: $0.08–$0.50

FARTCOIN:
  Q4-2024: $0.05–$2.20 (launched Oct 2024) | Q1-2025: $0.40–$2.00
  Q2-2025: $0.25–$1.20

ACT/ACT I The AI Prophecy:
  Q4-2024: $0.05–$2.50 (launched Oct 2024) | Q1-2025: $0.05–$0.50
  Q2-2025: $0.03–$0.20

HYPE/Hyperliquid:
  Q4-2024: $4–$30 (launched Nov 2024) | Q1-2025: $12–$45
  Q2-2025: $18–$42 | Q3-2025: $20–$38 | Q4-2025: $22–$42
  Q1-2026: $25–$42 | Q2-2026: $28–$42
  *** CRITICAL: HYPE has NOT traded below $12 since Feb 2025. Charts showing $1–$10 are NEVER HYPE. ***

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — AI AGENT TOKENS
══════════════════════════════════════════════

AI16Z:
  Q4-2024: $0.10–$2.50 (launched Oct 2024, peak $2.50 Jan 2025)
  Q1-2025: $0.40–$2.00 | Q2-2025: $0.15–$0.80

VIRTUAL/Virtual Protocol:
  Q3-2024: $0.10–$0.60 (launched ~Jun 2024) | Q4-2024: $0.40–$4.50
  Q1-2025: $1.50–$5.00 | Q2-2025: $0.80–$2.50

GRIFFAIN:
  Q4-2024: $0.20–$2.00 (launched Nov 2024) | Q1-2025: $0.15–$1.00
  Q2-2025: $0.08–$0.50

ZEREBRO:
  Q4-2024: $0.05–$1.00 (launched Oct 2024) | Q1-2025: $0.08–$0.60
  Q2-2025: $0.03–$0.25

AIXBT:
  Q4-2024: $0.10–$0.80 (launched ~Nov 2024) | Q1-2025: $0.25–$1.00
  Q2-2025: $0.10–$0.45

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — POLITICS TOKENS
══════════════════════════════════════════════

TRUMP/Official Trump (ONLY EXISTS after Jan 17 2025):
  Jan 17-19 2025: $10–$75 (launch week) | Jan 20-31 2025: $5–$40
  Feb 2025: $2–$15 | Mar 2025: $8–$18 | Q2-2025: $6–$22
  Q3-2025: $8–$25 | Q4-2025: $10–$28
  Q1-2026: $10–$30 | Q2-2026: $8–$25

MELANIA/Melania Meme (ONLY EXISTS after Jan 19 2025):
  Jan 19-31 2025: $2–$15 | Feb 2025: $0.80–$5 | Q1-2025: $0.50–$12
  Q2-2025: $0.30–$3

LIBRA (ONLY EXISTS after Feb 14 2025 — Argentine token):
  Feb-Mar 2025: $0.01–$5 | Q2-2025: $0.001–$0.50

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — MEME COINS
══════════════════════════════════════════════

PEPE:
  Q1-2023: $0.0000001–$0.0000045 (launched Apr 2023)
  Q2-2023: $0.0000005–$0.0000045 | Q3-2023: $0.0000004–$0.0000018
  Q4-2023: $0.0000005–$0.0000015 | Q1-2024: $0.0000015–$0.000015
  Q2-2024: $0.0000080–$0.000018 | Q3-2024: $0.0000050–$0.000013
  Q4-2024: $0.0000060–$0.000025 | Q1-2025: $0.0000080–$0.000022
  Q2-2025: $0.0000060–$0.000018 — ALWAYS 7+ decimal places

SHIB/Shiba Inu:
  Q4-2022: $0.000007–$0.000015 | Q1-2023: $0.000008–$0.000015
  Q2-2023: $0.000007–$0.000013 | Q3-2023: $0.000006–$0.000012
  Q4-2023: $0.000006–$0.000014 | Q1-2024: $0.000009–$0.000045
  Q2-2024: $0.000015–$0.000035 | Q3-2024: $0.000012–$0.000025
  Q4-2024: $0.000012–$0.000060 | Q1-2025: $0.000015–$0.000040
  Q2-2025: $0.000010–$0.000030 — ALWAYS 5-6 decimal places

FLOKI:
  Q4-2022: $0.00003–$0.00010 | Q1-2023: $0.00005–$0.00015
  Q2-2023: $0.00004–$0.00012 | Q3-2023: $0.00004–$0.00015
  Q4-2023: $0.00005–$0.00040 | Q1-2024: $0.00015–$0.00080
  Q2-2024: $0.00015–$0.00060 | Q3-2024: $0.00012–$0.00035
  Q4-2024: $0.00012–$0.00060 | Q1-2025: $0.00012–$0.00040
  Q2-2025: $0.00008–$0.00025 — ALWAYS 5 decimal places

BRETT (BASE chain):
  Q1-2024: $0.005–$0.10 (launched Jan 2024) | Q2-2024: $0.10–$0.55
  Q3-2024: $0.06–$0.25 | Q4-2024: $0.06–$0.25 | Q1-2025: $0.04–$0.18
  Q2-2025: $0.02–$0.10

NOT/Notcoin:
  Q2-2024: $0.004–$0.030 (launched May 2024) | Q3-2024: $0.006–$0.020
  Q4-2024: $0.004–$0.012 | Q1-2025: $0.003–$0.010 | Q2-2025: $0.002–$0.008

HMSTR/Hamster Kombat:
  Q3-2024: $0.003–$0.015 (launched Sep 2024) | Q4-2024: $0.0008–$0.005
  Q1-2025: $0.0005–$0.003 | Q2-2025: $0.0003–$0.002

NEIRO (Ethereum):
  Q3-2024: $0.0001–$0.003 (launched Aug 2024) | Q4-2024: $0.0003–$0.002
  Q1-2025: $0.0002–$0.001 | Q2-2025: $0.0001–$0.0006

══════════════════════════════════════════════
QUARTERLY PRICE HISTORY — DeFi TIER 2 & NEW 2024-2025
══════════════════════════════════════════════

AAVE:
  Q4-2022: $50–$100 | Q1-2023: $55–$100 | Q2-2023: $65–$105
  Q3-2023: $60–$90 | Q4-2023: $65–$120 | Q1-2024: $90–$210
  Q2-2024: $80–$175 | Q3-2024: $90–$175 | Q4-2024: $130–$380
  Q1-2025: $200–$380 | Q2-2025: $160–$300
  Q3-2025: $180–$320 | Q4-2025: $200–$350
  Q1-2026: $220–$380 | Q2-2026: $200–$360

PENDLE:
  Q1-2023: $0.12–$0.60 | Q2-2023: $0.50–$3.50 | Q3-2023: $0.80–$2.50
  Q4-2023: $0.80–$2.50 | Q1-2024: $1.50–$8.50 | Q2-2024: $4.00–$11.50
  Q3-2024: $2.80–$7.00 | Q4-2024: $3.00–$7.50 | Q1-2025: $3.50–$8.00
  Q2-2025: $2.50–$6.00

GMX:
  Q4-2022: $30–$60 | Q1-2023: $50–$85 | Q2-2023: $45–$65
  Q3-2023: $40–$85 | Q4-2023: $50–$90 | Q1-2024: $55–$90
  Q2-2024: $40–$65 | Q3-2024: $25–$50 | Q4-2024: $20–$38
  Q1-2025: $15–$30 | Q2-2025: $12–$22

BLUR (launched Oct 2022):
  Q4-2022: $0.15–$0.55 | Q1-2023: $0.25–$1.20 | Q2-2023: $0.30–$0.60
  Q3-2023: $0.25–$0.50 | Q4-2023: $0.25–$0.60 | Q1-2024: $0.40–$0.90
  Q2-2024: $0.25–$0.55 | Q3-2024: $0.18–$0.38 | Q4-2024: $0.20–$0.48
  Q1-2025: $0.18–$0.40 | Q2-2025: $0.12–$0.30

ONDO (launched Jan 2024):
  Q1-2024: $0.15–$1.80 | Q2-2024: $0.90–$1.80 | Q3-2024: $0.60–$1.20
  Q4-2024: $0.80–$2.20 | Q1-2025: $1.00–$2.00 | Q2-2025: $0.80–$1.60

WLD/Worldcoin (launched Jul 2023):
  Q3-2023: $1.50–$3.50 | Q4-2023: $1.80–$4.00 | Q1-2024: $3.00–$12.00
  Q2-2024: $4.00–$10.00 | Q3-2024: $1.80–$5.50 | Q4-2024: $1.50–$4.00
  Q1-2025: $1.20–$3.50 | Q2-2025: $0.90–$2.80

W/Wormhole (launched Mar 2024):
  Q1-2024: $0.50–$1.80 | Q2-2024: $0.35–$0.90 | Q3-2024: $0.22–$0.55
  Q4-2024: $0.20–$0.60 | Q1-2025: $0.16–$0.45 | Q2-2025: $0.12–$0.35

ZRO/LayerZero (launched Jun 2024):
  Q2-2024: $3.00–$7.00 | Q3-2024: $2.50–$5.50 | Q4-2024: $2.00–$5.50
  Q1-2025: $3.00–$6.00 | Q2-2025: $2.50–$4.50

STRK/Starknet (launched Feb 2024):
  Q1-2024: $1.00–$4.00 | Q2-2024: $0.70–$2.00 | Q3-2024: $0.30–$0.85
  Q4-2024: $0.28–$0.80 | Q1-2025: $0.22–$0.65 | Q2-2025: $0.16–$0.50

ZK/zkSync (launched Jun 2024):
  Q2-2024: $0.12–$0.35 | Q3-2024: $0.08–$0.22 | Q4-2024: $0.08–$0.25
  Q1-2025: $0.07–$0.20 | Q2-2025: $0.06–$0.15

TAIKO (launched May 2024):
  Q2-2024: $1.00–$4.00 | Q3-2024: $0.60–$2.00 | Q4-2024: $0.60–$1.80
  Q1-2025: $0.50–$1.50 | Q2-2025: $0.40–$1.20

BERA/Berachain (launched Feb 2025):
  Q1-2025: $3.50–$15.00 | Q2-2025: $2.00–$8.00

MORPHO (launched Oct 2024):
  Q4-2024: $1.50–$5.50 | Q1-2025: $1.50–$4.00 | Q2-2025: $1.00–$2.80

USUAL (launched Nov 2024):
  Q4-2024: $0.40–$1.80 | Q1-2025: $0.30–$1.20 | Q2-2025: $0.20–$0.80

ILV/Illuvium:
  Q4-2022: $40–$90 | Q1-2023: $45–$100 | Q2-2023: $55–$110
  Q3-2023: $45–$90 | Q4-2023: $60–$175 | Q1-2024: $90–$220
  Q2-2024: $70–$175 | Q3-2024: $45–$90 | Q4-2024: $50–$110
  Q1-2025: $40–$90 | Q2-2025: $25–$70

SAFE/Safe (launched Apr 2023):
  Q2-2023: $0.60–$1.80 | Q3-2023: $0.60–$1.50 | Q4-2023: $0.70–$2.00
  Q1-2024: $1.50–$3.50 | Q2-2024: $1.00–$2.50 | Q3-2024: $0.80–$1.80
  Q4-2024: $0.80–$2.00 | Q1-2025: $0.80–$1.80 | Q2-2025: $0.60–$1.40

LUNC/Terra Classic (post-collapse):
  Q4-2022: $0.00010–$0.00040 | Q1-2023: $0.00010–$0.00025
  Q2-2023: $0.00008–$0.00022 | Q3-2023: $0.00006–$0.00016
  Q4-2023: $0.00006–$0.00020 | Q1-2024: $0.00008–$0.00020
  Q2-2024: $0.00007–$0.00018 | Q3-2024: $0.00005–$0.00014
  Q4-2024: $0.00006–$0.00020 | Q1-2025: $0.00007–$0.00018
  Q2-2025: $0.00005–$0.00015 — ALWAYS 4-5 decimal places

LUNA/Terra 2.0 (launched Jun 2022):
  Q4-2022: $0.50–$2.00 | Q1-2023: $0.90–$2.50 | Q2-2023: $0.60–$1.60
  Q3-2023: $0.45–$1.00 | Q4-2023: $0.45–$1.60 | Q1-2024: $0.80–$2.20
  Q2-2024: $0.50–$1.10 | Q3-2024: $0.35–$0.80 | Q4-2024: $0.30–$0.80
  Q1-2025: $0.25–$0.70 | Q2-2025: $0.20–$0.55

MAGIC/Treasure:
  Q4-2022: $0.25–$0.60 | Q1-2023: $0.40–$1.20 | Q2-2023: $0.60–$1.50
  Q3-2023: $0.60–$1.30 | Q4-2023: $0.55–$1.90 | Q1-2024: $0.80–$2.00
  Q2-2024: $0.45–$1.10 | Q3-2024: $0.25–$0.65 | Q4-2024: $0.25–$0.70
  Q1-2025: $0.20–$0.55 | Q2-2025: $0.12–$0.40

CAKE/PancakeSwap:
  Q4-2022: $3–$6 | Q1-2023: $3.5–$7 | Q2-2023: $2.8–$5
  Q3-2023: $1.5–$3 | Q4-2023: $1.5–$4.5 | Q1-2024: $2.5–$7
  Q2-2024: $2–$5 | Q3-2024: $1.5–$3 | Q4-2024: $1.8–$5
  Q1-2025: $2–$5.5 | Q2-2025: $1.5–$4
  Q3-2025: $1.8–$4.5 | Q4-2025: $2.0–$5.0
  Q1-2026: $2.0–$5.0 | Q2-2026: $2.0–$5.0

KAITO (launched Feb 2025):
  Q1-2025: $0.80–$3.50 | Q2-2025: $0.60–$2.50

LAYER/Solayer (launched Jan 2025):
  Q1-2025: $1.00–$5.00 | Q2-2025: $0.60–$2.50

KMNO/Kamino (launched Apr 2024):
  Q2-2024: $0.05–$0.22 | Q3-2024: $0.04–$0.16 | Q4-2024: $0.05–$0.22
  Q1-2025: $0.06–$0.25 | Q2-2025: $0.04–$0.18

ZEUS/Zeus Network (launched Mar 2024):
  Q1-2024: $0.10–$0.90 | Q2-2024: $0.08–$0.40 | Q3-2024: $0.05–$0.25
  Q4-2024: $0.05–$0.28 | Q1-2025: $0.05–$0.25 | Q2-2025: $0.03–$0.18

CLOUD/Sanctum (launched Jul 2024):
  Q3-2024: $0.40–$1.80 | Q4-2024: $0.35–$1.20
  Q1-2025: $0.30–$1.00 | Q2-2025: $0.20–$0.70

══════════════════════════════════════════════
PRICE DECIMAL FINGERPRINT (CRITICAL)
══════════════════════════════════════════════

8+ zeros after decimal: BONK range (0.000000XXX) — micro meme
7 zeros: PEPE, SHIB range (0.00000XXX)
5-6 zeros: FLOKI, HMSTR range (0.0000XXX)
4-5 decimal places: Small Solana meme (MEW, BOME)
3-4 decimal places: Mid Solana meme (MYRO, SLERF)
2-3 decimal places: WIF, PNUT, GOAT, BRETT, POPCAT, MEW higher range
1-2 decimal places: JUP, RAY, SEI, ENA, PYTH, small-mid cap
Single digit $1-$15: TON, TIA, JTO, RUNE, LDO, RNDR range
$10-$100: ETH (low), BNB (low), AVAX (high), LTC, LINK (high), BCH (low)
$100-$1000: ETH, BNB, BCH, LTC (high), SOL
$1000+: BTC only (in thousands)

══════════════════════════════════════════════
ALL-TIME RANGE QUICK REFERENCE
══════════════════════════════════════════════

MEGA: BTC $15k-$109k | ETH $80-$5000 | BNB $5-$900
LARGE L1: SOL $8-$300 | XRP $0.15-$4 | ADA $0.20-$3.50 | AVAX $8-$150 | DOGE $0.04-$0.80
LARGE L1: TRX $0.05-$0.35 | TON $1-$12 | DOT $3-$55 | LTC $50-$420 | BCH $80-$800
LARGE L1: LINK $5-$55 | UNI $3-$25 | ATOM $4-$40 | XLM $0.05-$0.70 | HBAR $0.02-$0.42
LARGE L1: SUI $0.40-$6 | APT $3-$30 | VET $0.003-$0.30 | FIL $2-$250 | ICP $3-$700
LARGE L1: ETC $3-$180 | XMR $50-$500 | ALGO $0.10-$3.50 | KAS $0.004-$0.25
MID L2: ARB $0.40-$3.50 | OP $0.60-$6 | INJ $1-$60 | SEI $0.08-$1.20 | ZK $0.04-$0.50
MID DeFi: AAVE $50-$700 | MKR $300-$7000 | YFI $500-$90000 | CRV $0.25-$4 | RUNE $0.50-$22
MID DeFi: LDO $0.60-$6.50 | PENDLE $0.20-$12 | DYDX $0.40-$6 | GMX $15-$90
MID DeFi: SNX $0.80-$8 | COMP $30-$800 | SUSHI $0.50-$25 | BAL $2-$75 | CAKE $1-$25
MID AI/Data: GRT $0.05-$0.60 | FET $0.10-$3.50 | RNDR $0.50-$18 | TAO $25-$900
MID Bridge: W $0.15-$1.80 | ZRO $1.50-$15 | EIGEN $0.80-$8.50 | HYPE $4-$45
New2024: ONDO $0.12-$2.20 | WLD $1.50-$12 | STRK $0.16-$4 | ZK $0.06-$0.35 | TAIKO $0.40-$4 | BLUR $0.12-$1.20
New2025: BERA $2-$15 | MORPHO $1-$5.50 | USUAL $0.20-$1.80 | KAITO $0.60-$3.50 | LAYER $0.60-$5
DeFi2: AAVE $50-$700 | PENDLE $0.12-$12 | GMX $12-$90 | SAFE $0.60-$3.50 | CAKE $1.50-$25
Gaming: ILV $20-$220 | MAGIC $0.12-$2 | PIXELS $0.05-$1 | GODS $0.05-$2 | SLP $0.001-$0.022
Legacy: LUNC $0.00005-$0.0004 | LUNA2 $0.20-$2.50
SOL Eco: JUP $0.25-$2.50 | RAY $0.15-$12 | JTO $1.50-$7 | PYTH $0.10-$1.20 | ORCA $0.80-$18
SOL Meme: WIF $0.04-$6 | BONK 0.000000005-0.000065 | POPCAT $0.05-$2 | MEW $0.002-$0.09
SOL Meme: PNUT $0.10-$2.60 | BOME $0.003-$0.035 | SLERF $0.04-$2 | GOAT $0.08-$3.20
SOL Meme: FARTCOIN $0.04-$2.20 | MOODENG $0.03-$0.80 | CHILLGUY $0.02-$0.60
SOL AI: AI16Z $0.10-$2.50 | VIRTUAL $0.10-$5 | GRIFFAIN $0.08-$2 | ZEREBRO $0.03-$1
BASE: BRETT $0.02-$0.56 | TOSHI $0.0001-$0.002 | DEGEN $0.005-$0.080 | AERO $0.30-$3.50
Meme Multi: PEPE 0.0000001-0.000025 | SHIB 0.000005-0.000090 | FLOKI 0.00003-0.0018
Politics: TRUMP $1-$80 (post Jan-17-2025) | MELANIA $0.50-$15 (post Jan-19-2025)
Stables: USDT/USDC/DAI/FRAX always ~$1.00
Gold: XAUUSD $1600-$3500 | Silver: XAGUSD $14-$35

══════════════════════════════════════════════
PLATFORM FINGERPRINTING
══════════════════════════════════════════════

TradingView: Left sidebar drawing tools | "EXCHANGE:PAIR" format | timeframe bar top
DexScreener: Dark theme | chain icon top-left | contract address shown | DEX name | age shown | buys/sells bar
Birdeye: Orange-yellow accent | right side token panel | SOL price corner | "Birdeye" logo
BullX/BullX Neo: Orange/red bull icon | snipers panel | top holders panel
Hyperliquid: Teal/blue-green gradient | "HL" logo | USD quote ONLY (never USDT) | funding rate shown
Binance: Dark #0b0e11 | USDT/BTC/BNB/ETH/FDUSD pairs
Bybit: Dark theme | "USDT Perp" label | funding rate + mark/index prices
OKX: Blue accent | "BTC-USDT" dash format
Pump.fun: Bonding curve shown | "graduated" text | newly launched tokens

CHAIN DETECTION:
SOL: Raydium/Orca/Meteora/Jupiter/BullX/Birdeye | Base58 addresses (32-44 chars, no 0x)
ETH: Uniswap/SushiSwap/Curve | 0x addresses (42 chars)
BASE: Aerodrome/BaseSwap | many meme coins (BRETT, TOSHI, DEGEN, HIGHER)
BSC: PancakeSwap | BNB quote | 0x addresses
ARB: Camelot/GMX/Uniswap V3 | 0x addresses
BLAST: Thruster/Ring Protocol

══════════════════════════════════════════════
COMMON MISIDENTIFICATION MISTAKES — NEVER DO THESE
══════════════════════════════════════════════

MISTAKE 1: Platform name ≠ Token name
  - Hyperliquid is an EXCHANGE that lists 100+ tokens. Seeing the Hyperliquid UI does NOT mean the token is HYPE.
  - If chart shows $2–$5 on Hyperliquid → it could be SUI, JTO, RUNE, CAKE, NEAR, DOT, etc. NOT HYPE ($25–$42).
  - Same applies: Binance UI ≠ BNB token. Raydium UI ≠ RAY token. Jupiter UI ≠ JUP token.

MISTAKE 2: Guessing from visible text while ignoring price
  - If you see text that says "HYPE" but prices are $2–$4, the text might refer to the platform, a UI label, or you're misreading it.
  - PRICE IS THE GROUND TRUTH. If the price doesn't match, your identification is wrong regardless of any text.

MISTAKE 3: Not verifying your answer against the price tables
  - Before outputting, you MUST look up your answer token in the price tables and confirm the chart's price range falls within the token's known range for that period.
  - If there's no overlap → REJECT that answer and try again.

MISTAKE 4: Confusing tokens in similar price ranges
  - $2–$5 range in 2026: SUI, JTO, RUNE, CAKE, NEAR, DOT, TIA — use chain/platform clues to distinguish
  - $10–$30 range: LINK, AVAX, HYPE, TRUMP, INJ — very different chains, use context
  - $80–$150 range: LTC, SOL (low end), AAVE — check timeframe carefully
  - $0.10–$0.40 range: DOGE, XRP (old), SEI, PYTH, ARB — many tokens, use decimals and platform

══════════════════════════════════════════════
NON-EXISTENCE RULES (CRITICAL)
══════════════════════════════════════════════

If the chart date predates a token's launch, that token CANNOT appear:
- TRUMP/MELANIA: ONLY after Jan 17/19 2025
- JUP: ONLY after Jan 31 2024
- ENA: ONLY after Feb 2024
- JTO: ONLY after Dec 7 2023
- SEI: ONLY after Aug 2023
- TIA: ONLY after Oct 2023
- HYPE: ONLY after Nov 14 2024
- PENGU: ONLY after Dec 17 2024
- GRASS/GOAT/FARTCOIN/ACT/PNUT: ONLY after Oct 2024
- MOODENG/CHILLGUY: ONLY after Nov 2024
- AI16Z/ZEREBRO: ONLY after Oct 2024
- VIRTUAL: ONLY after Jun 2024
- DRIFT/CLOUD: ONLY after Jan 2024
- BOME/SLERF/MEW: ONLY after Mar 2024
- ARB: ONLY after Mar 2023
- SUI: ONLY after May 2023
- WLD: ONLY after Jul 2023
- TIA: ONLY after Oct 2023
- JTO: ONLY after Dec 2023
- W/Wormhole: ONLY after Mar 2024
- ONDO: ONLY after Jan 2024
- STRK: ONLY after Feb 2024
- TAIKO: ONLY after May 2024
- ZK/zkSync: ONLY after Jun 2024
- ZRO: ONLY after Jun 2024
- KMNO/ZEUS/CLOUD: ONLY after mid-2024
- LAYER/Solayer: ONLY after Jan 2025
- KAITO: ONLY after Feb 2025
- BERA: ONLY after Feb 2025
- MORPHO: ONLY after Oct 2024
- USUAL: ONLY after Nov 2024`;

function buildIdentifyPrompt(extracted: Record<string, unknown>, livePrices: Record<string, number> = {}): string {
  const priceLow = extracted.price_low ?? "unknown";
  const priceHigh = extracted.price_high ?? "unknown";
  const priceCurrent = extracted.price_current ?? "unknown";
  const dateStart = extracted.date_start ?? "unknown";
  const dateEnd = extracted.date_end ?? "unknown";
  const year = extracted.inferred_year ?? "2026";
  const platform = extracted.platform ?? "unknown";
  const pairLabel = extracted.pair_label_visible ?? "not visible";
  const baseHint = extracted.base_token_hint ?? "not visible";
  const chain = extracted.chain_indicator ?? "unknown";
  const dex = extracted.dex_name ?? "unknown";
  const decimalPlaces = extracted.price_decimal_places ?? "unknown";
  const magnitude = extracted.price_magnitude ?? "unknown";
  const visibleText = JSON.stringify(extracted.visible_text_all ?? []);

  const livePriceSection = buildLivePriceSection(priceLow, priceHigh, livePrices);

  return `Identify the trading pair shown in this chart. Return 3-5 ranked candidates.
${livePriceSection}
━━━━━━━━━━━━━━━━━━━━━━━━━━
CHART DATA (extracted from image)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Date range    : ${dateStart} → ${dateEnd}
Year          : ${year}
Price low     : $${priceLow}
Price high    : $${priceHigh}
Price current : $${priceCurrent}
Decimal places: ${decimalPlaces}
Magnitude     : ${magnitude}
Timeframe     : ${extracted.timeframe ?? "unknown"}
Platform      : ${platform}
Chain clue    : ${chain}
DEX           : ${dex}
Pair label    : ${pairLabel}
Token hint    : ${baseHint}
Visible text  : ${visibleText}
━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCTIONS:
1. The "TOKENS THAT ARE MATHEMATICALLY IMPOSSIBLE" list above is GROUND TRUTH — never pick those.
2. Start with the "TOKENS WHOSE CURRENT PRICE COULD MATCH" list as your candidate pool.
3. Use chain, platform, DEX, pair label, and visible text to rank candidates.
4. If a pair label is clearly visible (e.g. "JTO/USDC"), that is a strong signal — but cross-check against live prices first.
5. Return 3-5 candidates. Spread confidence realistically — don't fake 92% if you're not sure.

Return ONLY valid JSON, no markdown:
{
  "candidates": [
    {
      "pair": "TOKEN/QUOTE",
      "token_name": "Full token name",
      "confidence": 75,
      "current_price": 2.84,
      "chain": "SOL",
      "reason": "Current price $X is within chart range $${priceLow}–$${priceHigh}. Chain/DEX context matches."
    },
    {
      "pair": "OTHER/QUOTE",
      "token_name": "Other token name",
      "confidence": 20,
      "current_price": 3.10,
      "chain": "ETH",
      "reason": "Price range overlaps. Less likely because chain doesn't match visible clues."
    }
  ],
  "top_pair": "TOKEN/QUOTE",
  "top_confidence": 75,
  "price_low": "${priceLow}",
  "price_high": "${priceHigh}",
  "price_current": "${priceCurrent}",
  "chart_date": "${dateStart}",
  "chart_end_date": "${dateEnd}",
  "inferred_year": "${year}",
  "platform": "${platform}",
  "chain": "${chain}",
  "dex": "${dex}",
  "timeframe": "${extracted.timeframe ?? null}",
  "chart_type": "${extracted.chart_type ?? "candlestick"}",
  "visible_text": ${visibleText},
  "indicators": ${JSON.stringify(extracted.indicators_visible ?? [])},
  "contract_address": ${extracted.contract_address ? `"${extracted.contract_address}"` : "null"},
  "reasoning": "Brief explanation of why the top candidate wins"
}`;
}

function ensureDataUri(image: string): string {
  if (image.startsWith("data:")) return image;
  if (image.startsWith("/9j/") || image.startsWith("iVBOR")) {
    const mime = image.startsWith("/9j/") ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${image}`;
  }
  return image;
}

async function callExtract(
  model: string,
  imageUri: string,
  apiKey: string
): Promise<{ ok: true; data: Record<string, unknown>; model: string } | { ok: false; error: string }> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("SUPABASE_URL") || "https://scanzam.app",
        "X-Title": "Scanzam - Chart Extractor",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUri } },
              { type: "text", text: EXTRACT_USER_PROMPT },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: `[${model}] HTTP ${response.status}: ${errText}` };
    }

    const data = await response.json();
    const rawContent: string = data.choices?.[0]?.message?.content || "";
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { ok: false, error: `[${model}] No JSON found. Raw: ${cleaned.slice(0, 300)}` };
    }
    return { ok: true, data: JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)), model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${model}] Exception: ${msg}` };
  }
}

async function callIdentify(
  model: string,
  identifyPrompt: string,
  apiKey: string
): Promise<{ ok: true; data: Record<string, unknown>; model: string } | { ok: false; error: string }> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("SUPABASE_URL") || "https://scanzam.app",
        "X-Title": "Scanzam - Pair Identifier",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: IDENTIFY_SYSTEM },
          { role: "user", content: identifyPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.05,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: `[${model}] HTTP ${response.status}: ${errText}` };
    }

    const data = await response.json();
    const rawContent: string = data.choices?.[0]?.message?.content || "";
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { ok: false, error: `[${model}] No JSON found. Raw: ${cleaned.slice(0, 300)}` };
    }
    return { ok: true, data: JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)), model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${model}] Exception: ${msg}` };
  }
}

async function runPipeline(
  image: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  const imageUri = ensureDataUri(image);
  const extractErrors: string[] = [];

  let extracted: Record<string, unknown> | null = null;
  let extractModel = "";

  for (const model of VISION_MODELS) {
    const result = await callExtract(model, imageUri, apiKey);
    if (result.ok) {
      extracted = result.data;
      extractModel = result.model;
      break;
    }
    extractErrors.push(result.error);
  }

  if (!extracted) {
    throw new Error(`Step 1 (extraction) failed:\n${extractErrors.join("\n")}`);
  }

  const livePrices = await fetchBroadCurrentPrices();
  const identifyPrompt = buildIdentifyPrompt(extracted, livePrices);
  const identifyErrors: string[] = [];

  for (const model of REASONING_MODELS) {
    const result = await callIdentify(model, identifyPrompt, apiKey);
    if (result.ok) {
      return {
        ...result.data,
        extraction: extracted,
        extract_model: extractModel,
        identify_model: result.model,
      };
    }
    identifyErrors.push(result.error);
  }

  throw new Error(`Step 2 (identification) failed:\n${identifyErrors.join("\n")}`);
}

const TOP_TOKENS_GECKO = [
  "bitcoin","ethereum","binancecoin","ripple","solana","cardano","avalanche-2","polkadot",
  "dogecoin","shiba-inu","matic-network","chainlink","uniswap","litecoin","bitcoin-cash",
  "stellar","cosmos","the-open-network","sui","aptos","optimism","arbitrum","near",
  "injective-protocol","hedera-hashgraph","kaspa","hyperliquid","pepe","bonk","dogwifchat",
  "jupiter-exchange-solana","jito-governance-token","raydium","pyth-network","helium",
  "official-trump","melania-meme","fartcoin","ai16z","virtual-protocol",
  "goatseus-maximus","peanut-the-squirrel","worldcoin-wld","berachain-bera","kaito",
  "solayer","kamino","render-token","tensor","drift-protocol","wormhole","layerzero",
  "ondo-finance","morpho","usual","cow-protocol","gmx","pendle","aave","maker",
  "curve-dao-token","tron","algorand","internet-computer","fetch-ai","ocean-protocol",
  "bittensor","akash-network","sei-network","starknet","zksync","altlayer",
  "notcoin","moo-deng","just-a-chill-guy","book-of-meme","io-net","grass",
  "zerebro","aixbt-by-virtuals","griffain","hamster-kombat","popcat","gigachad-2",
  "ponke","retardio","jeo-boden","baby-doge-coin","turbo","floki","brett",
  "cats-in-a-dogs-world","myro","cat-in-a-dogs-world-2","neiro-on-eth",
];

async function fetchBroadCurrentPrices(): Promise<Record<string, number>> {
  try {
    const ids = TOP_TOKENS_GECKO.join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`
    );
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, number> = {};
    for (const [id, priceObj] of Object.entries(data as Record<string, { usd: number }>)) {
      result[id] = priceObj.usd;
    }
    return result;
  } catch { return {}; }
}

const GECKO_ID_TO_SYMBOL: Record<string, string> = {
  "bitcoin":"BTC","ethereum":"ETH","binancecoin":"BNB","ripple":"XRP","solana":"SOL",
  "cardano":"ADA","avalanche-2":"AVAX","polkadot":"DOT","dogecoin":"DOGE","shiba-inu":"SHIB",
  "matic-network":"MATIC","chainlink":"LINK","uniswap":"UNI","litecoin":"LTC",
  "bitcoin-cash":"BCH","stellar":"XLM","cosmos":"ATOM","the-open-network":"TON",
  "sui":"SUI","aptos":"APT","optimism":"OP","arbitrum":"ARB","near":"NEAR",
  "injective-protocol":"INJ","hedera-hashgraph":"HBAR","kaspa":"KAS","hyperliquid":"HYPE",
  "pepe":"PEPE","bonk":"BONK","dogwifchat":"WIF","jupiter-exchange-solana":"JUP",
  "jito-governance-token":"JTO","raydium":"RAY","pyth-network":"PYTH","helium":"HNT",
  "official-trump":"TRUMP","melania-meme":"MELANIA","fartcoin":"FARTCOIN","ai16z":"AI16Z",
  "virtual-protocol":"VIRTUAL","goatseus-maximus":"GOAT","peanut-the-squirrel":"PNUT",
  "worldcoin-wld":"WLD","berachain-bera":"BERA","kaito":"KAITO","solayer":"LAYER",
  "kamino":"KMNO","render-token":"RENDER","tensor":"TNSR","drift-protocol":"DRIFT",
  "wormhole":"W","layerzero":"ZRO","ondo-finance":"ONDO","morpho":"MORPHO",
  "usual":"USUAL","cow-protocol":"COW","gmx":"GMX","pendle":"PENDLE","aave":"AAVE",
  "maker":"MKR","curve-dao-token":"CRV","tron":"TRX","algorand":"ALGO",
  "internet-computer":"ICP","fetch-ai":"FET","ocean-protocol":"OCEAN","bittensor":"TAO",
  "akash-network":"AKT","sei-network":"SEI","starknet":"STRK","zksync":"ZK",
  "altlayer":"ALT","notcoin":"NOT","moo-deng":"MOODENG","just-a-chill-guy":"CHILLGUY",
  "book-of-meme":"BOME","io-net":"IO","grass":"GRASS","zerebro":"ZEREBRO",
  "aixbt-by-virtuals":"AIXBT","griffain":"GRIFFAIN","hamster-kombat":"HMSTR",
  "popcat":"POPCAT","gigachad-2":"GIGA","ponke":"PONKE","retardio":"RETARDIO",
  "jeo-boden":"BODEN","baby-doge-coin":"BABYDOGE","turbo":"TURBO","floki":"FLOKI",
  "brett":"BRETT","cats-in-a-dogs-world":"MEW","myro":"MYRO","neiro-on-eth":"NEIRO",
};

function buildLivePriceSection(
  priceLow: unknown,
  priceHigh: unknown,
  livePrices: Record<string, number>
): string {
  if (Object.keys(livePrices).length === 0) return "";
  const low = parseFloat(String(priceLow)) || 0;
  const high = parseFloat(String(priceHigh)) || 0;
  if (low <= 0 || high <= 0) return "";

  const TOLERANCE = 5;
  const filterLow = low / TOLERANCE;
  const filterHigh = high * TOLERANCE;

  const possible: string[] = [];
  const impossible: string[] = [];

  for (const [geckoId, price] of Object.entries(livePrices)) {
    const symbol = GECKO_ID_TO_SYMBOL[geckoId] || geckoId.toUpperCase();
    const label = `${symbol} ($${price})`;
    if (price >= filterLow && price <= filterHigh) {
      const inRange = price >= low && price <= high;
      possible.push(`  ${label}${inRange ? "  ← IN RANGE" : ""}`);
    } else {
      const dir = price < low
        ? `${(low / price).toFixed(1)}x below chart range`
        : `${(price / high).toFixed(1)}x above chart range`;
      impossible.push(`  ${label}  ← IMPOSSIBLE: ${dir}`);
    }
  }

  return `\n══════════════════════════════════════════════
LIVE MARKET PRICES — fetched right now (use as ground truth for recent charts)
Chart visible price range: $${low} – $${high}
══════════════════════════════════════════════

TOKENS WHOSE CURRENT PRICE COULD MATCH (within ${TOLERANCE}x of chart range):
${possible.length > 0 ? possible.join("\n") : "  (none in top token list — likely a lower-cap token)"}

TOKENS THAT ARE MATHEMATICALLY IMPOSSIBLE if this chart is recent (last 60 days):
${impossible.join("\n")}

RULE: If the chart date is within the last 60 days, any token in the IMPOSSIBLE list above CANNOT be the correct answer.
If the chart is older (6+ months), cross-reference the price history tables instead and ignore this live data.
`;
}

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch { return null; }
}

async function fetchCoinGeckoPrice(coinId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    if (!res.ok) return null;
    const data = await res.json();
    return data[coinId]?.usd ?? null;
  } catch { return null; }
}

async function fetchHistoricalPoint(coinId: string, dateStr: string): Promise<number | null> {
  try {
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${day}-${month}-${year}&localization=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.market_data?.current_price?.usd ?? null;
  } catch { return null; }
}

interface PriceRange { min: number; max: number; avg: number; prices: number[] }

async function fetchHistoricalRange(coinId: string, startDateStr: string, endDateStr: string): Promise<PriceRange | null> {
  try {
    const toTs = Math.floor(new Date(endDateStr).getTime() / 1000) + 86400;
    const fromTs = Math.floor(new Date(startDateStr).getTime() / 1000);
    if (isNaN(fromTs) || isNaN(toTs)) return null;

    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${fromTs}&to=${toTs}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const prices: number[] = (data.prices || []).map(([, p]: [number, number]) => p).filter((p: number) => p > 0);
    if (prices.length === 0) return null;

    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((s: number, p: number) => s + p, 0) / prices.length,
      prices,
    };
  } catch { return null; }
}

const PAIR_TO_COINGECKO: Record<string, string> = {
  // ── MEGA CAP ──
  "BTC/USDT": "bitcoin", "BTC/USD": "bitcoin", "BTC/USDC": "bitcoin",
  "BTC/ETH": "bitcoin", "BTCUSDT": "bitcoin", "BTCUSD": "bitcoin", "BTCUSDC": "bitcoin",
  "ETH/USDT": "ethereum", "ETH/USD": "ethereum", "ETH/USDC": "ethereum",
  "ETH/BTC": "ethereum", "ETHUSDT": "ethereum", "ETHUSD": "ethereum",
  "BNB/USDT": "binancecoin", "BNB/USD": "binancecoin", "BNB/USDC": "binancecoin",
  "BNB/BTC": "binancecoin", "BNBUSDT": "binancecoin",

  // ── LARGE CAP L1 ──
  "SOL/USDT": "solana", "SOL/USD": "solana", "SOL/USDC": "solana",
  "SOL/BTC": "solana", "SOL/ETH": "solana", "SOLUSDT": "solana", "SOLUSD": "solana",
  "XRP/USDT": "ripple", "XRP/USD": "ripple", "XRP/USDC": "ripple",
  "XRP/BTC": "ripple", "XRPUSDT": "ripple", "XRPUSD": "ripple",
  "ADA/USDT": "cardano", "ADA/USD": "cardano", "ADA/BTC": "cardano", "ADAUSDT": "cardano",
  "AVAX/USDT": "avalanche-2", "AVAX/USD": "avalanche-2", "AVAX/BTC": "avalanche-2", "AVAXUSDT": "avalanche-2",
  "DOGE/USDT": "dogecoin", "DOGE/USD": "dogecoin", "DOGE/BTC": "dogecoin", "DOGEUSDT": "dogecoin",
  "TRX/USDT": "tron", "TRX/USD": "tron", "TRX/BTC": "tron", "TRXUSDT": "tron",
  "TON/USDT": "the-open-network", "TON/USD": "the-open-network", "TONUSDT": "the-open-network",
  "DOT/USDT": "polkadot", "DOT/USD": "polkadot", "DOT/BTC": "polkadot", "DOTUSDT": "polkadot",
  "MATIC/USDT": "matic-network", "MATIC/USD": "matic-network", "POL/USDT": "matic-network",
  "POL/USD": "matic-network", "MATICUSDT": "matic-network", "POLUSDT": "matic-network",
  "LTC/USDT": "litecoin", "LTC/USD": "litecoin", "LTC/BTC": "litecoin", "LTCUSDT": "litecoin",
  "BCH/USDT": "bitcoin-cash", "BCH/USD": "bitcoin-cash", "BCH/BTC": "bitcoin-cash", "BCHUSDT": "bitcoin-cash",
  "LINK/USDT": "chainlink", "LINK/USD": "chainlink", "LINK/BTC": "chainlink", "LINKUSDT": "chainlink",
  "UNI/USDT": "uniswap", "UNI/USD": "uniswap", "UNI/ETH": "uniswap", "UNIUSDT": "uniswap",
  "ATOM/USDT": "cosmos", "ATOM/USD": "cosmos", "ATOM/BTC": "cosmos", "ATOMUSDT": "cosmos",
  "XLM/USDT": "stellar", "XLM/USD": "stellar", "XLM/BTC": "stellar", "XLMUSDT": "stellar",
  "HBAR/USDT": "hedera-hashgraph", "HBAR/USD": "hedera-hashgraph", "HBARUSDT": "hedera-hashgraph",
  "SUI/USDT": "sui", "SUI/USD": "sui", "SUI/USDC": "sui", "SUIUSDT": "sui",
  "APT/USDT": "aptos", "APT/USD": "aptos", "APTUSDT": "aptos",
  "VET/USDT": "vechain", "VET/USD": "vechain", "VET/BTC": "vechain", "VETUSDT": "vechain",
  "FIL/USDT": "filecoin", "FIL/USD": "filecoin", "FILUSDT": "filecoin",
  "ICP/USDT": "internet-computer", "ICP/USD": "internet-computer", "ICPUSDT": "internet-computer",
  "ETC/USDT": "ethereum-classic", "ETC/USD": "ethereum-classic", "ETCUSDT": "ethereum-classic",
  "XMR/USDT": "monero", "XMR/USD": "monero", "XMR/BTC": "monero",
  "ALGO/USDT": "algorand", "ALGO/USD": "algorand", "ALGOUSDT": "algorand",
  "FTM/USDT": "fantom", "FTM/USD": "fantom", "FTMUSDT": "fantom",
  "S/USDT": "sonic-3", "S/USD": "sonic-3",
  "KAVA/USDT": "kava", "KAVA/USD": "kava", "KAVAUSDT": "kava",
  "CELO/USDT": "celo", "CELO/USD": "celo",
  "ROSE/USDT": "oasis-network", "ROSE/USD": "oasis-network", "ROSEUSDT": "oasis-network",
  "ONE/USDT": "harmony", "ONE/USD": "harmony",
  "ZIL/USDT": "zilliqa", "ZIL/USD": "zilliqa",
  "XTZ/USDT": "tezos", "XTZ/USD": "tezos",
  "WAVES/USDT": "waves", "WAVES/USD": "waves",
  "QTUM/USDT": "qtum", "QTUM/USD": "qtum",
  "DCR/USDT": "decred", "DCR/USD": "decred",
  "ZEC/USDT": "zcash", "ZEC/USD": "zcash",
  "DASH/USDT": "dash", "DASH/USD": "dash",
  "RVN/USDT": "ravencoin", "RVN/USD": "ravencoin",
  "CKB/USDT": "nervos-network", "CKB/USD": "nervos-network",
  "IOTA/USDT": "iota", "IOTA/USD": "iota",
  "EOS/USDT": "eos", "EOS/USD": "eos",
  "XEM/USDT": "nem", "XEM/USD": "nem",
  "ZEN/USDT": "zencash", "ZEN/USD": "zencash",
  "NANO/USDT": "nano", "NANO/USD": "nano",

  // ── LAYER 2 ──
  "ARB/USDT": "arbitrum", "ARB/USD": "arbitrum", "ARBUSDT": "arbitrum",
  "OP/USDT": "optimism", "OP/USD": "optimism", "OPUSDT": "optimism",
  "INJ/USDT": "injective-protocol", "INJ/USD": "injective-protocol", "INJUSDT": "injective-protocol",
  "SEI/USDT": "sei-network", "SEI/USD": "sei-network", "SEIUSDT": "sei-network",
  "ZK/USDT": "zksync", "ZK/USD": "zksync", "ZKUSDT": "zksync",
  "BERA/USDT": "berachain-bera", "BERA/USD": "berachain-bera",
  "ZETA/USDT": "zetachain", "ZETA/USD": "zetachain",
  "BLAST/USDT": "blast", "BLAST/USD": "blast",
  "CYBER/USDT": "cyberconnect", "CYBER/USD": "cyberconnect",
  "TAIKO/USDT": "taiko", "TAIKO/USD": "taiko",
  "MANTA/USDT": "manta-network", "MANTA/USD": "manta-network",
  "METIS/USDT": "metis-token", "METIS/USD": "metis-token",
  "BOBA/USDT": "boba-network", "BOBA/USD": "boba-network",
  "MODE/USDT": "mode", "MODE/USD": "mode",
  "SCROLL/USDT": "scroll", "SCROLL/USD": "scroll",
  "STRK/USDT": "starknet", "STRK/USD": "starknet",
  "MANTA/USDT": "manta-network", "MANTA/USD": "manta-network",

  // ── DeFi ──
  "AAVE/USDT": "aave", "AAVE/USD": "aave", "AAVEUSDT": "aave",
  "CRV/USDT": "curve-dao-token", "CRV/USD": "curve-dao-token", "CRVUSDT": "curve-dao-token",
  "SNX/USDT": "havven", "SNX/USD": "havven", "SNXUSDT": "havven",
  "COMP/USDT": "compound-governance-token", "COMP/USD": "compound-governance-token", "COMPUSDT": "compound-governance-token",
  "MKR/USDT": "maker", "MKR/USD": "maker", "MKRUSDT": "maker",
  "SUSHI/USDT": "sushi", "SUSHI/USD": "sushi", "SUSHIUSDT": "sushi",
  "BAL/USDT": "balancer", "BAL/USD": "balancer", "BALUSDT": "balancer",
  "YFI/USDT": "yearn-finance", "YFI/USD": "yearn-finance",
  "RUNE/USDT": "thorchain", "RUNE/USD": "thorchain", "RUNEUSDT": "thorchain",
  "1INCH/USDT": "1inch", "1INCH/USD": "1inch", "1INCHUSDT": "1inch",
  "DYDX/USDT": "dydx", "DYDX/USD": "dydx", "DYDXUSDT": "dydx",
  "GMX/USDT": "gmx", "GMX/USD": "gmx", "GMXUSDT": "gmx",
  "PENDLE/USDT": "pendle", "PENDLE/USD": "pendle", "PENDLEUSDT": "pendle",
  "LDO/USDT": "lido-dao", "LDO/USD": "lido-dao", "LDOUSDT": "lido-dao",
  "RPL/USDT": "rocket-pool", "RPL/USD": "rocket-pool",
  "FXS/USDT": "frax-share", "FXS/USD": "frax-share",
  "CVX/USDT": "convex-finance", "CVX/USD": "convex-finance",
  "CAKE/USDT": "pancakeswap-token", "CAKE/USD": "pancakeswap-token", "CAKEUSDT": "pancakeswap-token",
  "BLUR/USDT": "blur", "BLUR/USD": "blur", "BLURUSDT": "blur",
  "ENS/USDT": "ethereum-name-service", "ENS/USD": "ethereum-name-service",
  "ALPHA/USDT": "alpha-finance", "ALPHA/USD": "alpha-finance",
  "SPELL/USDT": "spell-token", "SPELL/USD": "spell-token",
  "BADGER/USDT": "badger-dao", "BADGER/USD": "badger-dao",
  "BNT/USDT": "bancor", "BNT/USD": "bancor",
  "KNC/USDT": "kyber-network-crystal", "KNC/USD": "kyber-network-crystal",
  "COTI/USDT": "coti", "COTI/USD": "coti",
  "LQTY/USDT": "liquity", "LQTY/USD": "liquity",
  "VELO/USDT": "velodrome-finance", "VELO/USD": "velodrome-finance",
  "AERO/USDT": "aerodrome-finance", "AERO/USD": "aerodrome-finance",

  // ── MID CAP ──
  "NEAR/USDT": "near", "NEAR/USD": "near", "NEARUSDT": "near",
  "TAO/USDT": "bittensor", "TAO/USD": "bittensor",
  "KAS/USDT": "kaspa", "KAS/USD": "kaspa", "KASUSDT": "kaspa",
  "STX/USDT": "blockstack", "STX/USD": "blockstack", "STXUSDT": "blockstack",
  "RNDR/USDT": "render-token", "RNDR/USD": "render-token", "RNDRUSDT": "render-token",
  "GRT/USDT": "the-graph", "GRT/USD": "the-graph", "GRTUSDT": "the-graph",
  "FET/USDT": "fetch-ai", "FET/USD": "fetch-ai", "FETUSDT": "fetch-ai",
  "WLD/USDT": "worldcoin-wld", "WLD/USD": "worldcoin-wld", "WLDUSDT": "worldcoin-wld",
  "ONDO/USDT": "ondo-finance", "ONDO/USD": "ondo-finance", "ONDO/USDC": "ondo-finance", "ONDOUSDT": "ondo-finance",
  "EIGEN/USDT": "eigenlayer", "EIGEN/USD": "eigenlayer", "EIGENUSDT": "eigenlayer",
  "ENA/USDT": "ethena", "ENA/USD": "ethena", "ENAUSDT": "ethena",
  "W/USDT": "wormhole", "W/USD": "wormhole", "WUSDT": "wormhole",
  "ZRO/USDT": "layerzero", "ZRO/USD": "layerzero", "ZROUSDT": "layerzero",
  "AR/USDT": "arweave", "AR/USD": "arweave", "ARUSDT": "arweave",
  "HNT/USDT": "helium", "HNT/USD": "helium", "HNTUSDT": "helium",
  "AKT/USDT": "akash-network", "AKT/USD": "akash-network", "AKTUSDT": "akash-network",
  "MEME/USDT": "memecoin-2", "MEME/USD": "memecoin-2",
  "TIA/USDT": "celestia", "TIA/USD": "celestia", "TIAUSDT": "celestia",
  "EGLD/USDT": "elrond-erd-2", "EGLD/USD": "elrond-erd-2", "EGLDUSDT": "elrond-erd-2",
  "FLOW/USDT": "flow", "FLOW/USD": "flow", "FLOWUSDT": "flow",
  "RON/USDT": "ronin", "RON/USD": "ronin", "RONUSDT": "ronin",
  "IMX/USDT": "immutable-x", "IMX/USD": "immutable-x", "IMXUSDT": "immutable-x",
  "AXS/USDT": "axie-infinity", "AXS/USD": "axie-infinity", "AXSUSDT": "axie-infinity",
  "SAND/USDT": "the-sandbox", "SAND/USD": "the-sandbox", "SANDUSDT": "the-sandbox",
  "MANA/USDT": "decentraland", "MANA/USD": "decentraland", "MANAUSDT": "decentraland",
  "GALA/USDT": "gala", "GALA/USD": "gala", "GALAUSDT": "gala",
  "ENJ/USDT": "enjincoin", "ENJ/USD": "enjincoin",
  "BEAM/USDT": "beam-2", "BEAM/USD": "beam-2", "BEAMUSDT": "beam-2",
  "YGG/USDT": "yield-guild-games", "YGG/USD": "yield-guild-games",
  "CHZ/USDT": "chiliz", "CHZ/USD": "chiliz", "CHZUSDT": "chiliz",
  "AUDIO/USDT": "audius", "AUDIO/USD": "audius",
  "PRIME/USDT": "echelon-prime", "PRIME/USD": "echelon-prime",
  "JASMY/USDT": "jasmycoin", "JASMY/USD": "jasmycoin", "JASMYUSDT": "jasmycoin",
  "POLYX/USDT": "polymesh-network", "POLYX/USD": "polymesh-network",
  "CFG/USDT": "centrifuge", "CFG/USD": "centrifuge",
  "TRU/USDT": "truefi", "TRU/USD": "truefi",
  "HOOK/USDT": "hooked-protocol", "HOOK/USD": "hooked-protocol",
  "LOOM/USDT": "loom-network-new", "LOOM/USD": "loom-network-new",
  "HIGH/USDT": "highstreet", "HIGH/USD": "highstreet",
  "MASK/USDT": "mask-network", "MASK/USD": "mask-network",
  "OCEAN/USDT": "ocean-protocol", "OCEAN/USD": "ocean-protocol",
  "BAND/USDT": "band-protocol", "BAND/USD": "band-protocol",
  "RSR/USDT": "reserve-rights-token", "RSR/USD": "reserve-rights-token",
  "PERP/USDT": "perpetual-protocol", "PERP/USD": "perpetual-protocol",
  "RAD/USDT": "radicle", "RAD/USD": "radicle",
  "OSMO/USDT": "osmosis", "OSMO/USD": "osmosis",
  "SCRT/USDT": "secret", "SCRT/USD": "secret",
  "INJ/USDC": "injective-protocol",

  // ── SOLANA ECOSYSTEM ──
  "JUP/USDT": "jupiter-exchange-solana", "JUP/USD": "jupiter-exchange-solana",
  "JUP/USDC": "jupiter-exchange-solana", "JUP/SOL": "jupiter-exchange-solana", "JUPUSDT": "jupiter-exchange-solana",
  "RAY/USDT": "raydium", "RAY/USD": "raydium",
  "RAY/USDC": "raydium", "RAY/SOL": "raydium", "RAYUSDT": "raydium",
  "PYTH/USDT": "pyth-network", "PYTH/USD": "pyth-network", "PYTH/USDC": "pyth-network", "PYTHUSDT": "pyth-network",
  "JTO/USDT": "jito-governance-token", "JTO/USD": "jito-governance-token",
  "JTO/USDC": "jito-governance-token", "JTO/SOL": "jito-governance-token", "JTOUSDT": "jito-governance-token",
  "ORCA/USDT": "orca", "ORCA/USD": "orca", "ORCA/USDC": "orca", "ORCA/SOL": "orca",
  "MNGO/USDT": "mango-markets", "MNGO/USD": "mango-markets",
  "STEP/USDT": "step-finance", "STEP/USD": "step-finance",
  "COPE/USDT": "cope", "COPE/USD": "cope",
  "FIDA/USDT": "bonfida", "FIDA/USD": "bonfida", "FIDA/SOL": "bonfida",
  "SAMO/USDT": "samoyedcoin", "SAMO/USD": "samoyedcoin", "SAMO/SOL": "samoyedcoin",
  "ATLAS/USDT": "star-atlas", "ATLAS/USD": "star-atlas", "ATLAS/USDC": "star-atlas",
  "POLIS/USDT": "star-atlas-dao", "POLIS/USD": "star-atlas-dao",
  "ABR/USDT": "allbridge", "ABR/USD": "allbridge",
  "SHDW/USDT": "genesysgo-shadow", "SHDW/USD": "genesysgo-shadow",
  "GRASS/USDT": "grass", "GRASS/USD": "grass", "GRASS/USDC": "grass", "GRASS/SOL": "grass",
  "DRIFT/USDT": "drift-protocol", "DRIFT/USD": "drift-protocol",
  "DRIFT/USDC": "drift-protocol", "DRIFT/SOL": "drift-protocol", "DRIFTUSDT": "drift-protocol",
  "CLOUD/USDT": "sanctum-2", "CLOUD/USD": "sanctum-2", "CLOUD/USDC": "sanctum-2",
  "ZEUS/USDT": "zeus-network", "ZEUS/USD": "zeus-network",
  "LAYER/USDT": "solayer", "LAYER/USD": "solayer", "LAYER/USDC": "solayer",
  "KMNO/USDT": "kamino", "KMNO/USD": "kamino", "KMNO/USDC": "kamino",
  "PENGU/USDT": "pudgy-penguins", "PENGU/USD": "pudgy-penguins",
  "PENGU/USDC": "pudgy-penguins", "PENGU/SOL": "pudgy-penguins", "PENGUUSDT": "pudgy-penguins",
  "MSOL/USDT": "msol", "MSOL/USD": "msol", "MSOL/SOL": "msol",
  "JSOL/USDT": "jpool-staked-sol", "JSOL/SOL": "jpool-staked-sol",
  "BSOL/USDT": "blazestake-staked-sol", "BSOL/SOL": "blazestake-staked-sol",
  "SLND/USDT": "solend", "SLND/USD": "solend",

  // ── MEME COINS (MULTI-CHAIN) ──
  "WIF/USDT": "dogwifchat", "WIF/USD": "dogwifchat",
  "WIF/USDC": "dogwifchat", "WIF/SOL": "dogwifchat", "WIFUSDT": "dogwifchat",
  "BONK/USDT": "bonk", "BONK/USD": "bonk",
  "BONK/USDC": "bonk", "BONK/SOL": "bonk", "BONKUSDT": "bonk",
  "PEPE/USDT": "pepe", "PEPE/USD": "pepe", "PEPE/ETH": "pepe", "PEPEUSDT": "pepe",
  "SHIB/USDT": "shiba-inu", "SHIB/USD": "shiba-inu", "SHIBUSDT": "shiba-inu",
  "FLOKI/USDT": "floki", "FLOKI/USD": "floki", "FLOKIUSDT": "floki",
  "NOT/USDT": "notcoin", "NOT/USD": "notcoin", "NOTUSDT": "notcoin",
  "POPCAT/USDT": "popcat", "POPCAT/USD": "popcat",
  "POPCAT/USDC": "popcat", "POPCAT/SOL": "popcat", "POPCATUSDT": "popcat",
  "MEW/USDT": "cat-in-a-dogs-world", "MEW/USD": "cat-in-a-dogs-world",
  "MEW/USDC": "cat-in-a-dogs-world", "MEW/SOL": "cat-in-a-dogs-world", "MEWUSDT": "cat-in-a-dogs-world",
  "BOME/USDT": "book-of-meme", "BOME/USD": "book-of-meme",
  "BOME/USDC": "book-of-meme", "BOME/SOL": "book-of-meme", "BOMEUSDT": "book-of-meme",
  "PNUT/USDT": "peanut-the-squirrel", "PNUT/USD": "peanut-the-squirrel",
  "PNUT/USDC": "peanut-the-squirrel", "PNUT/SOL": "peanut-the-squirrel", "PNUTUSDT": "peanut-the-squirrel",
  "ACT/USDT": "act-i-the-ai-prophecy", "ACT/USD": "act-i-the-ai-prophecy",
  "ACT/USDC": "act-i-the-ai-prophecy", "ACT/SOL": "act-i-the-ai-prophecy",
  "GOAT/USDT": "goatseus-maximus", "GOAT/USD": "goatseus-maximus",
  "GOAT/USDC": "goatseus-maximus", "GOAT/SOL": "goatseus-maximus", "GOATUSDT": "goatseus-maximus",
  "FARTCOIN/USDT": "fartcoin", "FARTCOIN/USD": "fartcoin",
  "FARTCOIN/USDC": "fartcoin", "FARTCOIN/SOL": "fartcoin", "FARTCOINUSDT": "fartcoin",
  "BRETT/USDT": "brett", "BRETT/USD": "brett", "BRETT/USDC": "brett", "BRETTUSDT": "brett",
  "TURBO/USDT": "turbo", "TURBO/USD": "turbo", "TURBOUSDT": "turbo",
  "HMSTR/USDT": "hamster-kombat", "HMSTR/USD": "hamster-kombat", "HMSTRUSDT": "hamster-kombat",
  "SLERF/USDT": "slerf", "SLERF/USD": "slerf", "SLERF/SOL": "slerf", "SLERFUSDT": "slerf",
  "MYRO/USDT": "myro", "MYRO/USD": "myro", "MYRO/SOL": "myro", "MYROUSDT": "myro",
  "NEIRO/USDT": "neiro-on-eth", "NEIRO/USD": "neiro-on-eth",
  "MOODENG/USDT": "moo-deng", "MOODENG/USD": "moo-deng",
  "MOODENG/USDC": "moo-deng", "MOODENG/SOL": "moo-deng",
  "CHILLGUY/USDT": "just-a-chill-guy", "CHILLGUY/USD": "just-a-chill-guy",
  "CHILLGUY/USDC": "just-a-chill-guy", "CHILLGUY/SOL": "just-a-chill-guy",
  "GME/USDT": "gme", "GME/USD": "gme", "GME/SOL": "gme",
  "MOTHER/USDT": "mother-iggy", "MOTHER/USD": "mother-iggy",
  "MOTHER/USDC": "mother-iggy", "MOTHER/SOL": "mother-iggy",
  "MICHI/USDT": "michi", "MICHI/USD": "michi", "MICHI/SOL": "michi",
  "HARAMBE/USDT": "harambe-on-solana", "HARAMBE/SOL": "harambe-on-solana",
  "DINO/USDT": "dino", "DINO/SOL": "dino",
  "DOGS/USDT": "dogs", "DOGS/USD": "dogs",
  "BABYDOGE/USDT": "baby-doge-coin", "BABYDOGE/USD": "baby-doge-coin",
  "COQ/USDT": "coq-inu", "COQ/USD": "coq-inu",
  "WOJAK/USDT": "wojak", "WOJAK/ETH": "wojak",
  "MOG/USDT": "mog-coin", "MOG/ETH": "mog-coin",
  "ANDY/USDT": "andy-on-base",

  // ── AI AGENT TOKENS ──
  "AI16Z/USDT": "ai16z", "AI16Z/USD": "ai16z",
  "AI16Z/USDC": "ai16z", "AI16Z/SOL": "ai16z", "AI16ZUSDT": "ai16z",
  "VIRTUAL/USDT": "virtual-protocol", "VIRTUAL/USD": "virtual-protocol",
  "VIRTUAL/USDC": "virtual-protocol", "VIRTUALUSDT": "virtual-protocol",
  "GRIFFAIN/USDT": "griffain", "GRIFFAIN/USD": "griffain",
  "GRIFFAIN/USDC": "griffain", "GRIFFAIN/SOL": "griffain",
  "ZEREBRO/USDT": "zerebro", "ZEREBRO/USD": "zerebro",
  "ZEREBRO/USDC": "zerebro", "ZEREBRO/SOL": "zerebro", "ZEREBROUSDT": "zerebro",
  "ELIZA/USDT": "eliza", "ELIZA/USD": "eliza", "ELIZA/SOL": "eliza",
  "AIXBT/USDT": "aixbt-by-virtuals", "AIXBT/USD": "aixbt-by-virtuals",
  "SWARMS/USDT": "swarms", "SWARMS/USD": "swarms", "SWARMS/SOL": "swarms",
  "VADER/USDT": "vader-ai", "VADER/USD": "vader-ai",
  "COOKIE/USDT": "cookie", "COOKIE/USD": "cookie",
  "DUCK/USDT": "duck-ai", "DUCK/USD": "duck-ai",
  "SEKOIA/USDT": "sekoia", "SEKOIA/USD": "sekoia",

  // ── POLITICS / CULTURAL ──
  "TRUMP/USDT": "official-trump", "TRUMP/USD": "official-trump",
  "TRUMP/USDC": "official-trump", "TRUMP/SOL": "official-trump", "TRUMPUSDT": "official-trump",
  "MELANIA/USDT": "melania-meme", "MELANIA/USD": "melania-meme",
  "MELANIA/USDC": "melania-meme", "MELANIA/SOL": "melania-meme", "MELANIAUSDT": "melania-meme",
  "LIBRA/USDT": "libra-by-kip", "LIBRA/USD": "libra-by-kip",
  "VINE/USDT": "vine-coin", "VINE/USD": "vine-coin",
  "BODEN/USDT": "jeo-boden", "BODEN/USD": "jeo-boden",
  "KENIDY/USDT": "kenidy", "KENIDY/USD": "kenidy",

  // ── BASE CHAIN ──
  "TOSHI/USDT": "toshi-on-base", "TOSHI/USD": "toshi-on-base",
  "DEGEN/USDT": "degen-base", "DEGEN/USD": "degen-base",
  "AERODROME/USDT": "aerodrome-finance", "AERODROME/USD": "aerodrome-finance",
  "NORMIE/USDT": "normie", "NORMIE/USD": "normie",
  "MOCHI/USDT": "mochi-the-cat", "MOCHI/USD": "mochi-the-cat",
  "HIGHER/USDT": "higher", "HIGHER/USD": "higher",
  "BALD/USDT": "bald", "BALD/USD": "bald",
  "ALT/USDT": "altlayer", "ALT/USD": "altlayer",
  "DOGINME/USDT": "doginme", "DOGINME/USD": "doginme",

  // ── RWA ──
  "MPL/USDT": "maple", "MPL/USD": "maple",
  "RIO/USDT": "realio-network", "RIO/USD": "realio-network",

  // ── HYPERLIQUID PERPS ──
  "HYPE/USDT": "hyperliquid", "HYPE/USD": "hyperliquid",
  "HYPE/USDC": "hyperliquid", "HYPEUSDT": "hyperliquid",
  "PURR/USD": "purr", "PURR/USDC": "purr",

  // ── COMMODITIES / FOREX ──
  "XAUUSD": "gold", "XAGUSD": "silver",
  "XAUUSDT": "gold", "XAGUSDT": "silver",
  "XAU/USD": "gold", "XAG/USD": "silver",
  "XAU/USDT": "gold", "XAG/USDT": "silver",

  // ── NEW DEFI 2024-2025 ──
  "MORPHO/USDT": "morpho", "MORPHO/USD": "morpho", "MORPHO/USDC": "morpho", "MORPHO/ETH": "morpho",
  "USUAL/USDT": "usual", "USUAL/USD": "usual", "USUAL/USDC": "usual",
  "SAFE/USDT": "safe-token", "SAFE/USD": "safe-token", "SAFEUSDT": "safe-token",
  "COW/USDT": "cow-protocol", "COW/USD": "cow-protocol",
  "PENDLE/USDC": "pendle", "PENDLE/ETH": "pendle", "PENDLE/BNB": "pendle",
  "AAVE/USDC": "aave", "AAVE/ETH": "aave", "AAVE/BTC": "aave",
  "MKR/USDC": "maker", "MKR/ETH": "maker",
  "CRV/ETH": "curve-dao-token", "CRV/USDC": "curve-dao-token",
  "SNX/USDC": "havven", "SNX/ETH": "havven",
  "GMX/USDT": "gmx", "GMX/USD": "gmx", "GMXUSDT": "gmx",
  "GMX/USDC": "gmx",
  "BLUR/USDT": "blur", "BLUR/USD": "blur", "BLUR/ETH": "blur",
  "FRAX/USDT": "frax", "FRAX/USD": "frax",
  "LUSD/USDT": "liquity-usd", "LUSD/USD": "liquity-usd",
  "COW/ETH": "cow-protocol",

  // ── NEW LAYER 2 / INFRA 2024-2025 ──
  "ZK/USDC": "zksync", "ZK/ETH": "zksync",
  "STRK/USDC": "starknet", "STRK/ETH": "starknet",
  "TAIKO/USDC": "taiko", "TAIKO/ETH": "taiko",
  "BERA/USDC": "berachain-bera", "BERA/ETH": "berachain-bera",
  "W/USDC": "wormhole", "W/ETH": "wormhole",
  "ZRO/USDC": "layerzero", "ZRO/ETH": "layerzero",
  "ONDO/USDC": "ondo-finance", "ONDO/ETH": "ondo-finance",
  "WLD/USDC": "worldcoin-wld", "WLD/ETH": "worldcoin-wld",
  "WLDUSDT": "worldcoin-wld",
  "ALT/USDC": "altlayer",

  // ── SOLANA ECOSYSTEM EXPANSION ──
  "WEN/USDT": "wen-4", "WEN/USD": "wen-4", "WEN/USDC": "wen-4", "WEN/SOL": "wen-4",
  "MNDE/USDT": "marinade", "MNDE/USD": "marinade", "MNDE/SOL": "marinade",
  "HXRO/USDT": "hxro", "HXRO/USD": "hxro",
  "BONK/ETH": "bonk",
  "JUP/ETH": "jupiter-exchange-solana",
  "RAY/ETH": "raydium",
  "LAYER/USDT": "solayer", "LAYER/USD": "solayer",
  "KMNO/USDT": "kamino", "KMNO/USD": "kamino",
  "ZEUS/USDT": "zeus-network", "ZEUS/USD": "zeus-network",
  "CLOUD/USDT": "sanctum-2", "CLOUD/USD": "sanctum-2",
  "KAITO/USDT": "kaito", "KAITO/USD": "kaito", "KAITO/USDC": "kaito",

  // ── GAMING & NFT ──
  "ILV/USDT": "illuvium", "ILV/USD": "illuvium", "ILV/ETH": "illuvium", "ILVUSDT": "illuvium",
  "PIXELS/USDT": "pixels", "PIXELS/USD": "pixels", "PIXELS/ETH": "pixels",
  "GODS/USDT": "gods-unchained", "GODS/USD": "gods-unchained", "GODS/ETH": "gods-unchained",
  "MAGIC/USDT": "treasure", "MAGIC/USD": "treasure", "MAGIC/USDC": "treasure", "MAGICUSDT": "treasure",
  "SLP/USDT": "smooth-love-potion", "SLP/USD": "smooth-love-potion", "SLP/ETH": "smooth-love-potion",
  "GHST/USDT": "aavegotchi", "GHST/USD": "aavegotchi", "GHST/ETH": "aavegotchi",
  "SFUND/USDT": "seedify-fund", "SFUND/USD": "seedify-fund",
  "SIDUS/USDT": "sidus", "SIDUS/USD": "sidus",
  "MC/USDT": "merit-circle", "MC/USD": "merit-circle",
  "MYRIA/USDT": "myria", "MYRIA/USD": "myria",
  "BIRTH/USDT": "birthplace-of-ai",

  // ── TERRA LEGACY ──
  "LUNC/USDT": "terra-luna", "LUNC/USD": "terra-luna", "LUNCUSDT": "terra-luna",
  "LUNC/BUSD": "terra-luna", "LUNC/BTC": "terra-luna",
  "LUNA/USDT": "terra-luna-2", "LUNA/USD": "terra-luna-2", "LUNAUSDT": "terra-luna-2",
  "LUNA/USDC": "terra-luna-2", "LUNA/BTC": "terra-luna-2",
  "USTC/USDT": "terrausd",

  // ── TON ECOSYSTEM ──
  "DOGS/USDC": "dogs",
  "HMSTR/USDC": "hamster-kombat",
  "NOT/USDC": "notcoin",
  "STON/USDT": "ston-fi", "STON/USD": "ston-fi",
  "SCALE/USDT": "scale", "SCALE/USD": "scale",
  "TONCOIN/USDT": "the-open-network", "TONCOIN/USD": "the-open-network",

  // ── EXTENDED MEME ──
  "TOSHI/USDC": "toshi-on-base", "TOSHI/ETH": "toshi-on-base",
  "DEGEN/USDC": "degen-base", "DEGEN/ETH": "degen-base",
  "HIGHER/USDC": "higher", "HIGHER/ETH": "higher",
  "WIF/ETH": "dogwifchat",
  "PEPE/USDC": "pepe",
  "SHIB/BTC": "shiba-inu", "SHIB/ETH": "shiba-inu",
  "FLOKI/ETH": "floki", "FLOKI/BNB": "floki",
  "BONK/BTC": "bonk",
  "PEPE/BTC": "pepe",
  "MEME/USDC": "memecoin-2",
  "KISHU/USDT": "kishu-inu",
  "BABYDOGE/BNB": "baby-doge-coin",
  "COQ/USDT": "coq-inu", "COQ/USD": "coq-inu", "COQ/AVAX": "coq-inu",
  "WOJAK/USDT": "wojak", "WOJAK/ETH": "wojak",
  "MOG/USDT": "mog-coin", "MOG/ETH": "mog-coin", "MOG/USDC": "mog-coin",
  "ANDY/USDT": "andy-on-base", "ANDY/ETH": "andy-on-base",
  "GIGA/USDT": "gigachad-2", "GIGA/SOL": "gigachad-2",
  "PONKE/USDT": "ponke", "PONKE/SOL": "ponke",
  "RETARDIO/USDT": "retardio", "RETARDIO/SOL": "retardio",
  "SIGMA/USDT": "sigma-sol", "SIGMA/SOL": "sigma-sol",
  "SMOLE/USDT": "smole", "SMOLE/SOL": "smole",

  // ── AI AGENT EXPANSION ──
  "ELIZA/USDT": "eliza", "ELIZA/USD": "eliza", "ELIZA/SOL": "eliza", "ELIZA/USDC": "eliza",
  "SWARMS/USDT": "swarms", "SWARMS/USD": "swarms", "SWARMS/SOL": "swarms",
  "VADER/USDT": "vader-ai", "VADER/USD": "vader-ai",
  "COOKIE/USDT": "cookie", "COOKIE/USD": "cookie", "COOKIE/ETH": "cookie",
  "DUCK/USDT": "duck-ai", "DUCK/USD": "duck-ai",
  "SEKOIA/USDT": "sekoia", "SEKOIA/USD": "sekoia",
  "ARC/USDT": "arc", "ARC/USD": "arc", "ARC/SOL": "arc",
  "LUNA/SOL": "terra-luna-2",

  // ── CEX/FIAT PAIRS ──
  "BTCBUSD": "bitcoin", "ETHBUSD": "ethereum", "BNBBUSD": "binancecoin",
  "ADABUSD": "cardano", "XRPBUSD": "ripple", "SOLBUSD": "solana",
  "BTCFDUSD": "bitcoin", "ETHFDUSD": "ethereum", "BNBFDUSD": "binancecoin",
  "SOLFDUSD": "solana", "XRPFDUSD": "ripple",

  // ── ADDITIONAL BARE SYMBOL LOOKUPS ──
  "SOLUSDT": "solana", "XRPUSDT": "ripple", "ADAUSDT": "cardano",
  "AVAXUSDT": "avalanche-2", "DOGEUSDT": "dogecoin", "TRXUSDT": "tron",
  "TONUSDT": "the-open-network", "DOTUSDT": "polkadot",
  "LTCUSDT": "litecoin", "BCHUSDT": "bitcoin-cash", "LINKUSDT": "chainlink",
  "UNIUSDT": "uniswap", "ATOMUSDT": "cosmos", "XLMUSDT": "stellar",
  "HBARUSDT": "hedera-hashgraph", "SUIUSDT": "sui", "APTUSDT": "aptos",
  "KASUSDT": "kaspa", "HYPEUSDT": "hyperliquid",
};

function pairToSymbol(pair: string): string {
  return pair.replace("/", "").replace("-", "").toUpperCase();
}

async function resolveCurrentPrice(pair: string): Promise<number | null> {
  if (!pair || pair === "UNKNOWN") return null;
  const binanceSymbol = pairToSymbol(pair);
  const binancePrice = await fetchBinancePrice(binanceSymbol);
  if (binancePrice !== null) return binancePrice;
  const upper = pair.toUpperCase();
  const geckoId = PAIR_TO_COINGECKO[upper] || PAIR_TO_COINGECKO[binanceSymbol];
  if (geckoId) return fetchCoinGeckoPrice(geckoId);
  return null;
}

async function resolveHistoricalPoint(pair: string, dateStr: string): Promise<number | null> {
  if (!pair || pair === "UNKNOWN" || !dateStr) return null;
  const upper = pair.toUpperCase();
  const binanceSymbol = pairToSymbol(pair);
  const geckoId = PAIR_TO_COINGECKO[upper] || PAIR_TO_COINGECKO[binanceSymbol];
  if (!geckoId) return null;
  return fetchHistoricalPoint(geckoId, dateStr);
}

async function resolveHistoricalRange(pair: string, startDate: string, endDate: string): Promise<PriceRange | null> {
  if (!pair || pair === "UNKNOWN" || !startDate || !endDate) return null;
  const upper = pair.toUpperCase();
  const binanceSymbol = pairToSymbol(pair);
  const geckoId = PAIR_TO_COINGECKO[upper] || PAIR_TO_COINGECKO[binanceSymbol];
  if (!geckoId) return null;
  return fetchHistoricalRange(geckoId, startDate, endDate);
}

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[,$\s]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function pointMatchScore(visible: number, historical: number): number {
  if (historical <= 0) return 0;
  const ratio = visible / historical;
  if (ratio >= 0.80 && ratio <= 1.20) return 1.0;
  if (ratio >= 0.60 && ratio <= 1.50) return 0.6;
  if (ratio >= 0.30 && ratio <= 2.50) return 0.2;
  return 0;
}

function rangeOverlapScore(visibleLow: number, visibleHigh: number, histMin: number, histMax: number): number {
  if (visibleHigh <= visibleLow || histMax <= histMin) return 0;
  const overlapLow = Math.max(visibleLow, histMin);
  const overlapHigh = Math.min(visibleHigh, histMax);
  if (overlapLow >= overlapHigh) return 0;
  const overlapSize = overlapHigh - overlapLow;
  const visibleSize = visibleHigh - visibleLow;
  const histSize = histMax - histMin;
  const coverageOfVisible = overlapSize / visibleSize;
  const coverageOfHist = overlapSize / histSize;
  const baseScore = coverageOfVisible * 0.7 + coverageOfHist * 0.3;
  const tightnessPenalty = histSize > visibleSize * 20 ? 0.15 : 0;
  return Math.min(1.0, Math.max(0, baseScore - tightnessPenalty));
}

function currentPriceMatchScore(visible: number, current: number): number {
  if (current <= 0) return 0;
  const ratio = visible / current;
  if (ratio >= 0.85 && ratio <= 1.15) return 1.0;
  if (ratio >= 0.70 && ratio <= 1.40) return 0.5;
  if (ratio >= 0.40 && ratio <= 2.00) return 0.1;
  return 0;
}

interface CandidateScore {
  pair: string;
  pointScore: number;
  rangeScore: number;
  currentScore: number;
  combinedScore: number;
  historicalPoint: number | null;
  historicalRange: PriceRange | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return new Response(JSON.stringify({ error: "Missing image data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysis = await runPipeline(image, openrouterKey);

    const candidates = (analysis.candidates as Array<Record<string, unknown>>) || [];
    const topPair = (analysis.top_pair as string) || (candidates[0]?.pair as string) || "UNKNOWN";
    const topConfidence = (analysis.top_confidence as number) || (candidates[0]?.confidence as number) || 0;

    const uniquePairs = [...new Set(candidates.map((c) => c.pair as string).filter(Boolean))];
    const liveprices = await Promise.all(uniquePairs.map((p) => resolveCurrentPrice(p)));
    const livePriceMap: Record<string, number | null> = {};
    uniquePairs.forEach((p, i) => { livePriceMap[p] = liveprices[i]; });

    const enrichedCandidates = candidates.map((c) => {
      const pair = c.pair as string;
      const livePrice = livePriceMap[pair] ?? (c.current_price as number) ?? null;
      return { ...c, current_price: livePrice };
    });

    const result = {
      predicted_pair: topPair,
      confidence: topConfidence,
      candidates: enrichedCandidates,
      price_low: (analysis.price_low as string) || null,
      price_high: (analysis.price_high as string) || null,
      price_current: (analysis.price_current as string) || null,
      chart_date: (analysis.chart_date as string) || null,
      chart_end_date: (analysis.chart_end_date as string) || null,
      inferred_year: (analysis.inferred_year as string) || null,
      platform: (analysis.platform as string) || null,
      chain: (analysis.chain as string) || null,
      dex: (analysis.dex as string) || null,
      timeframe: (analysis.timeframe as string) || null,
      chart_type: (analysis.chart_type as string) || null,
      indicators: (analysis.indicators as string[]) || [],
      contract_address: (analysis.contract_address as string) || null,
      reasoning: (analysis.reasoning as string) || null,
      model_used: analysis.identify_model || null,
      extract_model: analysis.extract_model || null,
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabase.from("analyses").insert({
      predicted_pair: result.predicted_pair,
      confidence: result.confidence,
      current_price: result.candidates[0]?.current_price ?? null,
      visible_price: result.price_current,
      timeframe: result.timeframe,
      indicators: result.indicators,
      reasons: result.candidates.map((c: Record<string, unknown>) => c.reason).filter(Boolean),
      raw_response: result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
