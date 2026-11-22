import Link from "next/link";
import { SearchX } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, padding: 36, textAlign: "center" }}>
        <Brand />
        <div style={{ marginTop: 28, display: "inline-flex", width: 44, height: 44, borderRadius: 12, background: "var(--surface-muted)", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
          <SearchX size={20} aria-hidden="true" />
        </div>
        <h1 style={{ marginTop: 14, fontSize: 26 }}>页面或记录不存在</h1>
        <div className="toolbar" style={{ justifyContent: "center", marginTop: 20 }}>
          <Link href="/" className="button button-secondary">返回公开首页</Link>
          <Link href="/dashboard" className="button button-primary">进入工作台</Link>
        </div>
      </div>
    </div>
  );
}
