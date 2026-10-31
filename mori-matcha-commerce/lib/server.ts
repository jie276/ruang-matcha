import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  sampleProducts,
  defaultHero,
  roles,
  type Product,
  type Variant,
} from "./model";
import type {
  RecordTypes,
  RecordKind,
  RecordMeta,
  ProductRow,
} from "./commerce-records";
export const db = () => {
  if (!env.DB) throw new Error("数据库未配置");
  return env.DB;
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const sql = (query: string, ...values: unknown[]) =>
  db()
    .prepare(query)
    .bind(...values);
export const json = (value: unknown) => JSON.stringify(value);
export const ORDER_RESERVATION_MINUTES = 30;
export function fail(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), {
    status,
    ...(code ? { code } : {}),
  });
}
export async function identity() {
  const user = await getChatGPTUser();
  if (!user) fail("请先登录", 401);
  return user;
}
export async function admin(permission?: string) {
  const user = await identity();
  const account = await sql(
    "SELECT * FROM admins WHERE user_id=? AND active=1",
    user.userId,
  ).first<{
    user_id: string;
    email: string;
    name: string;
    role: string;
    active: number;
  }>();
  if (!account) fail("该账号没有管理员权限", 403);
  if (
    permission &&
    !roles[account.role]?.includes("*") &&
    !roles[account.role]?.includes(permission)
  ) {
    fail("当前角色无权进行此操作", 403);
  }
  return { ...account, userId: user.userId };
}
export function log(
  actor: string,
  action: string,
  target: string,
  detail: unknown = {},
) {
  return sql(
    "INSERT INTO audit_logs (id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)",
    uid(),
    actor,
    action,
    target,
    json(detail),
    now(),
  );
}
// Keep this immediately after its mutation in the same D1 batch. Trigger work does
// not affect changes(); SQLite restores that value when each trigger finishes.
export function mutationLog(
  actor: string,
  action: string,
  target: string,
  detail: unknown = {},
  condition = "changes()>0",
  values: unknown[] = [],
) {
  return sql(
    `INSERT INTO audit_logs (id,actor,action,target,detail,created_at)
     SELECT ?,?,CASE WHEN success THEN ? ELSE ? END,?,
       json_set(?,'$.outcome',CASE WHEN success THEN 'success' ELSE 'conflict' END),?
     FROM (SELECT ${condition} AS success)`,
    uid(),
    actor,
    action,
    action + ".conflict",
    target,
    json(detail),
    now(),
    ...values,
  );
}
// Request-triggered cleanup: the first catalogue/order/admin read after the
// deadline releases a reservation. This is not a wall-clock scheduler.
export async function expirePendingOrders() {
  await sql(
    `UPDATE orders SET status='cancelled',cancellation_reason='expired',revision=revision+1
     WHERE status='pending_payment' AND payment_status='unpaid' AND expires_at<=?`,
    now(),
  ).run();
}
export async function getProducts(activeOnly = false): Promise<Product[]> {
  const [{ results: products }, { results: skus }] = await Promise.all([
    sql(
      activeOnly
        ? `SELECT products.* FROM products JOIN records ON records.id=json_extract(products.data,'$.category')
         AND records.kind='categories' AND json_extract(records.data,'$.status')='active'
         WHERE json_extract(products.data,'$.status')='active'`
        : "SELECT * FROM products",
    ).all<ProductRow>(),
    sql("SELECT id,product_id,label,price,stock,active,image FROM skus").all<
      Variant & {
        product_id: string;
      }
    >(),
  ]);
  return products.map((product) => ({
    ...JSON.parse(product.data),
    id: product.id,
    revision: product.revision,
    variants: skus
      .filter((variant) => variant.product_id === product.id)
      .map(({ id, label, price, stock, active, image }) => ({
        id,
        label,
        price,
        stock,
        active,
        image,
      })),
  }));
}
export async function getRecords<K extends RecordKind>(
  kind: K,
): Promise<Array<RecordTypes[K] & RecordMeta>> {
  const { results } = await sql(
    "SELECT * FROM records WHERE kind=? ORDER BY rowid DESC",
    kind,
  ).all<ProductRow>();
  return results.map((record) => ({
    ...(JSON.parse(record.data) as RecordTypes[K]),
    id: record.id,
    revision: record.revision,
  }));
}
export async function seed(actor: string) {
  const statements: D1PreparedStatement[] = [];
  for (const product of sampleProducts) {
    const { variants, ...meta } = product;
    statements.push(
      sql(
        "INSERT OR IGNORE INTO products (id,data,revision) VALUES (?,?,1)",
        product.id,
        json(meta),
      ),
    );
    for (const variant of variants) {
      statements.push(
        sql(
          "INSERT OR IGNORE INTO skus (id,product_id,label,price,stock,active,image) VALUES (?,?,?,?,?,?,?)",
          variant.id,
          product.id,
          variant.label,
          variant.price,
          variant.stock,
          variant.active ?? 1,
          variant.image || "",
        ),
      );
    }
  }
  for (const [id, kind, data] of [
    ["hero", "content", defaultHero],
    [
      "tin",
      "categories",
      { name: "罐装抹茶", nameEN: "Tins", nameMS: "", status: "active" },
    ],
    [
      "pouch",
      "categories",
      { name: "袋装抹茶", nameEN: "Pouches", nameMS: "", status: "active" },
    ],
    [
      "shipping-default",
      "shipping",
      {
        name: "马来西亚标准配送",
        fee: 600,
        freeAbove: 8000,
        countries: "MY",
        status: "active",
      },
    ],
    [
      "store",
      "settings",
      {
        name: "Mori Matcha",
        currency: "MYR",
        contact: "",
        lowStock: 10,
        shopeeUrl: "",
        tiktokUrl: "",
        whatsappUrl: "",
        announcement: "来自贵州铜仁的一抹绿意",
        returnsPolicy:
          "如需售后，请在订单详情提交申请并描述问题。具体退换条件以上线时公布的政策为准。",
        privacyPolicy: "本预览仅用于测试，请勿填写真实个人信息。",
      },
    ],
  ] as Array<[string, string, unknown]>) {
    statements.push(
      sql(
        "INSERT OR IGNORE INTO records (id,kind,data,revision) VALUES (?,?,?,1)",
        id,
        kind,
        json(data),
      ),
    );
  }
  statements.push(log(actor, "initialize", "store"));
  await db().batch(statements);
}
export function safeImage(value: string) {
  if (value.startsWith("/assets/") || value.startsWith("/api/v1/media/"))
    return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
export async function limits(key: string, max: number, seconds = 900) {
  const window = Math.floor(Date.now() / 1000 / seconds);
  const result = await sql(
    `INSERT INTO rate_limits (key,attempts,window) VALUES (?,1,?)
     ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,
     window=excluded.window RETURNING attempts`,
    key,
    window,
  ).first<{
    attempts: number;
  }>();
  if (result && result.attempts > max) fail("操作过于频繁，请稍后再试", 429);
}
