"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card" style={{ maxWidth: 620, margin: "60px auto", padding: 32, textAlign: "center" }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, background: "var(--danger-soft)", color: "var(--danger)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <AlertTriangle size={20} />
      </span>
      <h1 style={{ marginTop: 14, fontSize: 24 }}>页面加载遇到问题</h1>
      <p className="muted small" style={{ marginTop: 7, lineHeight: 1.8 }}>
        系统已记录本次异常。你可以重试当前操作，或返回项目总览。
      </p>
      <div className="toolbar" style={{ justifyContent: "center", marginTop: 18 }}>
        <button type="button" onClick={() => reset()} className="button button-primary">重试</button>
        <Link href="/overview" className="button button-secondary">返回项目总览</Link>
      </div>
    </div>
  );
}
