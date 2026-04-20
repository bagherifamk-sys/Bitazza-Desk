-- Migration 009: rename category value 'ai_handling' → 'unclassified'
-- 'ai_handling' was a misnomer — it was the default category assigned to tickets
-- before the customer selects an issue type, not a real issue category.

UPDATE tickets
SET category = 'unclassified'
WHERE category = 'ai_handling';
