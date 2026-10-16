/*
  # Create pairs reference table

  1. New Tables
    - `pairs`
      - `id` (uuid, primary key)
      - `ticker` (text, unique) - base token symbol e.g. BTC
      - `full_name` (text) - full token name
      - `coingecko_id` (text) - CoinGecko API identifier
      - `quote_currencies` (text[]) - supported quote currencies e.g. [USDT, USD, USDC]
      - `all_time_low` (numeric) - all-time low price in USD
      - `all_time_high` (numeric) - all-time high price in USD
      - `launch_date` (date) - date token was launched/listed
      - `category` (text) - token category: layer1, layer2, defi, meme, solana, ai, gaming, rwa, etc.
      - `chain` (text) - primary chain: SOL, ETH, BASE, BSC, etc.
      - `price_ranges_json` (jsonb) - quarterly price range history
      - `notes` (text) - any special notes about price behavior
      - `is_active` (boolean) - whether pair is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `pairs` table
    - Add policy for authenticated and anonymous read access (reference data)
    - Add policy for service role to write

  3. Notes
    - This table stores comprehensive reference data for all tracked trading pairs
    - price_ranges_json format: { "2024-Q1": { "low": 0.5, "high": 1.2 }, ... }
*/

CREATE TABLE IF NOT EXISTS pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text UNIQUE NOT NULL,
  full_name text NOT NULL,
  coingecko_id text,
  quote_currencies text[] DEFAULT ARRAY['USDT','USD'],
  all_time_low numeric,
  all_time_high numeric,
  launch_date date,
  category text DEFAULT 'crypto',
  chain text DEFAULT 'multi',
  price_ranges_json jsonb DEFAULT '{}',
  notes text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pairs"
  ON pairs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role can insert pairs"
  ON pairs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update pairs"
  ON pairs FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pairs_ticker_idx ON pairs (ticker);
CREATE INDEX IF NOT EXISTS pairs_coingecko_id_idx ON pairs (coingecko_id);
CREATE INDEX IF NOT EXISTS pairs_category_idx ON pairs (category);
CREATE INDEX IF NOT EXISTS pairs_chain_idx ON pairs (chain);
