import assert from "node:assert/strict";
import {
  clearConfirmedInventoryPending,
  createInventoryPending,
  inventoryPendingKey,
  inventoryReceipt,
  readInventoryPending,
  submitInventoryPending,
} from "../lib/inventory-pending.ts";

const user = "stable-admin-id";
const otherUser = "another-admin-id";
const operationId = "22222222-2222-4222-8222-222222222222";
const otherOperationId = "33333333-3333-4333-8333-333333333333";
const input = {
  skuId: "sku-1",
  delta: -5,
  reason: "  Stock count  ",
  skuName: "Matcha 50g",
};
const currentUser = async () => user;
const receiptFor = (request) => ({
  ...request,
  ok: true,
  createdAt: "2026-10-31T01:00:00.000Z",
});
const rejected = Object.assign(new Error("Inventory rejected"), {
  status: 409,
  code: "inventory_adjustment_rejected",
});
const conflict = Object.assign(new Error("Operation conflict"), {
  status: 409,
  code: "inventory_operation_conflict",
});

function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

// Validate and durably snapshot before allowing any request. Later draft edits
// cannot change the saved payload, and another tab cannot replace a pending key.
{
  const storage = memoryStorage();
  for (const invalid of [
    { ...input, delta: 0 },
    { ...input, delta: 0.5 },
    { ...input, delta: 10000001 },
    { ...input, reason: "   " },
  ]) {
    assert.throws(() =>
      createInventoryPending(storage, user, invalid, operationId),
    );
    assert.equal(storage.entries.size, 0);
  }
  const draft = { ...input };
  const pending = createInventoryPending(storage, user, draft, operationId);
  draft.delta = 99;
  draft.reason = "changed";
  assert.deepEqual(pending.request, {
    operationId,
    skuId: "sku-1",
    delta: -5,
    reason: "Stock count",
  });
  assert.throws(() => {
    pending.request.delta = 99;
  }, TypeError);
  assert.throws(() =>
    createInventoryPending(storage, user, input, otherOperationId),
  );
  assert.deepEqual(readInventoryPending(storage, user), pending);
  assert.equal(
    readInventoryPending(storage, otherUser),
    null,
    "a new login must not restore a different admin's operation",
  );
  const other = createInventoryPending(
    storage,
    otherUser,
    input,
    otherOperationId,
  );
  assert.equal(
    readInventoryPending(storage, user).request.operationId,
    operationId,
  );
  assert.equal(
    readInventoryPending(storage, otherUser).request.operationId,
    other.request.operationId,
  );
}

// Both throwing storage and silent write failures prevent transport entirely.
for (const failingStorage of [
  {
    ...memoryStorage(),
    setItem() {
      throw new Error("quota exceeded");
    },
  },
  { ...memoryStorage(), setItem() {} },
  {
    ...memoryStorage(),
    getItem() {
      throw new Error("storage denied");
    },
  },
]) {
  let posts = 0;
  await assert.rejects(async () => {
    const pending = createInventoryPending(
      failingStorage,
      user,
      input,
      operationId,
    );
    await submitInventoryPending(
      failingStorage,
      pending,
      currentUser,
      async () => {
        posts++;
      },
    );
  });
  assert.equal(posts, 0);
}
{
  const storage = memoryStorage();
  storage.setItem(inventoryPendingKey(user), "{broken json");
  assert.throws(() => readInventoryPending(storage, user));
  assert.throws(() =>
    createInventoryPending(storage, user, input, operationId),
  );
  assert.equal(
    storage.getItem(inventoryPendingKey(user)),
    "{broken json",
    "never silently discard a corrupt operation of unknown outcome",
  );
}

// A server commit followed by a lost response must survive refresh and replay
// the exact same request, even though its negative delta now exceeds stock=0.
{
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  let stock = 5;
  let posts = 0;
  const committed = new Map();
  const seenRequests = [];
  const server = async (request) => {
    assert.deepEqual(
      readInventoryPending(storage, user).request,
      request,
      "persist before POST",
    );
    seenRequests.push(request);
    posts++;
    if (!committed.has(request.operationId)) {
      stock += request.delta;
      committed.set(request.operationId, receiptFor(request));
      throw new TypeError("Failed to fetch after server commit");
    }
    return committed.get(request.operationId);
  };
  await assert.rejects(
    submitInventoryPending(storage, pending, currentUser, server),
  );
  assert.equal(stock, 0);
  const restored = readInventoryPending(storage, user);
  assert.deepEqual(restored, pending);
  await assert.rejects(
    submitInventoryPending(storage, restored, currentUser, async () => {
      throw rejected;
    }),
    "even a definite rejection cannot erase an uncertain earlier attempt",
  );
  assert.deepEqual(readInventoryPending(storage, user), restored);
  const result = await submitInventoryPending(
    storage,
    restored,
    currentUser,
    server,
  );
  assert.deepEqual(result.receipt, receiptFor(pending.request));
  assert.equal(result.cleanupError, null);
  assert.equal(readInventoryPending(storage, user), null);
  assert.equal(stock, 0);
  assert.equal(posts, 2);
  assert.deepEqual(seenRequests[0], seenRequests[1]);
}

// HTTP 5xx, malformed JSON, wrong receipts and permission/key conflicts preserve
// the same durable payload. Neither reads nor errors may generate a new key.
for (const outcome of [
  () => {
    throw Object.assign(new Error("Unavailable"), { status: 503 });
  },
  () => {
    throw new SyntaxError("Invalid JSON response");
  },
  () => {
    throw Object.assign(new Error("Permission denied"), { status: 403 });
  },
  () => {
    throw conflict;
  },
  (request) => ({ ...receiptFor(request), delta: 100 }),
  (request) => ({ ...receiptFor(request), operationId: otherOperationId }),
  (request) => ({ ...receiptFor(request), ok: false }),
  () => ({ ok: true }),
]) {
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  const before = storage.getItem(inventoryPendingKey(user));
  await assert.rejects(
    submitInventoryPending(storage, pending, currentUser, async (request) =>
      outcome(request),
    ),
  );
  assert.equal(storage.getItem(inventoryPendingKey(user)), before);
}

// Identity may change after the bootstrap check but before POST. The server's
// actor mismatch is never proof that the saved operation can be discarded.
for (const firstAttempt of [true, false]) {
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  await assert.rejects(
    submitInventoryPending(
      storage,
      pending,
      currentUser,
      async () => {
        throw Object.assign(new Error("Administrator changed"), {
          status: 409,
          code: "inventory_actor_changed",
        });
      },
      firstAttempt,
    ),
  );
  assert.deepEqual(readInventoryPending(storage, user), pending);
}

// Only a fresh, explicitly rejected transaction may be ended without a receipt.
for (const error of [
  conflict,
  Object.assign(new Error("库存不足或SKU不存在"), { status: 409 }),
  { status: 500, code: "inventory_adjustment_rejected" },
]) {
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  await assert.rejects(
    submitInventoryPending(
      storage,
      pending,
      currentUser,
      async () => {
        throw error;
      },
      true,
    ),
  );
  assert.deepEqual(readInventoryPending(storage, user), pending);
}

// Cross-tab counterexample: A receives a definite first rejection, B already
// holds an in-memory copy and would replay after A releases the browser lock.
// A must clear before returning, so B cannot commit then lose its response while
// A still has a delayed "finish rejected" button that could erase that outcome.
{
  const storage = memoryStorage();
  const pendingA = createInventoryPending(storage, user, input, operationId);
  const pendingB = readInventoryPending(storage, user);
  const rejectedResult = await submitInventoryPending(
    storage,
    pendingA,
    currentUser,
    async () => {
      throw rejected;
    },
    true,
  );
  assert.equal(rejectedResult.outcome, "rejected");
  assert.equal(
    readInventoryPending(storage, user),
    null,
    "clear the rejected operation while A still owns the browser lock",
  );
  let postsB = 0;
  await assert.rejects(
    submitInventoryPending(storage, pendingB, currentUser, async () => {
      postsB++;
      throw new Error("response lost after B committed");
    }),
  );
  assert.equal(
    postsB,
    0,
    "B's stale in-memory copy must not reach the server after the rejected operation has ended",
  );
  const edited = createInventoryPending(
    storage,
    user,
    { ...input, delta: 2 },
    otherOperationId,
  );
  assert.equal(edited.request.delta, 2);
}

// If first-rejection cleanup fails, no cleanup proof survives. A later retry or
// restored tab keeps the original key even when its own request is rejected.
{
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  const remove = storage.removeItem;
  storage.removeItem = () => {
    throw new Error("remove denied");
  };
  await assert.rejects(
    submitInventoryPending(
      storage,
      pending,
      currentUser,
      async () => {
        throw rejected;
      },
      true,
    ),
  );
  storage.removeItem = remove;
  const restored = readInventoryPending(storage, user);
  await assert.rejects(
    submitInventoryPending(storage, restored, currentUser, async () => {
      throw rejected;
    }),
  );
  assert.deepEqual(readInventoryPending(storage, user), pending);
}

// Stale tabs must verify the current identity before sending a saved request.
{
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  let posts = 0;
  await assert.rejects(
    submitInventoryPending(
      storage,
      pending,
      async () => otherUser,
      async () => {
        posts++;
      },
    ),
  );
  assert.equal(posts, 0);
  assert.deepEqual(readInventoryPending(storage, user), pending);
}

// A valid receipt is final even if local cleanup fails. Cleanup retries do not
// POST again, and must never delete a newer operation from another page.
{
  const storage = memoryStorage();
  const pending = createInventoryPending(storage, user, input, operationId);
  const remove = storage.removeItem;
  storage.removeItem = () => {
    throw new Error("cannot remove");
  };
  let posts = 0;
  const result = await submitInventoryPending(
    storage,
    pending,
    currentUser,
    async (request) => {
      posts++;
      return receiptFor(request);
    },
  );
  assert.equal(result.cleanupError, "cannot remove");
  assert.deepEqual(result.receipt, receiptFor(pending.request));
  assert.deepEqual(readInventoryPending(storage, user), pending);
  storage.removeItem = remove;
  clearConfirmedInventoryPending(storage, pending, result.receipt);
  assert.equal(readInventoryPending(storage, user), null);
  const newer = createInventoryPending(storage, user, input, otherOperationId);
  assert.throws(() =>
    clearConfirmedInventoryPending(storage, pending, result.receipt),
  );
  assert.deepEqual(readInventoryPending(storage, user), newer);
  assert.equal(posts, 1);
  assert.throws(() =>
    inventoryReceipt(pending, { ...result.receipt, createdAt: "invalid" }),
  );
}
console.log("Inventory pending-operation regression checks passed.");
