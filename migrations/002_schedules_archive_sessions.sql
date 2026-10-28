-- Habit schedules, archiving, and revocable login sessions.

-- Bumping token_version signs the user out everywhere (used by "change password" and "log out everywhere").
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- frequency: 'daily' (every day), 'days' (chosen weekdays, 0 = Sunday ... 6 = Saturday), 'weekly' (N times a week)
ALTER TABLE habits ADD COLUMN IF NOT EXISTS frequency       TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS days_of_week    SMALLINT[];
ALTER TABLE habits ADD COLUMN IF NOT EXISTS times_per_week  SMALLINT;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_frequency_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_frequency_valid CHECK (frequency IN ('daily', 'days', 'weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_days_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_days_valid CHECK (
      frequency <> 'days' OR (
        days_of_week IS NOT NULL
        AND cardinality(days_of_week) BETWEEN 1 AND 7
        AND days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_weekly_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_weekly_valid CHECK (
      frequency <> 'weekly' OR (times_per_week IS NOT NULL AND times_per_week BETWEEN 1 AND 7)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_habits_user_archived ON habits(user_id, archived_at);
