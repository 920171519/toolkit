import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Brand href="/" />
        <div className="auth-quote">
          <div className="eyebrow" style={{ color: "#b8d2c0" }}>
            Engineering communication map
          </div>
          <h1>
            找对人，
            <br />
            让每个版本<em>有迹可循</em>。
          </h1>
          <p>
            面向部门内部的项目、责任田和软件包协同工作台。从转测、集成验证、试制绑定到正式发布，一条链路看清所有责任人与状态。
          </p>
        </div>
        <div className="auth-meta">
          <span>部门沟通地图</span>
          <span>版本生命周期</span>
          <span>项目节点覆盖</span>
        </div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
