/*
  # Create Trenchible Laws and Submissions Tables

  ## Summary
  This migration creates the core data structure for Trenchible, a rulebook site
  for attention market laws in crypto trading.

  ## New Tables

  ### `laws`
  - `id` (uuid, primary key) - Unique identifier
  - `number` (integer, unique) - Padded law number (001, 002, etc.)
  - `title` (text) - Law title
  - `body` (text) - Full law text
  - `category` (text) - Category tag (Tech, Narrative, Developer, Bundling, Psychology)
  - `status` (text) - 'approved' or 'pending', defaults to 'approved'
  - `created_at` (timestamptz) - Timestamp of creation

  ### `law_submissions`
  - `id` (uuid, primary key) - Unique identifier
  - `title` (text) - Submitted law title
  - `body` (text) - Submitted law body text
  - `category` (text) - Submitted category
  - `status` (text) - Always 'pending' on insert, reviewed before approval
  - `created_at` (timestamptz) - Timestamp of submission

  ## Security
  - RLS enabled on both tables
  - `laws`: Public SELECT access for approved laws only
  - `law_submissions`: Public INSERT access for anonymous submissions; no public SELECT

  ## Seed Data
  - Five initial laws seeded from the Trenchible founding codex
*/

CREATE TABLE IF NOT EXISTS laws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer UNIQUE NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE laws ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read approved laws"
  ON laws FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE TABLE IF NOT EXISTS law_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE law_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a law"
  ON law_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(trim(title)) > 0
    AND length(trim(body)) > 0
    AND length(trim(category)) > 0
  );

INSERT INTO laws (number, title, body, category, status) VALUES
(1,
 'The GitHub Endorsement Principle',
 'When fees are directed to GitHub, the project will run. The mechanism is direct: the act of claiming those fees is a public endorsement by the developer. It signals skin in the game. The market reads it accordingly. A developer who routes fees to their own repository has committed — and that commitment is visible to anyone who looks.',
 'Tech',
 'approved'),
(2,
 'The Mega Viral Threshold',
 'Narratives live and die on X. To qualify, they must clear a high bar — not merely trending, but undeniably viral with a clever angle that makes the spread feel inevitable. Animal runners fall under this category; for these, cashback is the correct fee distribution model. Discovery method: search X directly. If you have to ask whether it is viral enough, it is not.',
 'Narrative',
 'approved'),
(3,
 'The Developer Entry Pattern',
 'Developer wallets enter narrative plays at two to three SOL. They do not hold through noise — they sell into volume. This is the pattern. The entry size is a signal, not a coincidence. Recognise it early and you are reading intent. Miss it and you are the exit.',
 'Developer',
 'approved'),
(4,
 'Bundling is Natural Selection',
 'The trenches have pushed every participant — traders, developers, platforms — toward multi-walleting as a mechanism to extract more revenue. There is no rulebook governing this. It is an art. If you are caught by it, that is the market''s judgement on your due diligence. One truth holds: bundled coins do not run unless the coin itself is worth running. The bundle is not the problem. The coin is the problem.',
 'Bundling',
 'approved'),
(5,
 'The KOL Catalyst',
 'Narrative coins do not move without a KOL buy. This is an information cascade in action — nobody in the trenches commits capital until someone credible validates the move first. That validation triggers the herd. The KOL is not a nice-to-have; they are the ignition. Without them, the narrative stalls. With them, the crowd follows before they understand why.',
 'Psychology',
 'approved');
