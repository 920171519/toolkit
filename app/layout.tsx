import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import "./site.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: {
    default: "工程协同台 · 软件工程部",
    template: "%s · 工程协同台",
  },
  description: "软件工程部项目联系人、软件包版本与转测流程协同平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
