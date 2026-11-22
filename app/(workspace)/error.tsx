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
        <AlertTriangle size={20} aria-hidden="true" />
      </span>
      <h1 style={{ marginTop: 14, fontSize: 24 }}>页面加载失败</h1>
      <div className="toolbar" style={{ justifyContent: "center", marginTop: 18 }}>
        <button type="button" onClick={() => reset()} className="button button-primary">重新加载</button>
        <Link href="/overview" className="button button-secondary">返回项目总览</Link>
      </div>
    </div>
  );
}
