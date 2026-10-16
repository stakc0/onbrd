/*
# Create reply_submissions table

1. New Tables
- `reply_submissions`
  - `id` (uuid, primary key)
  - `tweet_url` (text, not null) - URL of the tweet reply as proof
  - `wallet_address` (text, not null) - Solana wallet address for USDC payouts
  - `created_at` (timestamp)

2. Security
- Enable RLS on `reply_submissions`.
- Allow anon + authenticated full CRUD (public submissions, no auth required).
*/

CREATE TABLE IF NOT EXISTS reply_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_url text NOT NULL,
  wallet_address text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reply_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reply_submissions" ON reply_submissions;
CREATE POLICY "anon_select_reply_submissions" ON reply_submissions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_reply_submissions" ON reply_submissions;
CREATE POLICY "anon_insert_reply_submissions" ON reply_submissions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_reply_submissions" ON reply_submissions;
CREATE POLICY "anon_update_reply_submissions" ON reply_submissions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_reply_submissions" ON reply_submissions;
CREATE POLICY "anon_delete_reply_submissions" ON reply_submissions FOR DELETE
  TO anon, authenticated USING (true);
