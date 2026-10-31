ALTER TABLE skus ADD COLUMN image text NOT NULL DEFAULT '';
--> statement-breakpoint
-- Only the three established catalogue assets are mapped. Customized product
-- images remain untouched, and no new SKU, price or stock is introduced.
UPDATE skus SET image=CASE id
 WHEN 'tin-50' THEN '/assets/tin.jpg'
 WHEN 'pouch-50' THEN '/assets/pouch50.jpg'
 WHEN 'pouch-100' THEN '/assets/pouch100.jpg' END
WHERE image='' AND (
 (id='tin-50' AND product_id='matcha-tin' AND label='50g') OR
 (id='pouch-50' AND product_id='matcha-pouch' AND label='50g') OR
 (id='pouch-100' AND product_id='matcha-pouch' AND label='100g')
) AND EXISTS (
 SELECT 1 FROM products,json_each(products.data,'$.images') AS image
 WHERE products.id=skus.product_id AND image.value=CASE skus.id
  WHEN 'tin-50' THEN '/assets/tin.jpg'
  WHEN 'pouch-50' THEN '/assets/pouch50.jpg'
  WHEN 'pouch-100' THEN '/assets/pouch100.jpg' END
);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN expires_at text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN cancellation_reason text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE orders SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+30 minutes')
WHERE status='pending_payment' AND payment_status='unpaid';
--> statement-breakpoint
CREATE INDEX orders_expiry ON orders (status,payment_status,expires_at);
--> statement-breakpoint
-- The insert trigger also runs before UPSERT conflict handling. A SKU can never
-- be claimed by another product, even if both requests passed their preflight.
CREATE TRIGGER sku_insert_ownership BEFORE INSERT ON skus
WHEN EXISTS (SELECT 1 FROM skus WHERE id=NEW.id AND product_id<>NEW.product_id)
BEGIN
 SELECT RAISE(ABORT,'sku_ownership_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER sku_update_ownership BEFORE UPDATE OF product_id ON skus
WHEN OLD.product_id<>NEW.product_id
BEGIN
 SELECT RAISE(ABORT,'sku_ownership_conflict');
END;
--> statement-breakpoint
DROP TRIGGER order_items_reserve;
--> statement-breakpoint
CREATE TRIGGER order_items_reserve BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NEW.quantity<=0 OR NOT EXISTS (
   SELECT 1 FROM skus JOIN products ON products.id=skus.product_id
   JOIN records ON records.id=json_extract(products.data,'$.category') AND records.kind='categories'
   WHERE skus.id=NEW.sku_id AND skus.active=1 AND skus.stock>=NEW.quantity AND skus.price=NEW.price
     AND json_extract(products.data,'$.status')='active' AND json_extract(records.data,'$.status')='active'
 ) THEN RAISE(ABORT,'unavailable_stock_or_price') END;
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM orders WHERE id=NEW.order_id AND status='pending_payment' AND payment_status='unpaid'
     AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 ) THEN RAISE(ABORT,'invalid_reservation') END;
 UPDATE skus SET stock=stock-NEW.quantity WHERE id=NEW.sku_id;
END;
--> statement-breakpoint
DROP TRIGGER order_cancel_restore;
--> statement-breakpoint
CREATE TRIGGER order_cancel_restore AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status IN ('pending_payment','processing') BEGIN
 UPDATE skus SET stock=stock+(
   SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=NEW.id AND sku_id=skus.id
 ) WHERE id IN (SELECT sku_id FROM order_items WHERE order_id=NEW.id);
END;
--> statement-breakpoint
-- Expiry and its audit entry commit atomically with stock restoration.
CREATE TRIGGER order_expiry_audit AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status='pending_payment' AND NEW.cancellation_reason='expired'
BEGIN
 INSERT INTO audit_logs (id,actor,action,target,detail,created_at)
 VALUES (lower(hex(randomblob(16))),'system','order.expire',NEW.id,
   json_object('outcome','success','from',OLD.status,'to',NEW.status,'expiresAt',NEW.expires_at),
   strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
