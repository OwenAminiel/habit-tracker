-- Optional category (a short label such as "Health" or "Study") to group habits.
ALTER TABLE habits ADD COLUMN IF NOT EXISTS category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_category_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_category_valid CHECK (
      category IS NULL OR (char_length(category) BETWEEN 1 AND 30 AND category = btrim(category))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_habits_user_category ON habits(user_id, LOWER(category));
