-- Absolute dates make one-off planner blocks stable as the current week advances.
-- Existing rows deliberately remain NULL: their original calendar date cannot be reconstructed
-- safely from a relative week offset at migration time. NULL is the explicit legacy sentinel;
-- services keep those rows readable but do not schedule or newly export them as repeating events.
ALTER TABLE planner_time_block
    ADD COLUMN block_date DATE NULL AFTER week_offset,
    ADD KEY planner_time_block_date_overlap_idx (user_id, block_date, start_minutes);

DROP TRIGGER IF EXISTS planner_time_block_overlap_insert;
DROP TRIGGER IF EXISTS planner_time_block_overlap_update;

DELIMITER $$

CREATE TRIGGER planner_time_block_overlap_insert
BEFORE INSERT ON planner_time_block
FOR EACH ROW
BEGIN
    IF NEW.external = FALSE AND EXISTS (
        SELECT 1 FROM planner_time_block existing
        WHERE existing.user_id = NEW.user_id
          AND existing.external = FALSE
          AND (
              (NEW.block_date IS NOT NULL AND existing.block_date = NEW.block_date)
              OR (
                  NEW.block_date IS NULL
                  AND existing.block_date IS NULL
                  AND existing.week_offset = NEW.week_offset
                  AND existing.day_key = NEW.day_key
              )
          )
          AND existing.start_minutes < NEW.start_minutes + NEW.duration_minutes
          AND NEW.start_minutes < existing.start_minutes + existing.duration_minutes
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'planner time blocks overlap';
    END IF;
END$$

CREATE TRIGGER planner_time_block_overlap_update
BEFORE UPDATE ON planner_time_block
FOR EACH ROW
BEGIN
    IF NEW.external = FALSE AND EXISTS (
        SELECT 1 FROM planner_time_block existing
        WHERE existing.user_id = NEW.user_id
          AND existing.block_id <> NEW.block_id
          AND existing.external = FALSE
          AND (
              (NEW.block_date IS NOT NULL AND existing.block_date = NEW.block_date)
              OR (
                  NEW.block_date IS NULL
                  AND existing.block_date IS NULL
                  AND existing.week_offset = NEW.week_offset
                  AND existing.day_key = NEW.day_key
              )
          )
          AND existing.start_minutes < NEW.start_minutes + NEW.duration_minutes
          AND NEW.start_minutes < existing.start_minutes + existing.duration_minutes
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'planner time blocks overlap';
    END IF;
END$$

DELIMITER ;
