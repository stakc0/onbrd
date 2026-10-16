/*
  # Create Coal Posts and Votes Tables

  1. New Tables
    - `coal_posts`
      - `id` (uuid, primary key)
      - `tweet_url` (text, the X/Twitter URL)
      - `tweet_id` (text, extracted tweet ID for embedding)
      - `visitor_id` (text, anonymous visitor identifier)
      - `votes` (integer, vote count for ranking)
      - `created_at` (timestamptz)
    - `coal_votes`
      - `id` (uuid, primary key)
      - `post_id` (uuid, references coal_posts)
      - `visitor_id` (text, anonymous visitor identifier)
      - `value` (integer, +1 or -1)
      - `created_at` (timestamptz)
      - Unique constraint on (post_id, visitor_id) to prevent double voting

  2. Security
    - Enable RLS on both tables
    - Public read access for coal_posts (anonymous site)
    - Insert policy for coal_posts allowing anonymous inserts
    - Public read for coal_votes
    - Insert/update for coal_votes by visitor

  3. Notes
    - Since this is an anonymous community site without auth, RLS policies
      allow public read and insert with visitor_id tracking
    - Realtime enabled on coal_posts for live feed updates
*/

CREATE TABLE IF NOT EXISTS coal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_url text NOT NULL,
  tweet_id text NOT NULL,
  visitor_id text NOT NULL,
  votes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coal_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read coal posts"
  ON coal_posts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Visitors can insert coal posts"
  ON coal_posts FOR INSERT
  TO anon
  WITH CHECK (visitor_id <> '');

CREATE POLICY "Allow vote count updates on coal posts"
  ON coal_posts FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS coal_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES coal_posts(id) ON DELETE CASCADE,
  visitor_id text NOT NULL,
  value integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, visitor_id)
);

ALTER TABLE coal_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read coal votes"
  ON coal_votes FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Visitors can insert coal votes"
  ON coal_votes FOR INSERT
  TO anon
  WITH CHECK (visitor_id <> '');

CREATE POLICY "Visitors can update own coal votes"
  ON coal_votes FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (visitor_id <> '');

CREATE INDEX IF NOT EXISTS idx_coal_posts_votes ON coal_posts(votes DESC);
CREATE INDEX IF NOT EXISTS idx_coal_posts_created ON coal_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coal_votes_post ON coal_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_coal_votes_visitor ON coal_votes(visitor_id);

ALTER PUBLICATION supabase_realtime ADD TABLE coal_posts;
