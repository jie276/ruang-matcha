import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const skus = sqliteTable("skus", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  label: text("label").notNull(),
  image: text("image").notNull().default(""),
  price: integer("price").notNull(),
  stock: integer("stock").notNull().default(0),
  active: integer("active").notNull().default(1),
});
export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const admins = sqliteTable("admins", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
});
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    data: text("data").notNull(),
    total: integer("total").notNull(),
    status: text("status").notNull().default("pending_payment"),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    createdAt: text("created_at").notNull(),
    isDemo: integer("is_demo").notNull().default(1),
    expiresAt: text("expires_at"),
    cancellationReason: text("cancellation_reason").notNull().default(""),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    uniqueIndex("order_idempotency").on(t.ownerId, t.idempotencyKey),
    index("orders_expiry").on(t.status, t.paymentStatus, t.expiresAt),
  ],
);
export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  skuId: text("sku_id")
    .notNull()
    .references(() => skus.id),
  quantity: integer("quantity").notNull(),
  price: integer("price").notNull(),
});
export const audit = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  window: integer("window").notNull(),
});
export const inventoryAdjustments = sqliteTable("inventory_adjustments", {
  id: text("id").primaryKey(),
  skuId: text("sku_id")
    .notNull()
    .references(() => skus.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  // Legacy adjustments retain their original display name without guessing an account.
  actorUserId: text("actor_user_id"),
  createdAt: text("created_at").notNull(),
});
