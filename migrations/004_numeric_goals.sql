-- Numeric goals: a habit can have a daily target ("8" "glasses"), and an entry records how much was done.
-- An entry counts as completed when its value reaches the target.
ALTER TABLE habits  ADD COLUMN IF NOT EXISTS target NUMERIC(10, 2);
ALTER TABLE habits  ADD COLUMN IF NOT EXISTS unit   TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS value  NUMERIC(10, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_target_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_target_valid CHECK (target IS NULL OR target > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_unit_valid') THEN
    ALTER TABLE habits ADD CONSTRAINT habits_unit_valid CHECK (
      unit IS NULL OR (target IS NOT NULL AND char_length(unit) BETWEEN 1 AND 20 AND unit = btrim(unit))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entries_value_valid') THEN
    ALTER TABLE entries ADD CONSTRAINT entries_value_valid CHECK (value IS NULL OR value >= 0);
  END IF;
END $$;
