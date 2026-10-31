"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Leaf, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

type Session = {
  isAdmin: boolean;
  user?: { id: string; email: string } | null;
};

export default function Login() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<Session>("/session")
      .then((result: Session) => {
        if (cancelled) return;
        setSession(result);
        if (result.isAdmin) location.replace("/admin");
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "无法检查登录状态",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const code = new FormData(event.currentTarget).get("code");
    setBusy(true);
    setError("");
    try {
      await api("/admin/activate", "POST", { code });
      location.replace("/admin");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "激活失败，请稍后重试",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mm-login">
      <div className="mm-login-brand">
        <span className="brand-mark">
          <Leaf />
        </span>
        <span className="brand-word">SELLER CENTRE</span>
      </div>
      <div className="mm-login-card">
        <ShieldCheck size={30} />
        <p className="section-kicker">SELLER CENTRE</p>
        <h1>管理员登录</h1>
        <p>使用获授权的账号进入商家工作台。</p>
        {loading ? (
          <p>正在检查登录状态…</p>
        ) : !session?.user ? (
          <a
            className="mm-btn full"
            target="_top"
            href="/signin-with-chatgpt?return_to=%2Fadmin%2Flogin"
          >
            使用 ChatGPT 账号登录 <ArrowRight size={17} />
          </a>
        ) : (
          <>
            <div className="mm-notice">当前账号：{session.user.email}</div>
            <form className="mm-form" onSubmit={activate}>
              <label className="full">
                首次管理员激活码
                <input
                  name="code"
                  type="password"
                  autoComplete="one-time-code"
                  required
                  maxLength={160}
                />
              </label>
              <button className="mm-btn full" disabled={busy}>
                {busy ? "验证中…" : "激活并进入工作台"}
              </button>
            </form>
            <p className="mm-muted">
              已有权限的账号会自动进入后台。首次激活后，其他账号需由主管理员授权。
            </p>
            <details>
              <summary>员工授权信息</summary>
              <p>请将以下账号 ID 提供给主管理员，由其在员工权限中添加。</p>
              <code className="mm-account-id">{session.user.id}</code>
            </details>
            <a
              className="mm-text-link"
              target="_top"
              href="/signout-with-chatgpt?return_to=%2Fadmin%2Flogin"
            >
              切换账号
            </a>
          </>
        )}
        {error && (
          <p className="mm-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Link className="mm-text-link" href="/">
        返回商城
      </Link>
    </main>
  );
}
