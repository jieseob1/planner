-- Additive: legacy tasks remain undated; explicit inbox is 'later'.
ALTER TABLE planner_task ADD COLUMN planned_date VARCHAR(10) NULL;
