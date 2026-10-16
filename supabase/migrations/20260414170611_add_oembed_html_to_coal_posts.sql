/*
  # Add oembed_html cache column to coal_posts

  1. Changes
    - `coal_posts` table gets a new nullable `oembed_html` (text) column
      - Stores the raw HTML from X's oEmbed API, fetched once at post-submit time
      - When present, the frontend renders a srcdoc iframe immediately, skipping
        the slow widgets.js path entirely
      - NULL for posts submitted before this migration (legacy fallback behaviour)

  2. Security
    - The existing "Visitors can insert coal posts" policy already uses WITH CHECK,
      so the new nullable column requires no policy changes.
    - The existing "Allow vote count updates on coal posts" UPDATE policy remains
      unchanged; it will simply pass-through the oembed_html field.

  3. Notes
    - No data migration needed; NULL falls back gracefully to the lazy-load path.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'coal_posts' AND column_name = 'oembed_html'
  ) THEN
    ALTER TABLE coal_posts ADD COLUMN oembed_html text;
  END IF;
END $$;
