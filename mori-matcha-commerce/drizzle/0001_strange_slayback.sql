CREATE TABLE `inventory_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`sku_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER manual_stock_adjustment BEFORE INSERT ON inventory_adjustments BEGIN
 SELECT CASE WHEN NEW.delta = 0 OR (SELECT stock FROM skus WHERE id=NEW.sku_id) IS NULL OR (SELECT stock FROM skus WHERE id=NEW.sku_id)+NEW.delta < 0 THEN RAISE(ABORT, 'invalid_stock_adjustment') END;
 UPDATE skus SET stock=stock+NEW.delta WHERE id=NEW.sku_id;
END;
