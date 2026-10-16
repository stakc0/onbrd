/*
  # Create analyses table for chart scan history

  1. New Tables
    - `analyses`
      - `id` (uuid, primary key) - Unique analysis identifier
      - `predicted_pair` (text) - The predicted trading pair (e.g. BTC/USDT)
      - `confidence` (integer) - Confidence score 0-100
      - `current_price` (numeric) - Market price at time of analysis
      - `visible_price` (text) - Price visible in the chart image
      - `timeframe` (text) - Detected chart timeframe
      - `indicators` (text array) - Technical indicators detected
      - `reasons` (text array) - Reasoning for prediction
      - `raw_response` (jsonb) - Full analysis response data
      - `created_at` (timestamptz) - Timestamp of analysis

  2. Security
    - Enable RLS on `analyses` table
*/

CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predicted_pair text DEFAULT '',
  confidence integer DEFAULT 0,
  current_price numeric,
  visible_price text DEFAULT '',
  timeframe text DEFAULT '',
  indicators text[] DEFAULT '{}',
  reasons text[] DEFAULT '{}',
  raw_response jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
