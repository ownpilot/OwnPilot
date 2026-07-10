-- Claw fixes migration
-- 1. Fix mode column default: 'cyclic' is not a valid ClawMode, correct to 'continuous'
-- 2. Fix any existing rows stuck with mode='cyclic'

ALTER TABLE claws ALTER COLUMN mode SET DEFAULT 'continuous';

UPDATE claws SET mode = 'continuous' WHERE mode = 'cyclic';
