export type InventoryAdjustmentRequest = Readonly<{
  operationId: string;
  skuId: string;
  delta: number;
  reason: string;
}>;

export type PendingInventoryAdjustment = Readonly<{
  version: 1;
  userId: string;
  skuName: string;
  request: InventoryAdjustmentRequest;
}>;

export type InventoryAdjustmentReceipt = InventoryAdjustmentRequest & {
  ok: true;
  createdAt: string;
};

type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function inventoryPendingKey(userId: string) {
  if (!userId) throw new Error("无法确认管理员账号，库存操作已暂停");
  return "mori:inventory-pending:v1:" + encodeURIComponent(userId);
}

function requestSnapshot(value: unknown): InventoryAdjustmentRequest {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    !uuid.test(value.operationId) ||
    typeof value.skuId !== "string" ||
    !value.skuId.trim() ||
    value.skuId !== value.skuId.trim() ||
    value.skuId.length > 160 ||
    typeof value.delta !== "number" ||
    !Number.isInteger(value.delta) ||
    value.delta === 0 ||
    Math.abs(value.delta) > 10000000 ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    value.reason !== value.reason.trim() ||
    value.reason.length > 160
  ) {
    throw new Error("库存操作记录无效，请核对数量、原因和操作编号；未发送请求");
  }
  return Object.freeze({
    operationId: value.operationId,
    skuId: value.skuId,
    delta: value.delta,
    reason: value.reason,
  });
}

export function readInventoryPending(
  storage: PendingStorage,
  userId: string,
): PendingInventoryAdjustment | null {
  const raw = storage.getItem(inventoryPendingKey(userId));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "本地库存操作记录损坏，已暂停提交；请先核对库存流水，不要清除浏览器数据",
    );
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.userId !== userId ||
    typeof value.skuName !== "string"
  ) {
    throw new Error("本地库存操作记录与当前账号不符，已暂停提交");
  }
  return Object.freeze({
    version: 1,
    userId,
    skuName: value.skuName,
    request: requestSnapshot(value.request),
  });
}

function sameRequest(
  a: InventoryAdjustmentRequest,
  b: InventoryAdjustmentRequest,
) {
  return (
    a.operationId === b.operationId &&
    a.skuId === b.skuId &&
    a.delta === b.delta &&
    a.reason === b.reason
  );
}

function requireStoredPending(
  storage: PendingStorage,
  pending: PendingInventoryAdjustment,
) {
  const stored = readInventoryPending(storage, pending.userId);
  if (!stored || !sameRequest(stored.request, pending.request)) {
    throw new Error(
      "本地库存操作已在其他页面变化，请重新读取后核对；本次未发送请求",
    );
  }
}

export function createInventoryPending(
  storage: PendingStorage,
  userId: string,
  input: { skuId: string; delta: number; reason: string; skuName: string },
  operationId: string,
): PendingInventoryAdjustment {
  const request = requestSnapshot({
    operationId,
    skuId: input.skuId,
    delta: input.delta,
    reason: input.reason.trim(),
  });
  if (readInventoryPending(storage, userId)) {
    throw new Error("此账号已有待确认的库存操作，请先恢复原操作");
  }
  const pending: PendingInventoryAdjustment = Object.freeze({
    version: 1,
    userId,
    skuName: input.skuName,
    request,
  });
  storage.setItem(inventoryPendingKey(userId), JSON.stringify(pending));
  // A silent failed write must also stop the request before any network mutation.
  requireStoredPending(storage, pending);
  return pending;
}

function clearStoredPending(
  storage: PendingStorage,
  pending: PendingInventoryAdjustment,
) {
  const stored = readInventoryPending(storage, pending.userId);
  if (stored === null) return;
  requireStoredPending(storage, pending);
  storage.removeItem(inventoryPendingKey(pending.userId));
  if (storage.getItem(inventoryPendingKey(pending.userId)) !== null) {
    throw new Error("浏览器未清除库存操作记录，请重试清理");
  }
}

export function inventoryReceipt(
  pending: PendingInventoryAdjustment,
  value: unknown,
): InventoryAdjustmentReceipt {
  try {
    if (
      isRecord(value) &&
      value.ok === true &&
      typeof value.createdAt === "string" &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      sameRequest(pending.request, requestSnapshot(value))
    ) {
      return { ...pending.request, ok: true, createdAt: value.createdAt };
    }
  } catch {
    // Invalid receipt fields are an uncertain response, not a local input error.
  }
  throw new Error("服务端回执与原库存操作不符，结果仍待确认；请使用原操作重试");
}

export function clearConfirmedInventoryPending(
  storage: PendingStorage,
  pending: PendingInventoryAdjustment,
  receipt: InventoryAdjustmentReceipt,
) {
  inventoryReceipt(pending, receipt);
  clearStoredPending(storage, pending);
}

function isInventoryAdjustmentRejected(error: unknown) {
  return (
    isRecord(error) &&
    error.status === 409 &&
    error.code === "inventory_adjustment_rejected"
  );
}

export async function submitInventoryPending(
  storage: PendingStorage,
  pending: PendingInventoryAdjustment,
  currentUserId: () => Promise<string>,
  post: (request: InventoryAdjustmentRequest) => Promise<unknown>,
  firstAttempt = false,
): Promise<
  | {
      outcome: "confirmed";
      receipt: InventoryAdjustmentReceipt;
      cleanupError: string | null;
    }
  | { outcome: "rejected"; message: string }
> {
  requireStoredPending(storage, pending);
  if ((await currentUserId()) !== pending.userId) {
    throw new Error(
      "管理员账号已切换，请重新登录原账号后确认此操作；本次未提交库存调整",
    );
  }
  requireStoredPending(storage, pending);
  let response: unknown;
  try {
    response = await post({ ...pending.request });
  } catch (error) {
    if (!firstAttempt || !isInventoryAdjustmentRejected(error)) throw error;
    // The caller still holds the original browser lock. Remove a fresh,
    // definitively rejected request now, before another tab can replay it.
    // Never retain a rejection proof for a later user-triggered cleanup: that
    // other tab could commit and lose its response in the meantime.
    clearStoredPending(storage, pending);
    return {
      outcome: "rejected",
      message: error instanceof Error ? error.message : "库存调整未执行",
    };
  }
  const receipt = inventoryReceipt(pending, response);
  // Cleanup failure is separate from a failed request: a verified receipt must
  // never send the operator back through the inventory POST just to refresh UI.
  let cleanupError: string | null = null;
  try {
    clearConfirmedInventoryPending(storage, pending, receipt);
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : "本地记录清理失败";
  }
  return { outcome: "confirmed", receipt, cleanupError };
}
