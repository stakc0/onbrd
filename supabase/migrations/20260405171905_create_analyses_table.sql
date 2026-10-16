/*
  # Create analyses table

  1. New Tables
    - `analyses`
      - `id` (uuid, primary key)
      - `predicted_pair` (text) - The predicted trading pair
      - `confidence` (integer) - Confidence score 0-100
      - `current_price` (numeric) - Live market price at time of analysis
      - `visible_price` (text) - Price visible in the uploaded chart image
      - `timeframe` (text) - Chart timeframe detected by the vision model
      - `indicators` (text[]) - Technical indicators detected
      - `reasons` (text[]) - Reasoning behind the prediction
      - `raw_response` (jsonb) - Full structured response from the analysis
      - `created_at` (timestamptz) - Timestamp of the analysis

  2. Security
    - Enable RLS on `analyses` table
    - No public access policies; all writes go through the edge function
      using the service role key which bypasses RLS
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
