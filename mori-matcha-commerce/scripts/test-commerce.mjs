// Run the actual TypeScript controller against SQLite with D1's atomic batch
// semantics. Read barriers deliberately make concurrent requests see stale data.
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import assert from "node:assert/strict";

const dir = resolve(".sites-runtime/commerce-tests");
mkdirSync(dir, { recursive: true });
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const migration of readdirSync("drizzle")
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  sqlite.exec(readFileSync(resolve("drizzle", migration), "utf8"));
}
// Upgrade a populated pre-migration database, including a customized image.
const upgrade = new DatabaseSync(":memory:");
for (const name of ["0000_shocking_magneto.sql", "0001_strange_slayback.sql"])
  upgrade.exec(readFileSync("drizzle/" + name, "utf8"));
upgrade
  .prepare("INSERT INTO products (id,data) VALUES (?,?)")
  .run(
    "matcha-pouch",
    JSON.stringify({ images: ["/assets/pouch50.jpg", "/assets/pouch100.jpg"] }),
  );
upgrade
  .prepare("INSERT INTO products (id,data) VALUES (?,?)")
  .run(
    "matcha-tin",
    JSON.stringify({ images: ["https://example.test/custom.jpg"] }),
  );
upgrade.exec(
  "INSERT INTO skus (id,product_id,label,price,stock) VALUES ('pouch-100','matcha-pouch','100g',2990,17),('tin-50','matcha-tin','50g',1890,4)",
);
upgrade.exec(
  "INSERT INTO orders (id,owner_id,idempotency_key,data,total,created_at) VALUES ('legacy','owner','legacy-key','{}',2990,'2026-01-01T01:00:00.000Z')",
);
upgrade.exec(readFileSync("drizzle/0002_commerce_guards.sql", "utf8"));
assert.equal(
  upgrade.prepare("SELECT expires_at FROM orders WHERE id=?").get("legacy")
    .expires_at,
  "2026-01-01T01:30:00.000Z",
);
assert.equal(
  upgrade.prepare("SELECT image FROM skus WHERE id=?").get("pouch-100").image,
  "/assets/pouch100.jpg",
);
assert.equal(
  upgrade.prepare("SELECT image FROM skus WHERE id=?").get("tin-50").image,
  "",
);
assert.equal(
  upgrade.prepare("SELECT stock FROM skus WHERE id=?").get("pouch-100").stock,
  17,
);
upgrade.close();

const context = new AsyncLocalStorage();
let readHook;
class Statement {
  constructor(query, values = []) {
    this.query = query;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.query, values);
  }
  async first() {
    const result = sqlite.prepare(this.query).get(...this.values) || null;
    await readHook?.(this, result);
    return result;
  }
  async all() {
    const result = { results: sqlite.prepare(this.query).all(...this.values) };
    await readHook?.(this, result);
    return result;
  }
  execute() {
    const statement = sqlite.prepare(this.query);
    const results = /RETURNING/i.test(this.query)
      ? statement.all(...this.values)
      : [];
    if (!/RETURNING/i.test(this.query)) statement.run(...this.values);
    return {
      results,
      meta: {
        changes: Number(sqlite.prepare("SELECT changes() AS n").get().n),
      },
    };
  }
  async run() {
    return this.execute();
  }
}
const database = {
  prepare: (query) => new Statement(query),
  async batch(statements) {
    // SQLite executes a D1 batch as one transaction; never yield mid-batch.
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
globalThis.__commerceTest = {
  context,
  env: {
    DB: database,
    ADMIN_ACTIVATION_CODE: "local-test-only-not-a-deployed-credential",
  },
};
writeFileSync(
  resolve(dir, "test-env.mjs"),
  `
export const env = globalThis.__commerceTest.env;
export async function getChatGPTUser() { return globalThis.__commerceTest.context.getStore() || null; }
`,
);
for (const file of ["model", "server", "commerce"]) {
  const source = readFileSync(`lib/${file}.ts`, "utf8")
    .replace(/from ['"]cloudflare:workers['"]/g, "from './test-env.mjs'")
    .replace(/from ['"]@\/app\/chatgpt-auth['"]/g, "from './test-env.mjs'")
    .replace(/from ['"]\.\/(model|server)['"]/g, "from './$1.mjs'");
  writeFileSync(
    resolve(dir, file + ".mjs"),
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
}
const objects = new Map();
globalThis.__commerceTest.env.BUCKET = {
  put: async (key, bytes, options) =>
    objects.set(key, { body: bytes, httpMetadata: options.httpMetadata }),
  get: async (key) => objects.get(key),
};
const { handle } = await import(resolve(dir, "commerce.mjs"));
const owner = {
  userId: "test-owner",
  email: "owner@example.test",
  displayName: "QA Owner",
};
const buyer = {
  userId: "test-buyer",
  email: "buyer@example.test",
  displayName: "QA Buyer",
};
const stranger = {
  userId: "test-other",
  email: "other@example.test",
  displayName: "Other",
};
function call(
  path,
  method = "GET",
  data,
  user = owner,
  origin = "https://unit.test",
) {
  return context.run(user, () =>
    handle(
      new Request("https://unit.test/api/v1/" + path, {
        method,
        headers:
          method === "GET"
            ? {}
            : { Origin: origin, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      path.split("/"),
    ),
  );
}
const rejectsStatus = (fn, status) =>
  assert.rejects(fn, (error) => error.status === status);
const stock = (skuId) =>
  sqlite.prepare("SELECT stock FROM skus WHERE id=?").get(skuId).stock;
const logs = (action, target) =>
  sqlite
    .prepare("SELECT * FROM audit_logs WHERE action=? AND target=?")
    .all(action, target);
const row = (id) => sqlite.prepare("SELECT * FROM orders WHERE id=?").get(id);
function assertCustomerOrder(order) {
  assert.deepEqual(Object.keys(order).sort(), [
    "id", "idempotencyKey", "total", "status", "paymentStatus", "createdAt",
    "expiresAt", "cancellationReason", "revision", "isDemo", "subtotal",
    "discount", "coupon", "shippingFee", "shippingName", "carrier", "tracking",
    "customer", "items",
  ].sort(), "customer order must use the public field contract");
  assert.deepEqual(Object.keys(order.customer).sort(), [
    "name", "phone", "email", "address", "city", "state", "postcode", "note",
  ].sort());
  for (const item of order.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "skuId", "productId", "name", "label", "image", "price", "quantity",
    ].sort());
  }
}
const getProduct = async (id) =>
  (await call("admin/products")).find((product) => product.id === id);
function barrier(predicate, arrivals = 2) {
  let count = 0,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  return async (statement) => {
    if (!predicate(statement)) return;
    count++;
    if (count === arrivals) release();
    let timer;
    try {
      await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Read barrier timed out: " + statement.query)),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
async function race(predicate, actions) {
  readHook = barrier(predicate, actions.length);
  try {
    return await Promise.allSettled(actions.map((action) => action()));
  } finally {
    readHook = undefined;
  }
}
function oneSuccess(results) {
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const failures = results.filter((result) => result.status === "rejected");
  assert.equal(failures.length, results.length - 1);
  for (const failure of failures) assert.equal(failure.reason.status, 409);
}
let fixture = 0;
async function productFixture(variants = [{ stock: 20 }]) {
  const id = "test-product-" + ++fixture;
  await call("admin/products", "POST", {
    id,
    name: "Fixture " + fixture,
    nameEN: "Fixture",
    nameMS: "Ujian",
    description: "Local test only",
    descriptionEN: "",
    descriptionMS: "Ujian tempatan",
    category: "tin",
    images: ["/assets/tin.jpg"],
    detailImages: [],
    origin: "Fixture",
    storage: "Fixture",
    ingredients: "Fixture",
    status: "active",
    variants: variants.map((variant, index) => ({
      id: id + "-sku-" + index,
      label: "Fixture " + index,
      price: 2300,
      active: 1,
      image: index ? "/assets/pouch100.jpg" : "/assets/pouch50.jpg",
      ...variant,
    })),
  });
  return getProduct(id);
}
function checkoutPayload(skuId, quantity = 2) {
  return {
    idempotencyKey: crypto.randomUUID(),
    items: [{ skuId, quantity }],
    customer: {
      name: "Test Buyer",
      phone: "00000000",
      email: buyer.email,
      address: "Test address only",
      city: "Test City",
      state: "Test State",
      postcode: "00000",
      note: "",
    },
    shippingId: "shipping-default",
    coupon: "",
    acknowledgeDemo: true,
    total: 1,
  };
}
const checkout = (payload) => call("orders", "POST", payload, buyer);

try {
  await rejectsStatus(
    () => call("admin/products", "GET", undefined, null),
    401,
  );
  await rejectsStatus(
    () => call("admin/products", "GET", undefined, buyer),
    403,
  );
  await rejectsStatus(
    () => call("admin/activate", "POST", { code: "wrong" }),
    403,
  );
  await call("admin/activate", "POST", {
    code: globalThis.__commerceTest.env.ADMIN_ACTIVATION_CODE,
  });
  await rejectsStatus(
    () =>
      call(
        "admin/activate",
        "POST",
        { code: globalThis.__commerceTest.env.ADMIN_ACTIVATION_CODE },
        stranger,
      ),
    403,
  );

  const form = new FormData();
  form.append(
    "file",
    new File([readFileSync("public/assets/tin.jpg")], "tea.jpg", {
      type: "image/jpeg",
    }),
  );
  const uploaded = await context.run(owner, () =>
    handle(
      new Request("https://unit.test/api/v1/admin/uploads", {
        method: "POST",
        headers: { Origin: "https://unit.test" },
        body: form,
      }),
      ["admin", "uploads"],
    ),
  );
  assert.match(uploaded.url, /^\/api\/v1\/media\/.+\.jpg$/);
  const media = await call(uploaded.url.replace("/api/v1/", ""));
  assert.equal(media.headers.get("Content-Type"), "image/jpeg");
  assert.ok((await media.arrayBuffer()).byteLength > 100);
  const fake = new FormData();
  fake.append(
    "file",
    new File(["<html>not-an-image</html>"], "fake.jpg", { type: "image/jpeg" }),
  );
  await rejectsStatus(
    () =>
      context.run(owner, () =>
        handle(
          new Request("https://unit.test/api/v1/admin/uploads", {
            method: "POST",
            headers: { Origin: "https://unit.test" },
            body: fake,
          }),
          ["admin", "uploads"],
        ),
      ),
    400,
  );

  let product = await productFixture();
  const sku = product.variants[0];
  await call("admin/products", "PATCH", {
    ...product,
    name: "Updated",
    variants: [{ ...sku, stock: 9999 }],
  });
  assert.equal(
    stock(sku.id),
    20,
    "metadata edits must never overwrite live stock",
  );
  await rejectsStatus(() => call("admin/products", "PATCH", product), 409);
  assert.equal(logs("product.update", product.id).length, 1);
  assert.equal(logs("product.update.conflict", product.id).length, 1);
  assert.equal(
    JSON.parse(logs("product.update.conflict", product.id)[0].detail).outcome,
    "conflict",
  );
  product = await getProduct(product.id);
  assert.equal(product.nameMS, "Ujian");
  assert.equal(product.variants[0].image, "/assets/pouch50.jpg");
  await call("admin/inventory", "POST", {
    skuId: sku.id,
    delta: 5,
    reason: "QA intake",
  });
  assert.equal(stock(sku.id), 25);
  await rejectsStatus(
    () =>
      call("admin/inventory", "POST", {
        skuId: sku.id,
        delta: -26,
        reason: "invalid",
      }),
    409,
  );
  assert.equal(stock(sku.id), 25);

  const settings = (await call("admin/records/settings"))[0];
  await call("admin/records/settings/store", "PATCH", {
    ...settings,
    name: "QA Store",
    lowStock: 7,
    contact: "Public consultation text",
    shopeeUrl: "https://example.test/shop",
    tiktokUrl: "",
    whatsappUrl: "https://wa.me/000000000",
  });
  const publicSettings = (await call("catalog")).settings;
  assert.equal(publicSettings.name, "QA Store");
  assert.equal(publicSettings.shopeeUrl, "https://example.test/shop");
  assert.equal(publicSettings.contact, "Public consultation text");
  assert.equal((await call("admin/bootstrap")).settings.lowStock, 7);
  assert.equal((await call("admin/inventory")).lowStock, 7);
  await assert.rejects(() =>
    call("admin/records/settings/store", "PATCH", {
      ...settings,
      shopeeUrl: "javascript:alert(1)",
    }),
  );
  await call("admin/records/content/hero", "PATCH", {
    ...(await call("admin/records/content"))[0],
    titleMS: "Teh",
    descriptionMS: "Ujian",
  });
  assert.equal((await call("catalog")).hero.titleMS, "Teh");

  await call("admin/records/coupons", "POST", {
    name: "QA coupon",
    code: "qa",
    discount: 100,
    minimum: 1000,
    expires: "2099-01-01T00:00:00Z",
    status: "active",
  });
  const payload = { ...checkoutPayload(sku.id), coupon: "qa" };
  payload.customer.note = "Customer delivery instructions";
  const order = await checkout(payload);
  assertCustomerOrder(order);
  assert.equal(order.customer.note, payload.customer.note);
  assert.equal(
    order.total,
    2300 * 2 - 100 + 600,
    "client total must be ignored",
  );
  assert.equal(order.items[0].image, "/assets/pouch50.jpg");
  assert.equal(
    Date.parse(order.expiresAt) - Date.parse(order.createdAt),
    30 * 60000,
  );
  assert.equal((await checkout(payload)).id, order.id);
  // Every customer return path must omit internal data, including future fields
  // nested in snapshots. Admins must retain their own notes and financial data.
  const privateMarker = "STAFF-ONLY-PRIVACY-REGRESSION";
  await call("admin/orders/" + order.id, "PATCH", {
    action: "note", note: privateMarker,
  });
  const privateSnapshot = JSON.parse(row(order.id).data);
  privateSnapshot.internalRisk = privateMarker;
  privateSnapshot.customer.internalRisk = privateMarker;
  privateSnapshot.items[0].supplierCost = privateMarker;
  sqlite.prepare("UPDATE orders SET data=? WHERE id=?")
    .run(JSON.stringify(privateSnapshot), order.id);
  const listed = (await call("orders", "GET", undefined, buyer))
    .find((item) => item.id === order.id);
  const replayed = await checkout(payload);
  for (const publicOrder of [listed, replayed]) {
    assertCustomerOrder(publicOrder);
    assert.ok(!JSON.stringify(publicOrder).includes(privateMarker));
    assert.equal(publicOrder.customer.note, payload.customer.note);
    assert.equal(publicOrder.idempotencyKey, payload.idempotencyKey);
    assert.deepEqual(publicOrder.items, order.items);
    assert.equal(publicOrder.total, order.total);
    assert.equal(publicOrder.shippingFee, order.shippingFee);
    assert.equal(publicOrder.discount, order.discount);
  }
  assert.equal((await call("admin/orders")).find((item) => item.id === order.id).note, privateMarker);
  assert.equal((await call("admin/reports")).orders.find((item) => item.id === order.id).note, privateMarker);
  assert.equal(stock(sku.id), 23);
  assert.equal((await call("orders", "GET", undefined, stranger)).length, 0);
  await rejectsStatus(
    () => call("orders/" + order.id + "/cancel", "POST", {}, stranger),
    404,
  );
  await rejectsStatus(() => checkout(checkoutPayload(sku.id, 100)), 409);

  const cancellations = await race(
    (statement) =>
      statement.query === "SELECT * FROM orders WHERE id=? AND owner_id=?",
    [
      () => call("orders/" + order.id + "/cancel", "POST", {}, buyer),
      () => call("orders/" + order.id + "/cancel", "POST", {}, buyer),
    ],
  );
  oneSuccess(cancellations);
  assert.equal(
    stock(sku.id),
    25,
    "concurrent cancellation returns stock exactly once",
  );
  assert.equal(logs("order.cancel", order.id).length, 1);
  assert.equal(logs("order.cancel.conflict", order.id).length, 1);
  await rejectsStatus(
    () => call("orders/" + order.id + "/cancel", "POST", {}, buyer),
    409,
  );

  const samePayload = checkoutPayload(sku.id);
  const duplicates = await race(
    (statement) =>
      statement.query.includes("WHERE owner_id=? AND idempotency_key=?"),
    [() => checkout(samePayload), () => checkout(samePayload)],
  );
  assert.ok(duplicates.every((result) => result.status === "fulfilled"));
  // The losing INSERT returns the order through the transaction catch/requery.
  for (const result of duplicates) assertCustomerOrder(result.value);
  assert.equal(duplicates[0].value.id, duplicates[1].value.id);
  assert.equal(
    stock(sku.id),
    23,
    "same-key concurrent checkout reserves only once",
  );
  assert.equal(logs("order.create.demo", duplicates[0].value.id).length, 1);

  const scarce = await productFixture([{ stock: 1 }]);
  const scarceSku = scarce.variants[0].id;
  const oversells = await race(
    (statement) =>
      statement.query.startsWith(
        "SELECT id,product_id,label,price,stock,active,image FROM skus",
      ),
    [
      () => checkout(checkoutPayload(scarceSku, 1)),
      () => checkout(checkoutPayload(scarceSku, 1)),
    ],
  );
  oneSuccess(oversells);
  assert.equal(stock(scarceSku), 0, "two stale stock reads cannot oversell");

  // Both product requests read an unclaimed SKU, then race to claim it.
  const sharedId = "shared-concurrent-sku";
  const left = await productFixture(),
    right = await productFixture();
  const collisions = await race(
    (statement) =>
      statement.query === "SELECT product_id FROM skus WHERE id=?" &&
      statement.values[0] === sharedId,
    [
      () =>
        call("admin/products", "PATCH", {
          ...left,
          name: "Left edit",
          variants: [
            { ...left.variants[0], id: sharedId, label: "Left", price: 1100 },
          ],
        }),
      () =>
        call("admin/products", "PATCH", {
          ...right,
          name: "Right edit",
          variants: [
            { ...right.variants[0], id: sharedId, label: "Right", price: 9900 },
          ],
        }),
    ],
  );
  oneSuccess(collisions);
  const winnerIndex = collisions.findIndex(
    (result) => result.status === "fulfilled",
  );
  const winner = [left, right][winnerIndex],
    loser = [left, right][1 - winnerIndex];
  const shared = sqlite.prepare("SELECT * FROM skus WHERE id=?").get(sharedId);
  assert.equal(shared.product_id, winner.id);
  assert.equal(shared.price, winnerIndex === 0 ? 1100 : 9900);
  assert.equal(
    (await getProduct(loser.id)).name,
    loser.name,
    "failed SKU ownership must roll back product metadata",
  );
  assert.equal(logs("product.update", loser.id).length, 0);
  assert.equal(logs("product.update.conflict", loser.id).length, 1);
  assert.throws(
    () =>
      sqlite
        .prepare("UPDATE skus SET product_id=? WHERE id=?")
        .run(loser.id, sharedId),
    /sku_ownership_conflict/,
  );

  // Category deletion and product reassignment race in both commit orders.
  // Each loser has a stale, valid preflight snapshot but must fail atomically.
  async function categoryRace(productWins, creating = false) {
    const moving = await productFixture();
    const category = await call("admin/records/categories", "POST", {
      name: "Race category",
      nameEN: "Race category",
      nameMS: "",
      status: "active",
    });
    let signalRead, releaseRead;
    const reached = new Promise((resolve) => {
      signalRead = resolve;
    });
    const resume = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const query = productWins
      ? "SELECT * FROM products"
      : "SELECT * FROM records WHERE kind=? ORDER BY rowid DESC";
    readHook = async (statement) => {
      if (
        statement.query !== query ||
        (!productWins && statement.values[0] !== "categories")
      )
        return;
      signalRead();
      await resume;
    };
    const targetId = creating ? moving.id + "-new" : moving.id;
    const productAction = creating ? "product.create" : "product.update";
    const save = () =>
      call("admin/products", creating ? "POST" : "PATCH", {
        ...moving,
        id: targetId,
        category: category.id,
        variants: moving.variants.map((variant) => ({
          ...variant,
          id: creating ? variant.id + "-new" : variant.id,
        })),
      });
    const remove = () =>
      call("admin/records/categories/" + category.id, "DELETE");
    const pending = (productWins ? remove : save)();
    // Attach a rejection handler while the other request is still running.
    const settled = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let timeout;
    try {
      await Promise.race([
        reached,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Category race read was not reached")),
            5000,
          );
        }),
      ]);
      readHook = undefined;
      await (productWins ? save : remove)();
    } finally {
      clearTimeout(timeout);
      readHook = undefined;
      releaseRead();
    }
    const losing = await settled;
    assert.equal(losing.error?.status, 409);
    const saved = await getProduct(targetId);
    if (creating && !productWins) assert.equal(saved, undefined);
    else
      assert.equal(saved.category, productWins ? category.id : moving.category);
    const categoryExists = !!sqlite
      .prepare("SELECT id FROM records WHERE id=?")
      .get(category.id);
    assert.equal(categoryExists, productWins);
    assert.equal(
      logs(
        productWins ? "categories.delete" : productAction,
        productWins ? category.id : targetId,
      ).length,
      0,
    );
    assert.equal(
      logs(
        productWins
          ? "categories.delete.conflict"
          : productAction + ".conflict",
        productWins ? category.id : targetId,
      ).length,
      1,
    );
  }
  await categoryRace(true);
  await categoryRace(false);
  await categoryRace(true, true);
  await categoryRace(false, true);

  // A second item becomes unavailable after preflight: the first reservation,
  // order, items and success audit must all roll back together.
  const multi = await productFixture([{ stock: 5 }, { stock: 5 }]);
  let injected = false;
  readHook = async (statement) => {
    if (
      !injected &&
      statement.query.startsWith(
        "SELECT id,product_id,label,price,stock,active,image FROM skus",
      )
    ) {
      injected = true;
      sqlite
        .prepare("UPDATE skus SET stock=0 WHERE id=?")
        .run(multi.variants[1].id);
    }
  };
  const multiPayload = {
    ...checkoutPayload(multi.variants[0].id),
    items: multi.variants.map((variant) => ({
      skuId: variant.id,
      quantity: 2,
    })),
  };
  try {
    await rejectsStatus(() => checkout(multiPayload), 409);
  } finally {
    readHook = undefined;
  }
  assert.equal(stock(multi.variants[0].id), 5);
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE idempotency_key=?")
      .get(multiPayload.idempotencyKey).n,
    0,
  );

  // A concurrent price edit must invalidate stale checkout pricing inside the
  // reservation transaction, rather than charging the previously read price.
  const repriced = await productFixture([{ stock: 5 }]);
  let repricedOnce = false;
  readHook = async (statement) => {
    if (
      !repricedOnce &&
      statement.query.startsWith(
        "SELECT id,product_id,label,price,stock,active,image FROM skus",
      )
    ) {
      repricedOnce = true;
      sqlite
        .prepare("UPDATE skus SET price=price+100 WHERE id=?")
        .run(repriced.variants[0].id);
    }
  };
  try {
    await rejectsStatus(
      () => checkout(checkoutPayload(repriced.variants[0].id)),
      409,
    );
  } finally {
    readHook = undefined;
  }
  assert.equal(stock(repriced.variants[0].id), 5);

  const expiring = await checkout(checkoutPayload(sku.id));
  const beforeExpiry = stock(sku.id);
  sqlite
    .prepare("UPDATE orders SET expires_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", expiring.id);
  await Promise.all([call("catalog"), call("orders", "GET", undefined, buyer)]);
  assert.equal(row(expiring.id).status, "cancelled");
  assert.equal(row(expiring.id).cancellation_reason, "expired");
  assert.equal(stock(sku.id), beforeExpiry + 2);
  assert.equal(logs("order.expire", expiring.id).length, 1);
  await call("catalog");
  assert.equal(stock(sku.id), beforeExpiry + 2);
  assert.equal(
    (
      await checkout({
        ...checkoutPayload(sku.id),
        idempotencyKey: sqlite
          .prepare("SELECT idempotency_key FROM orders WHERE id=?")
          .get(expiring.id).idempotency_key,
      })
    ).status,
    "cancelled",
  );
  await rejectsStatus(
    () =>
      call("admin/orders/" + expiring.id, "PATCH", { action: "confirm_demo" }),
    409,
  );

  // Customer cancellation and admin confirmation must not both succeed.
  const contested = await checkout(checkoutPayload(sku.id));
  const beforeContested = stock(sku.id);
  const transitions = await race(
    (statement) =>
      statement.query.startsWith("SELECT * FROM orders WHERE id=?"),
    [
      () => call("orders/" + contested.id + "/cancel", "POST", {}, buyer),
      () =>
        call("admin/orders/" + contested.id, "PATCH", {
          action: "confirm_demo",
        }),
    ],
  );
  oneSuccess(transitions);
  assert.equal(
    stock(sku.id),
    beforeContested + (row(contested.id).status === "cancelled" ? 2 : 0),
  );
  assert.equal(
    logs("order.cancel", contested.id).length +
      logs("order.confirm_demo", contested.id).length,
    1,
  );
  assert.equal(
    logs("order.cancel.conflict", contested.id).length +
      logs("order.confirm_demo.conflict", contested.id).length,
    1,
  );

  const fulfillment = await checkout(checkoutPayload(sku.id));
  await rejectsStatus(
    () =>
      call("admin/orders/" + fulfillment.id, "PATCH", {
        action: "ship",
        carrier: "QA",
        tracking: "QA",
      }),
    409,
  );
  await call("admin/orders/" + fulfillment.id, "PATCH", {
    action: "confirm_demo",
  });
  sqlite
    .prepare("UPDATE orders SET expires_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", fulfillment.id);
  await call("catalog");
  assert.equal(
    row(fulfillment.id).status,
    "processing",
    "confirmed orders must not expire",
  );
  const notes = await race(
    (statement) => statement.query === "SELECT * FROM orders WHERE id=?",
    [
      () =>
        call("admin/orders/" + fulfillment.id, "PATCH", {
          action: "note",
          note: "first",
        }),
      () =>
        call("admin/orders/" + fulfillment.id, "PATCH", {
          action: "note",
          note: "second",
        }),
    ],
  );
  oneSuccess(notes);
  assert.equal(logs("order.note", fulfillment.id).length, 1);
  assert.equal(logs("order.note.conflict", fulfillment.id).length, 1);
  await call("admin/orders/" + fulfillment.id, "PATCH", {
    action: "ship",
    carrier: "TEST ONLY",
    tracking: "TEST-001",
  });
  await call("admin/orders/" + fulfillment.id, "PATCH", { action: "complete" });
  await call(
    "orders/" + fulfillment.id + "/aftersales",
    "POST",
    { reason: "QA", description: "QA", amount: 100 },
    buyer,
  );
  await rejectsStatus(
    () =>
      call(
        "orders/" + fulfillment.id + "/aftersales",
        "POST",
        { reason: "QA", description: "QA", amount: 100 },
        stranger,
      ),
    404,
  );
  await call(
    "reviews",
    "POST",
    {
      orderId: fulfillment.id,
      productId: product.id,
      rating: 5,
      text: "Test review",
    },
    buyer,
  );
  assert.equal((await call("catalog")).reviews.length, 0);
  const review = (await call("admin/records/reviews"))[0];
  await call("admin/records/reviews/" + review.id, "PATCH", {
    status: "published",
    reply: "Public reply",
  });
  assert.equal((await call("catalog")).reviews[0].reply, "Public reply");
  assert.equal(
    (await call("catalog")).reviews[0].userId,
    undefined,
    "public review must not expose private owner IDs",
  );

  await call(
    "tickets",
    "POST",
    { subject: "QA", message: "Test ticket" },
    buyer,
  );
  const ticket = (await call("admin/records/tickets"))[0];
  await call("admin/records/tickets/" + ticket.id, "PATCH", {
    status: "closed",
    reply: "Test reply",
  });
  assert.equal(
    (await call("tickets", "GET", undefined, buyer))[0].reply,
    "Test reply",
  );
  assert.equal((await call("tickets", "GET", undefined, stranger)).length, 0);
  await call("admin/staff", "POST", {
    userId: stranger.userId,
    email: stranger.email,
    name: "Operator",
    role: "operator",
    active: 1,
  });
  assert.ok((await call("admin/products", "GET", undefined, stranger)).length);
  await rejectsStatus(
    () => call("admin/orders", "GET", undefined, stranger),
    403,
  );
  await rejectsStatus(
    () =>
      call(
        "admin/inventory",
        "POST",
        { skuId: sku.id, delta: 1, reason: "bad origin" },
        owner,
        "https://other.test",
      ),
    403,
  );

  const category = (await call("admin/records/categories")).find(
    (item) => item.id === "tin",
  );
  await call("admin/records/categories/tin", "PATCH", {
    ...category,
    status: "disabled",
  });
  assert.ok(
    (await call("catalog")).products.every((item) => item.category !== "tin"),
  );
  await rejectsStatus(() => checkout(checkoutPayload(sku.id)), 409);
  await call("admin/records/categories/tin", "PATCH", category);
  const draft = await getProduct(product.id);
  await call("admin/products", "PATCH", {
    ...draft,
    status: "draft",
    variants: [{ ...draft.variants[0], active: 0, label: "", price: 0 }],
  });
  assert.equal(
    (await getProduct(product.id)).variants[0].price,
    0,
    "unknown draft SKU data can remain empty",
  );
  await assert.rejects(async () =>
    call("admin/products", "PATCH", {
      ...(await getProduct(product.id)),
      status: "active",
      variants: [{ ...draft.variants[0], active: 1, label: "", price: 0 }],
    }),
  );
  for (const item of await call("admin/products"))
    await call("admin/products", "PATCH", { ...item, status: "archived" });
  assert.equal((await call("catalog")).products.length, 0);
  assert.equal((await call("admin/reports")).realRevenue, 0);
  console.log(
    "PASS: real-controller SQLite integration: authorization, image validation, server pricing, stock rollback, concurrent idempotency/oversell/cancellation/SKU ownership/category deletion/order CAS, expiry and exact-once stock return, truthful audit outcomes, public config/Malay/variant images/review replies, draft validation, category visibility, RBAC, CSRF and demo revenue.",
  );
} finally {
  readHook = undefined;
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
}
