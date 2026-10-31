import { z } from "zod";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  db,
  sql,
  uid,
  now,
  json,
  fail,
  admin,
  identity,
  log,
  getProducts,
  getRecords,
  seed,
  safeImage,
  limits,
  mutationLog,
  expirePendingOrders,
  ORDER_RESERVATION_MINUTES,
} from "./server";
import type { OrderRow, OrderSnapshot, ProductRow, RecordKind } from "./commerce-records";
import { sampleProducts, defaultHero, roles } from "./model";
const txt = z.string().trim().max(5000),
  short = z.string().trim().min(1).max(160),
  amount = z.number().int().min(0).max(100000000);
const image = z
  .string()
  .max(2000)
  .refine(safeImage, "仅支持本站图片或 HTTPS 图片");
const externalUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .max(2000)
      .url()
      .refine(
        (value) => new URL(value).protocol === "https:",
        "仅支持 HTTPS 链接",
      ),
  ])
  .default("");
const variantSchema = z
  .object({
    id: short,
    label: z.string().trim().max(160),
    image: z.union([z.literal(""), image]).default(""),
    price: amount,
    stock: amount.max(10000000),
    active: z.number().int().min(0).max(1).default(1),
  })
  .refine(
    (value) => !value.active || (value.label.length > 0 && value.price > 0),
    "启用规格必须填写名称和大于零的价格",
  );
const productSchema = z.object({
  id: short.optional(),
  revision: z.number().int().optional(),
  name: short,
  nameEN: txt.default(""),
  nameMS: txt.default(""),
  description: txt,
  descriptionEN: txt.default(""),
  descriptionMS: txt.default(""),
  category: z.string().trim().max(160),
  images: z.array(image).max(12),
  detailImages: z.array(image).max(20).default([]),
  origin: txt,
  storage: txt,
  ingredients: txt,
  status: z.enum(["active", "draft", "archived"]),
  variants: z.array(variantSchema).min(1).max(30),
});
const schemas: Record<string, z.ZodTypeAny> = {
  categories: z.object({
    name: short,
    nameEN: txt.default(""),
    nameMS: txt.default(""),
    status: z.enum(["active", "disabled"]),
  }),
  coupons: z.object({
    name: short,
    code: short.transform((s) => s.toUpperCase()),
    discount: amount,
    minimum: amount,
    expires: z.string().datetime(),
    status: z.enum(["active", "disabled"]),
  }),
  shipping: z.object({
    name: short,
    fee: amount,
    freeAbove: amount,
    countries: z.literal("MY"),
    status: z.enum(["active", "disabled"]),
  }),
  content: z.object({
    title: short,
    titleEN: txt.default(""),
    titleMS: txt.default(""),
    description: txt,
    descriptionEN: txt.default(""),
    descriptionMS: txt.default(""),
    image,
    enabled: z.boolean(),
  }),
  settings: z.object({
    name: short,
    currency: z.literal("MYR"),
    contact: txt,
    shopeeUrl: externalUrl,
    tiktokUrl: externalUrl,
    whatsappUrl: externalUrl,
    lowStock: amount.max(10000),
    announcement: txt,
    returnsPolicy: txt,
    privacyPolicy: txt,
  }),
  customers: z.object({
    userId: short,
    name: short,
    email: z.string().email(),
    tags: txt,
    note: txt,
    status: z.enum(["active", "disabled"]),
  }),
};
const parseAdminOrder = (r: OrderRow) => ({
  ...(JSON.parse(r.data) as OrderSnapshot),
  id: r.id,
  idempotencyKey: r.idempotency_key,
  total: r.total,
  status: r.status,
  paymentStatus: r.payment_status,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  cancellationReason: r.cancellation_reason,
  revision: r.revision,
  isDemo: !!r.is_demo,
});
// Customer responses are an allowlist, including nested snapshots. New internal
// fields must remain private even when an existing order is returned on retry.
const customerOrder = (order: ReturnType<typeof parseAdminOrder>) => ({
  id: order.id,
  idempotencyKey: order.idempotencyKey,
  total: order.total,
  status: order.status,
  paymentStatus: order.paymentStatus,
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  cancellationReason: order.cancellationReason,
  revision: order.revision,
  isDemo: order.isDemo,
  subtotal: order.subtotal,
  discount: order.discount,
  coupon: order.coupon,
  shippingFee: order.shippingFee,
  shippingName: order.shippingName,
  carrier: order.carrier,
  tracking: order.tracking,
  customer: {
    name: order.customer.name,
    phone: order.customer.phone,
    email: order.customer.email,
    address: order.customer.address,
    city: order.customer.city,
    state: order.customer.state,
    postcode: order.customer.postcode,
    note: order.customer.note,
  },
  items: order.items.map((item) => ({
    skuId: item.skuId,
    productId: item.productId,
    name: item.name,
    label: item.label,
    image: item.image,
    price: item.price,
    quantity: item.quantity,
  })),
});
const parseCustomerOrder = (r: OrderRow) => customerOrder(parseAdminOrder(r));
function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin)
    fail("请求来源校验失败", 403);
}
async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 150000)
    fail("请求内容过大", 413);
  const s = await req.text();
  if (s.length > 150000) fail("请求内容过大", 413);
  return JSON.parse(s);
}
async function validateCoupon(code: string, subtotal: number) {
  if (!code) return { discount: 0 };
  const rows = await getRecords("coupons");
  const c = rows.find(
    (x) => x.code === code.toUpperCase() && x.status === "active",
  );
  if (!c || new Date(c.expires).getTime() < Date.now() || subtotal < c.minimum)
    fail("优惠码不可用、已过期或未达到使用门槛");
  return {
    discount: Math.min(c.discount, subtotal),
    coupon: code.toUpperCase(),
  };
}
export async function handle(req: Request, path: string[]) {
  const p = path.join("/"),
    method = req.method;
  const mutating = !["GET", "HEAD"].includes(method);
  if (mutating) checkOrigin(req);
  if (
    p === "catalog" ||
    p === "orders" ||
    p.startsWith("orders/") ||
    p === "admin/bootstrap" ||
    p === "admin/orders" ||
    p.startsWith("admin/orders/") ||
    p === "admin/products" ||
    p === "admin/inventory" ||
    p === "admin/reports"
  )
    await expirePendingOrders();
  if (p.startsWith("media/") && method === "GET") {
    const key = path[1];
    if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(key)) fail("图片不存在", 404);
    const obj = await env.BUCKET?.get(key);
    if (!obj) fail("图片不存在", 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public,max-age=31536000,immutable",
      },
    });
  }
  if (p === "session" && method === "GET") {
    const u = await getChatGPTUser();
    const a = u
      ? await sql(
          "SELECT role,active FROM admins WHERE user_id=?",
          u.userId,
        ).first<{
          role: string;
          active: number;
        }>()
      : null;
    return {
      user: u ? { id: u.userId, name: u.displayName, email: u.email } : null,
      isAdmin: !!a?.active,
      role: a?.active ? a.role : null,
    };
  }
  if (p === "catalog" && method === "GET") {
    const ready = !!(await sql(
      "SELECT value FROM config WHERE key='seeded'",
    ).first());
    const ps = await getProducts(true);
    const [content, categories, shipping, settings, reviews] =
      await Promise.all([
        getRecords("content"),
        getRecords("categories"),
        getRecords("shipping"),
        getRecords("settings"),
        getRecords("reviews"),
      ]);
    return {
      products: (ready ? ps : sampleProducts)
        .filter((p) => p.variants.some((v) => v.active !== 0))
        .map((p) => ({
          id: p.id,
          name: p.name,
          nameEN: p.nameEN,
          nameMS: p.nameMS || "",
          description: p.description,
          descriptionEN: p.descriptionEN,
          descriptionMS: p.descriptionMS || "",
          category: p.category,
          images: p.images,
          detailImages: p.detailImages,
          origin: p.origin,
          storage: p.storage,
          ingredients: p.ingredients,
          status: p.status,
          variants: p.variants.filter((v) => v.active !== 0),
        })),
      hero: content.find((x) => x.id === "hero") || defaultHero,
      categories: categories.filter((x) => x.status === "active"),
      shipping: shipping.filter((x) => x.status === "active"),
      settings: settings[0]
        ? {
            name: settings[0].name,
            contact: settings[0].contact,
            shopeeUrl: settings[0].shopeeUrl || "",
            tiktokUrl: settings[0].tiktokUrl || "",
            whatsappUrl: settings[0].whatsappUrl || "",
            announcement: settings[0].announcement,
            returnsPolicy: settings[0].returnsPolicy,
            privacyPolicy: settings[0].privacyPolicy,
          }
        : null,
      reviews: reviews
        .filter((x) => x.status === "published")
        .map(({ id, productId, rating, text, reply }) => ({
          id,
          productId,
          rating,
          text,
          reply: reply || "",
        })),
      ready,
      demo: true,
    };
  }
  if (p === "admin/activate" && method === "POST") {
    const u = await identity();
    await limits("activate:" + u.userId, 5);
    const b = z.object({ code: short }).parse(await body(req));
    const secret = env.ADMIN_ACTIVATION_CODE;
    if (!secret || b.code !== secret) fail("激活码不正确", 403);
    await db().batch([
      sql(
        "INSERT OR IGNORE INTO config (key,value) VALUES ('owner_id',?)",
        u.userId,
      ),
      sql(
        "INSERT OR IGNORE INTO admins (user_id,email,name,role,active) SELECT ?,?,?,'owner',1 WHERE (SELECT value FROM config WHERE key='owner_id')=?",
        u.userId,
        u.email,
        u.displayName,
        u.userId,
      ),
    ]);
    await admin();
    const seeded = await sql(
      "SELECT value FROM config WHERE key='seeded'",
    ).first();
    if (!seeded) {
      await seed(u.userId);
      await sql(
        "INSERT OR IGNORE INTO config (key,value) VALUES ('seeded','1')",
      ).run();
    }
    return { activated: true };
  }
  if (p.startsWith("payments/") || p.startsWith("webhooks/"))
    fail("尚未配置支付或物流服务", 503);
  if (p === "coupon/quote" && method === "POST") {
    const b = z
      .object({ code: short, subtotal: amount })
      .parse(await body(req));
    return validateCoupon(b.code, b.subtotal);
  }
  if (p === "orders" && method === "GET") {
    const u = await identity();
    const { results } = await sql(
      "SELECT * FROM orders WHERE owner_id=? ORDER BY created_at DESC LIMIT 200",
      u.userId,
    ).all<OrderRow>();
    return results.map(parseCustomerOrder);
  }
  if (p === "orders" && method === "POST") {
    const u = await identity();
    await limits("checkout:" + u.userId, 30);
    const seeded = await sql(
      "SELECT value FROM config WHERE key='seeded'",
    ).first();
    if (!seeded) fail("商店正在准备中，请稍后再来", 503);
    const b = z
      .object({
        idempotencyKey: z.string().uuid(),
        items: z
          .array(
            z.object({
              skuId: short,
              quantity: z.number().int().min(1).max(100),
            }),
          )
          .min(1)
          .max(30),
        customer: z.object({
          name: short,
          phone: z.string().min(5).max(40),
          email: z.string().email().max(160),
          address: z.string().min(5).max(500),
          city: short,
          state: short,
          postcode: z.string().regex(/^\d{5}$/),
          note: txt.default(""),
        }),
        shippingId: short,
        coupon: txt.default(""),
        acknowledgeDemo: z.literal(true),
      })
      .parse(await body(req));
    const existing = await sql(
      "SELECT * FROM orders WHERE owner_id=? AND idempotency_key=?",
      u.userId,
      b.idempotencyKey,
    ).first<OrderRow>();
    if (existing) return parseCustomerOrder(existing);
    const c = (await getRecords("customers")).find(
      (x) => x.userId === u.userId,
    );
    if (c?.status === "disabled") fail("账号已被限制下单，请联系客服", 403);
    const products = await getProducts(true);
    const quantities = new Map<string, number>();
    for (const i of b.items)
      quantities.set(i.skuId, (quantities.get(i.skuId) || 0) + i.quantity);
    const items = [...quantities].map(([id, quantity]) => {
      const product = products.find((p) =>
        p.variants.some((v) => v.id === id && v.active),
      );
      const sku = product?.variants.find((v) => v.id === id);
      if (!product || !sku || quantity > 100 || sku.stock < quantity)
        fail("部分商品库存不足或已下架", 409);
      return {
        skuId: id,
        productId: product.id,
        name: product.name,
        label: sku.label,
        image: sku.image || product.images[0],
        price: sku.price,
        quantity,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const coupon = await validateCoupon(b.coupon, subtotal);
    const sh = (await getRecords("shipping")).find(
      (x) => x.id === b.shippingId && x.status === "active",
    );
    if (!sh) fail("请选择可用配送方式");
    const shippingFee =
      sh.freeAbove > 0 && subtotal - coupon.discount >= sh.freeAbove
        ? 0
        : sh.fee;
    const total = subtotal - coupon.discount + shippingFee;
    const id = "MM-" + uid().slice(0, 8).toUpperCase();
    const createdAt = now(),
      expiresAt = new Date(
        Date.parse(createdAt) + ORDER_RESERVATION_MINUTES * 60000,
      ).toISOString();
    const data = {
      customer: b.customer,
      items,
      subtotal,
      discount: coupon.discount,
      coupon: b.coupon,
      shippingFee,
      shippingName: sh.name,
      note: "",
      tracking: "",
      carrier: "",
    };
    const statements = [
      sql(
        "INSERT INTO orders (id,owner_id,idempotency_key,data,total,status,payment_status,created_at,is_demo,expires_at) VALUES (?,?,?,?,?,'pending_payment','unpaid',?,1,?)",
        id,
        u.userId,
        b.idempotencyKey,
        json(data),
        total,
        createdAt,
        expiresAt,
      ),
      ...items.map((i) =>
        sql(
          "INSERT INTO order_items (id,order_id,sku_id,quantity,price) VALUES (?,?,?,?,?)",
          uid(),
          id,
          i.skuId,
          i.quantity,
          i.price,
        ),
      ),
      sql(
        "INSERT OR IGNORE INTO records (id,kind,data,revision) VALUES (?,'customers',?,1)",
        "customer-" + u.userId,
        json({
          userId: u.userId,
          name: b.customer.name,
          email: u.email,
          tags: "",
          note: "",
          status: "active",
        }),
      ),
      log(u.userId, "order.create.demo", id, { total }),
    ];
    try {
      await db().batch(statements);
    } catch {
      const retry = await sql(
        "SELECT * FROM orders WHERE owner_id=? AND idempotency_key=?",
        u.userId,
        b.idempotencyKey,
      ).first<OrderRow>();
      if (retry) return parseCustomerOrder(retry);
      fail("库存已变化，请刷新商品后重试", 409);
    }
    return customerOrder({
      id,
      ...data,
      total,
      status: "pending_payment",
      paymentStatus: "unpaid",
      isDemo: true,
      createdAt,
      expiresAt,
      idempotencyKey: b.idempotencyKey,
      cancellationReason: "",
      revision: 1,
    });
  }
  if (path[0] === "orders" && path.length === 3 && method === "POST") {
    const u = await identity();
    const order = await sql(
      "SELECT * FROM orders WHERE id=? AND owner_id=?",
      path[1],
      u.userId,
    ).first<OrderRow>();
    if (!order) fail("订单不存在", 404);
    if (path[2] === "cancel") {
      if (order.status !== "pending_payment")
        fail("当前订单不能直接取消，请提交售后申请", 409);
      const results = await db().batch([
        sql(
          "UPDATE orders SET status='cancelled',cancellation_reason='customer',revision=revision+1 WHERE id=? AND owner_id=? AND status='pending_payment' AND payment_status='unpaid' AND revision=? AND expires_at>?",
          order.id,
          u.userId,
          order.revision,
          now(),
        ),
        mutationLog(u.userId, "order.cancel", order.id),
      ]);
      if (!results[0].meta.changes) fail("订单状态已变化，请刷新", 409);
      return { ok: true };
    }
    if (path[2] === "aftersales") {
      if (["pending_payment", "cancelled"].includes(order.status))
        fail("当前订单无需申请退款，可在待付款时取消");
      const b = z
        .object({ reason: short, description: txt, amount: amount })
        .parse(await body(req));
      if (b.amount > order.total) fail("申请金额不能超过订单总额");
      const list = await getRecords("aftersales");
      if (
        list.some(
          (x) =>
            x.orderId === order.id &&
            !["rejected", "closed"].includes(x.status),
        )
      )
        fail("该订单已有处理中售后");
      const id = uid();
      await db().batch([
        sql(
          "INSERT INTO records (id,kind,data,revision) VALUES (?,'aftersales',?,1)",
          id,
          json({
            ...b,
            orderId: order.id,
            userId: u.userId,
            status: "requested",
            reply: "",
            createdAt: now(),
            isDemo: true,
          }),
        ),
        log(u.userId, "aftersales.request", id),
      ]);
      return { id };
    }
  }
  if (p === "my/aftersales" && method === "GET") {
    const u = await identity();
    return (await getRecords("aftersales")).filter(
      (x) => x.userId === u.userId,
    );
  }
  if (p === "my/addresses" && method === "GET") {
    const u = await identity();
    return (await getRecords("addresses")).filter((x) => x.userId === u.userId);
  }
  if (p === "my/addresses" && method === "POST") {
    const u = await identity();
    const b = z
      .object({
        name: short,
        phone: short,
        address: short,
        city: short,
        state: short,
        postcode: z.string().regex(/^\d{5}$/),
      })
      .parse(await body(req));
    const id = uid();
    if (
      (await getRecords("addresses")).filter((x) => x.userId === u.userId)
        .length >= 20
    )
      fail("最多保存20个地址");
    await sql(
      "INSERT INTO records (id,kind,data,revision) VALUES (?,'addresses',?,1)",
      id,
      json({ ...b, userId: u.userId }),
    ).run();
    return { id };
  }
  if (
    path[0] === "my" &&
    path[1] === "addresses" &&
    path[2] &&
    method === "DELETE"
  ) {
    const u = await identity();
    await sql(
      "DELETE FROM records WHERE id=? AND kind='addresses' AND json_extract(data,'$.userId')=?",
      path[2],
      u.userId,
    ).run();
    return { ok: true };
  }
  if (p === "tickets" && method === "POST") {
    const u = await identity();
    await limits("tickets:" + u.userId, 10);
    const b = z
      .object({ subject: short, message: txt.min(1) })
      .parse(await body(req));
    await sql(
      "INSERT INTO records (id,kind,data,revision) VALUES (?,'tickets',?,1)",
      uid(),
      json({
        ...b,
        userId: u.userId,
        email: u.email,
        status: "requested",
        reply: "",
        createdAt: now(),
      }),
    ).run();
    return { ok: true };
  }
  if (p === "tickets" && method === "GET") {
    const u = await identity();
    return (await getRecords("tickets")).filter((x) => x.userId === u.userId);
  }
  if (p === "reviews" && method === "POST") {
    const u = await identity();
    const b = z
      .object({
        orderId: short,
        productId: short,
        rating: z.number().int().min(1).max(5),
        text: txt.min(1),
      })
      .parse(await body(req));
    const o = await sql(
      "SELECT * FROM orders WHERE id=? AND owner_id=? AND status='completed'",
      b.orderId,
      u.userId,
    ).first<OrderRow>();
    if (
      !o ||
      !JSON.parse(o.data).items.some(
        (i: { productId: string }) => i.productId === b.productId,
      )
    )
      fail("仅可评价自己的已完成订单");
    const id = "review-" + b.orderId + "-" + b.productId;
    await sql(
      "INSERT INTO records (id,kind,data,revision) VALUES (?,'reviews',?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=revision+1",
      id,
      json({
        ...b,
        userId: u.userId,
        status: "pending",
        reply: "",
        createdAt: now(),
      }),
    ).run();
    return { ok: true };
  }
  if (!p.startsWith("admin/")) fail("接口不存在", 404);
  if (p === "admin/bootstrap" && method === "GET") {
    const a = await admin();
    const counts = await sql("SELECT COUNT(*) AS count FROM orders").first<{
      count: number;
    }>();
    return {
      admin: { name: a.name, email: a.email, role: a.role, userId: a.userId },
      permissions: roles[a.role],
      orderCount: counts?.count ?? 0,
      settings:
        (await getRecords("settings")).map(({ name, lowStock }) => ({
          name,
          lowStock,
        }))[0] || null,
    };
  }
  if (p === "admin/products" && method === "GET") {
    await admin("products");
    return getProducts();
  }
  if (p === "admin/products" && (method === "POST" || method === "PATCH")) {
    const a = await admin("products"),
      b = productSchema.parse(await body(req)),
      id = b.id || uid(),
      token = uid();
    if (new Set(b.variants.map((v) => v.id)).size !== b.variants.length)
      fail("SKU 编码不能重复");
    const cat = (await getRecords("categories")).find(
      (c) => c.id === b.category,
    );
    if (b.category && !cat) fail("请选择有效分类");
    if (b.status === "active" && (!cat || cat.status !== "active"))
      fail("上架商品需要启用分类");
    if (b.status === "active" && !b.images.length)
      fail("上架商品至少需要一张图片");
    if (b.status === "active" && !b.variants.some((v) => v.active))
      fail("上架商品至少需要一个启用规格");
    const existing = await sql(
      "SELECT * FROM products WHERE id=?",
      id,
    ).first<ProductRow>();
    if (method === "PATCH" && !existing) fail("商品不存在", 404);
    if (method === "POST" && existing) fail("商品已存在", 409);
    const { variants, revision, ...meta } = b;
    // Re-check the category inside the write transaction. The preflight can
    // become stale while another administrator deletes or disables a category.
    const categoryGuard = `((?='' AND ?<>'active') OR EXISTS (
      SELECT 1 FROM records WHERE kind='categories' AND id=?
      AND (?<>'active' OR json_extract(data,'$.status')='active')
    ))`;
    const categoryValues = [b.category, b.status, b.category, b.status];
    const statements: D1PreparedStatement[] = [
      existing
        ? sql(
            `UPDATE products SET data=?,revision=revision+1 WHERE id=? AND revision=? AND ${categoryGuard}`,
            json({ ...meta, id, mutationId: token }),
            id,
            revision ?? 0,
            ...categoryValues,
          )
        : sql(
            `INSERT INTO products (id,data,revision) SELECT ?,?,1 WHERE ${categoryGuard}`,
            id,
            json({ ...meta, id, mutationId: token }),
            ...categoryValues,
          ),
    ];
    for (const v of variants) {
      const owned = await sql(
        "SELECT product_id FROM skus WHERE id=?",
        v.id,
      ).first<{
        product_id: string;
      }>();
      if (owned && owned.product_id !== id) fail("SKU 编码已被其他商品使用");
      statements.push(
        sql(
          "INSERT INTO skus (id,product_id,label,price,stock,active,image) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND json_extract(data,'$.mutationId')=?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,price=excluded.price,active=excluded.active,image=excluded.image WHERE skus.product_id=excluded.product_id",
          v.id,
          id,
          v.label,
          v.price,
          existing ? 0 : v.stock,
          v.active,
          v.image,
          id,
          token,
        ),
      );
    }
    const keep = variants.map((v) => v.id);
    statements.push(
      sql(
        `UPDATE skus SET active=0 WHERE product_id=? AND id NOT IN (${keep.map(() => "?").join(",")}) AND EXISTS(SELECT 1 FROM products WHERE id=? AND json_extract(data,'$.mutationId')=?)`,
        id,
        ...keep,
        id,
        token,
      ),
    );
    statements.push(
      mutationLog(
        a.userId,
        existing ? "product.update" : "product.create",
        id,
        { name: b.name },
        "EXISTS(SELECT 1 FROM products WHERE id=? AND json_extract(data,'$.mutationId')=?)",
        [id, token],
      ),
    );
    let result;
    try {
      result = await db().batch(statements);
    } catch (error) {
      if (
        /sku_ownership_conflict|UNIQUE constraint failed: (products|skus)\.id/.test(
          String(error),
        )
      ) {
        await log(
          a.userId,
          (existing ? "product.update" : "product.create") + ".conflict",
          id,
          { outcome: "conflict", reason: "sku_or_product_ownership" },
        ).run();
        fail("商品或 SKU 已被其他操作占用，请刷新后重试", 409);
      }
      throw error;
    }
    if (!result[0].meta.changes)
      fail("商品已被其他操作更新，请刷新后重试", 409);
    return { id };
  }
  if (p === "admin/inventory" && method === "GET") {
    await admin("inventory");
    return {
      products: await getProducts(),
      lowStock: (await getRecords("settings"))[0]?.lowStock ?? 10,
      events: (
        await sql(
          "SELECT id,sku_id AS skuId,delta,reason,actor,created_at AS createdAt FROM inventory_adjustments ORDER BY created_at DESC LIMIT 1000",
        ).all()
      ).results,
    };
  }
  if (p === "admin/inventory" && method === "POST") {
    const a = await admin("inventory"),
      b = z
        .object({
          skuId: short,
          delta: z
            .number()
            .int()
            .min(-10000000)
            .max(10000000)
            .refine((n) => n !== 0),
          reason: short,
        })
        .parse(await body(req));
    try {
      await db().batch([
        sql(
          "INSERT INTO inventory_adjustments (id,sku_id,delta,reason,actor,created_at) VALUES (?,?,?,?,?,?)",
          uid(),
          b.skuId,
          b.delta,
          b.reason,
          a.name,
          now(),
        ),
        log(a.userId, "stock.adjust", b.skuId, b),
      ]);
    } catch {
      fail("库存不足或SKU不存在", 409);
    }
    return { ok: true };
  }
  if (p === "admin/orders" && method === "GET") {
    await admin("orders");
    return (
      await sql(
        "SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000",
      ).all<OrderRow>()
    ).results.map(parseAdminOrder);
  }
  if (path[1] === "orders" && path[2] && method === "PATCH") {
    const a = await admin("orders");
    const b = z
      .object({
        action: z.enum(["confirm_demo", "ship", "complete", "cancel", "note"]),
        carrier: txt.optional(),
        tracking: txt.optional(),
        note: txt.optional(),
      })
      .parse(await body(req));
    if (a.role === "finance" && b.action !== "note")
      fail("财务角色仅可查看订单和添加备注", 403);
    const o = await sql(
      "SELECT * FROM orders WHERE id=?",
      path[2],
    ).first<OrderRow>();
    if (!o) fail("订单不存在", 404);
    const data = JSON.parse(o.data);
    let status = o.status,
      payment = o.payment_status;
    if (b.action === "confirm_demo") {
      if (status !== "pending_payment" || !o.is_demo)
        fail("订单不能进行演示确认", 409);
      status = "processing";
      payment = "demo";
    }
    if (b.action === "ship") {
      if (status !== "processing" || !b.carrier || !b.tracking)
        fail("待发货订单需填写承运商和运单号", 409);
      status = "shipped";
      data.carrier = b.carrier;
      data.tracking = b.tracking;
    }
    if (b.action === "complete") {
      if (status !== "shipped") fail("仅已发货订单可完成", 409);
      status = "completed";
    }
    if (b.action === "cancel") {
      if (!["pending_payment", "processing"].includes(status))
        fail("该订单不能直接取消", 409);
      status = "cancelled";
    }
    if (b.note !== undefined) data.note = b.note;
    const results = await db().batch([
      sql(
        "UPDATE orders SET data=?,status=?,payment_status=?,cancellation_reason=?,revision=revision+1 WHERE id=? AND status=? AND revision=? AND (status<>'pending_payment' OR expires_at>?)",
        json(data),
        status,
        payment,
        b.action === "cancel" ? "admin" : o.cancellation_reason,
        o.id,
        o.status,
        o.revision,
        now(),
      ),
      mutationLog(a.userId, "order." + b.action, o.id, {
        from: o.status,
        to: status,
      }),
    ]);
    if (!results[0].meta.changes) fail("订单状态已变化，请刷新", 409);
    return { ok: true };
  }
  if (p === "admin/reports" && method === "GET") {
    await admin("reports");
    const rows = (
      await sql(
        "SELECT * FROM orders ORDER BY created_at DESC LIMIT 10000",
      ).all<OrderRow>()
    ).results.map(parseAdminOrder);
    return {
      orders: rows,
      total: rows
        .filter((x) => x.status !== "cancelled")
        .reduce((s, x) => s + x.total, 0),
      count: rows.length,
      realRevenue: 0,
      demo: true,
    };
  }
  if (p === "admin/audit" && method === "GET") {
    await admin("audit");
    return (
      await sql(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1000",
      ).all()
    ).results;
  }
  if (p === "admin/staff" && method === "GET") {
    await admin("staff");
    return (await sql("SELECT * FROM admins ORDER BY role").all()).results;
  }
  if (p === "admin/staff" && method === "POST") {
    const a = await admin("staff"),
      b = z
        .object({
          userId: short,
          email: z.string().email(),
          name: short,
          role: z.enum(["manager", "operator", "support", "finance"]),
          active: z.number().int().min(0).max(1),
        })
        .parse(await body(req));
    const current = await sql(
      "SELECT * FROM admins WHERE user_id=?",
      b.userId,
    ).first<{
      role: string;
    }>();
    if (current?.role === "owner" || b.userId === a.userId)
      fail("不能在此修改主管理员或当前账号");
    await db().batch([
      sql(
        "INSERT INTO admins (user_id,email,name,role,active) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,active=excluded.active",
        b.userId,
        b.email,
        b.name,
        b.role,
        b.active,
      ),
      log(a.userId, "staff.save", b.userId, { role: b.role, active: b.active }),
    ]);
    return { ok: true };
  }
  if (p === "admin/uploads" && method === "POST") {
    const a = await admin("products");
    if (!env.BUCKET) fail("图片存储未配置", 503);
    if (Number(req.headers.get("content-length") || 0) > 6 * 1024 * 1024)
      fail("图片不得超过5MB", 413);
    const f = (await req.formData()).get("file");
    if (!(f instanceof File) || f.size > 5 * 1024 * 1024 || f.size < 12)
      fail("请选择5MB内的图片");
    const bytes = new Uint8Array(await f.arrayBuffer());
    let ext = "",
      type = "";
    if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    ) {
      ext = "png";
      type = "image/png";
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      ext = "jpg";
      type = "image/jpeg";
    } else if (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    ) {
      ext = "webp";
      type = "image/webp";
    } else if (new TextDecoder().decode(bytes.slice(0, 3)) === "GIF") {
      ext = "gif";
      type = "image/gif";
    } else fail("仅支持 PNG、JPG、WebP、GIF 图片");
    const key = uid() + "." + ext;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
    await log(a.userId, "media.upload", key, { size: f.size }).run();
    return { url: "/api/v1/media/" + key };
  }
  if (path[1] === "records" && path[2]) {
    const kind = path[2] as RecordKind,
      id = path[3];
    if (
      ![...Object.keys(schemas), "aftersales", "reviews", "tickets"].includes(
        kind,
      )
    )
      fail("模块不存在", 404);
    const a = await admin(kind);
    if (method === "GET") return getRecords(kind);
    if (method === "POST" || method === "PATCH") {
      const raw = await body(req);
      let data: Record<string, unknown>;
      if (["aftersales", "reviews", "tickets"].includes(kind)) {
        if (!id) fail("只能处理已有申请");
        const old = (await getRecords(kind)).find((x) => x.id === id);
        if (!old) fail("记录不存在", 404);
        const allowed =
          kind === "aftersales"
            ? ["requested", "approved", "rejected", "closed"]
            : kind === "reviews"
              ? ["pending", "published", "rejected"]
              : ["requested", "closed"];
        const b = z
          .object({
            status: z.enum(allowed as [string, ...string[]]),
            reply: txt,
          })
          .parse(raw);
        data = { ...old, ...b };
        if (
          kind === "aftersales" &&
          "status" in old &&
          old.status !== "requested" &&
          b.status === "requested"
        )
          fail("不能重新开启已处理申请");
      } else {
        data = schemas[kind].parse(raw);
      }
      const rid = id || (kind === "settings" ? "store" : uid());
      if (kind === "coupons") {
        const duplicate = (await getRecords(kind)).find(
          (x) => x.code === data.code && x.id !== rid,
        );
        if (duplicate) fail("优惠码不能重复");
      }
      const results = await db().batch([
        sql(
          "INSERT INTO records (id,kind,data,revision) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=records.revision+1 WHERE records.kind=excluded.kind",
          rid,
          kind,
          json(data),
        ),
        mutationLog(a.userId, kind + ".save", rid),
      ]);
      if (!results[0].meta.changes) fail("记录已被其他模块占用，请刷新", 409);
      return { id: rid };
    }
    if (method === "DELETE") {
      if (
        !id ||
        ["settings", "aftersales", "reviews", "tickets", "customers"].includes(
          kind,
        ) ||
        id === "hero"
      )
        fail("该记录不可删除");
      if (
        kind === "categories" &&
        (await getProducts()).some((p) => p.category === id)
      )
        fail("分类仍有关联商品，请先调整商品分类");
      const results = await db().batch([
        sql(
          `DELETE FROM records WHERE kind=? AND id=? AND (
            kind<>'categories' OR NOT EXISTS (
              SELECT 1 FROM products WHERE json_extract(products.data,'$.category')=records.id
            )
          )`,
          kind,
          id,
        ),
        mutationLog(a.userId, kind + ".delete", id),
      ]);
      if (!results[0].meta.changes) {
        fail(
          kind === "categories"
            ? "分类已变化或仍有关联商品，请刷新"
            : "记录不存在或已删除",
          kind === "categories" ? 409 : 404,
        );
      }
      return { ok: true };
    }
  }
  if (p === "admin/integrations" && method === "GET") {
    await admin("settings");
    return {
      payment: { connected: false },
      logistics: { connected: false },
      email: { connected: false },
      sms: { connected: false },
      invoices: { connected: false },
      demo: true,
    };
  }
  if (p.startsWith("payments/") || p.startsWith("webhooks/"))
    fail("尚未配置支付服务", 503);
  fail("接口不存在", 404);
}
