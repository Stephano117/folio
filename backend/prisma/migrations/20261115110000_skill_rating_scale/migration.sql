UPDATE "Skill"
SET "level" = GREATEST(1, LEAST(5, ROUND("level"::numeric / 20)::integer))
WHERE "level" > 5;

ALTER TABLE "Skill"
ALTER COLUMN "level" SET DEFAULT 3;
