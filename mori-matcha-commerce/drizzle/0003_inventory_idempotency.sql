-- Existing adjustment IDs remain unchanged. New requests use their operationId
-- as the primary key; historical rows keep a NULL account rather than guessing
-- ownership from the actor display name. Stock and its trigger are unchanged.
ALTER TABLE `inventory_adjustments` ADD `actor_user_id` text;
