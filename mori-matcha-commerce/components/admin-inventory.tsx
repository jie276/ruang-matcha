"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "@/lib/api";
import {
  clearConfirmedInventoryPending,
  createInventoryPending,
  inventoryPendingKey,
  readInventoryPending,
  submitInventoryPending,
  type InventoryAdjustmentReceipt,
  type InventoryAdjustmentRequest,
  type PendingInventoryAdjustment,
} from "@/lib/inventory-pending";
import Modal from "./modal";

export type InventorySelection = {
  id: string;
  name: string;
  label: string;
  stock: number;
  userId: string;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "库存操作暂时无法完成";

export default function AdminInventoryAdjustment({
  userId,
  stock,
  onClose,
  onConfirmed,
}: {
  userId: string;
  stock: InventorySelection | null;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
}) {
  const [pending, setPending] = useState<PendingInventoryAdjustment | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [receipt, setReceipt] = useState<InventoryAdjustmentReceipt | null>(
    null,
  );
  const [draft, setDraft] = useState<InventoryAdjustmentRequest | null>(null);
  const inFlight = useRef(false);
  const selected = stock?.userId === userId ? stock : null;
  const isConfirmed = receipt?.operationId === pending?.request.operationId;

  const refreshPending = useCallback(() => {
    try {
      setPending(readInventoryPending(window.localStorage, userId));
      setStorageError("");
      setReady(true);
    } catch (reason) {
      setReady(false);
      setStorageError(messageOf(reason));
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) refreshPending();
    });
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === inventoryPendingKey(userId)) {
        refreshPending();
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      active = false;
      window.removeEventListener("storage", changed);
    };
  }, [refreshPending, userId]);

  async function exclusively(action: () => Promise<void> | void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      // Serialize separate tabs as well as double clicks. Without a browser lock,
      // two new operations could overwrite the sole durable pending snapshot.
      if (!navigator.locks) {
        throw new Error(
          "此浏览器无法安全保存并发库存操作，请使用支持 Web Locks 的浏览器",
        );
      }
      await navigator.locks.request(inventoryPendingKey(userId), action);
    } catch (reason) {
      setError(messageOf(reason));
      refreshPending();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(input?: { delta: number; reason: string }) {
    if (!ready) return;
    await exclusively(async () => {
      const storage = window.localStorage;
      let attempt = pending;
      let firstAttempt = false;
      setNotice("");
      if (!attempt) {
        const existing = readInventoryPending(storage, userId);
        if (existing) {
          setPending(existing);
          setReopen(true);
          throw new Error(
            "另一个页面已有待确认操作，已恢复原记录；请核对后继续确认",
          );
        }
        if (!selected || !input) return;
        attempt = createInventoryPending(
          storage,
          userId,
          {
            skuId: selected.id,
            skuName: selected.name + " " + selected.label,
            ...input,
          },
          crypto.randomUUID(),
        );
        setPending(attempt);
        setReceipt(null);
        firstAttempt = true;
      }
      try {
        const expectedAdminUserId = attempt.userId;
        const result = await submitInventoryPending(
          storage,
          attempt,
          async () => {
            const bootstrap = await api<{ admin: { userId: string } }>(
              "/admin/bootstrap",
            );
            return bootstrap.admin.userId;
          },
          (request) =>
            api("/admin/inventory", "POST", {
              ...request,
              expectedAdminUserId,
            }),
          firstAttempt,
        );
        if (result.outcome === "rejected") {
          setDraft(attempt.request);
          setPending(null);
          setError(
            "本次调整未执行：" +
              result.message +
              "。本次操作已结束，可修改后重新提交。",
          );
          return;
        }
        setReceipt(result.receipt);
        setPending(result.cleanupError ? attempt : null);
        setNotice(
          "库存调整已确认成功。操作编号：" + result.receipt.operationId,
        );
        setError(
          result.cleanupError
            ? "调整已成功，但本地记录清理失败：" + result.cleanupError
            : "",
        );
        setReopen(false);
        onClose();
        // Receipt handling has already finished. Refresh errors never retry POST.
        try {
          await onConfirmed();
        } catch (reason) {
          setError(
            "调整已成功，库存列表刷新失败；请仅刷新列表。" + messageOf(reason),
          );
        }
      } catch (reason) {
        setError(
          messageOf(reason) +
            "。原操作已保留，请继续使用原编号和原参数确认，勿重新创建调整。",
        );
      }
    });
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void submit({
      delta: Number(values.get("delta")),
      reason: String(values.get("reason") || ""),
    });
  }

  function close() {
    setReopen(false);
    onClose();
  }

  async function cleanConfirmed() {
    if (!pending || !receipt || !isConfirmed) return;
    await exclusively(() => {
      clearConfirmedInventoryPending(window.localStorage, pending, receipt);
      setPending(null);
      setError("");
      close();
    });
  }

  return (
    <>
      {notice && (
        <p className="mm-good" role="status">
          {notice}
        </p>
      )}
      {storageError && (
        <div className="mm-error" role="alert">
          <p>无法可靠读取浏览器库存记录，已暂停提交。{storageError}</p>
          <button
            type="button"
            className="mm-btn light"
            disabled={busy}
            onClick={refreshPending}
          >
            重新读取
          </button>
        </div>
      )}
      {pending && (
        <div className="mm-notice" role="status">
          <p>
            {isConfirmed
              ? "库存调整已成功，本地记录尚未清除。"
              : "有一笔库存调整等待确认，请先处理原操作。关闭或刷新页面后仍会保留。"}
          </p>
          <button
            type="button"
            className="mm-btn light"
            disabled={busy}
            onClick={() => setReopen(true)}
          >
            {isConfirmed ? "清理已完成操作" : "继续确认库存调整"}
          </button>
        </div>
      )}
      {error && !selected && !reopen && (
        <p className="mm-error" role="alert">
          {error}
        </p>
      )}
      {(selected || (reopen && pending)) && (
        <Modal
          title={
            "库存调整 · " +
            (pending?.skuName ||
              (selected ? selected.name + " " + selected.label : ""))
          }
          onClose={close}
        >
          {!ready && (
            <p className="mm-error">
              浏览器库存操作记录尚未就绪，请先重新读取记录。
            </p>
          )}
          {pending ? (
            <div className="mm-form">
              <div className="full">
                <p>SKU：{pending.request.skuId}</p>
                <p>
                  调整数量：
                  <strong>
                    {pending.request.delta > 0 ? "+" : ""}
                    {pending.request.delta}
                  </strong>
                </p>
                <p>调整原因：{pending.request.reason}</p>
                <p className="mm-muted">
                  操作编号：{pending.request.operationId}
                </p>
                <p>
                  {isConfirmed
                    ? "已收到成功回执，清理本地记录不会再次调整库存。"
                    : "参数已锁定。继续确认会重发同一操作，服务端不会重复调整库存。"}
                </p>
              </div>
              {error && (
                <p className="mm-error full" role="alert">
                  {error}
                </p>
              )}
              {isConfirmed ? (
                <button
                  type="button"
                  className="mm-btn full"
                  disabled={busy || !ready}
                  onClick={() => void cleanConfirmed()}
                >
                  清理已完成记录
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="mm-btn full"
                    disabled={busy || !ready}
                    onClick={() => void submit()}
                  >
                    {busy ? "正在确认…" : "使用原操作继续确认"}
                  </button>
                </>
              )}
            </div>
          ) : selected ? (
            <form key={selected.id} className="mm-form" onSubmit={submitForm}>
              <p className="full">
                当前可用库存：<strong>{selected.stock}</strong>
                。最终以服务端校验为准。
              </p>
              <label className="full">
                调整数量（正数入库，负数出库）
                <input
                  name="delta"
                  required
                  type="number"
                  step="1"
                  min={-10000000}
                  max={10000000}
                  defaultValue={
                    draft?.skuId === selected.id ? draft.delta : undefined
                  }
                />
              </label>
              <label className="full">
                调整原因
                <input
                  name="reason"
                  required
                  maxLength={160}
                  placeholder="如：采购入库 / 盘点修正"
                  defaultValue={
                    draft?.skuId === selected.id ? draft.reason : undefined
                  }
                />
              </label>
              {error && (
                <p className="mm-error full" role="alert">
                  {error}
                </p>
              )}
              <button className="mm-btn full" disabled={busy || !ready}>
                {busy ? "正在确认…" : "确认调整"}
              </button>
            </form>
          ) : null}
        </Modal>
      )}
    </>
  );
}
