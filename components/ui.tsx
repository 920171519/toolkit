import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Inbox } from "lucide-react";
import {
  BATCH_STATUS_META,
  BINDING_STATUS_META,
  BATCH_STATUSES,
  PACKAGE_STATUS_META,
  REVIEW_STATUS_META,
  type BatchStatus,
  type PackageStatus,
} from "@/lib/constants";
import { initials } from "@/lib/format";
import type { Notice } from "@/lib/queries";

export function Badge({
  children,
  tone = "slate",
  dot = false,
  size = "sm",
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
  size?: "sm" | "lg";
}) {
  return (
    <span className={`pill ${size === "lg" ? "pill-lg" : ""}`} data-tone={tone}>
      {dot && <span className="pill-dot" />}
      {children}
    </span>
  );
}

export function Avatar({
  name,
  size = "md",
  tone,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: number;
}) {
  const resolvedTone =
    tone ??
    (Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0) % 5) + 1;
  return (
    <span
      className={`avatar ${size === "sm" ? "avatar-sm" : size === "lg" ? "avatar-lg" : ""}`}
      data-tone={resolvedTone}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  help,
  actions,
}: {
  title: string;
  description?: ReactNode;
  help?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="page-head-title"><h1>{title}</h1>{help}</div>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Inbox size={18} strokeWidth={1.7} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  tone,
}: {
  value: number;
  max: number;
  tone?: "brand" | "rose" | "amber";
}) {
  const percentage = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-label={`已完成 ${value} / ${max}`}
    >
      <div
        className="progress-fill"
        data-tone={tone && tone !== "brand" ? tone : undefined}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const meta = PACKAGE_STATUS_META[status as PackageStatus];
  if (!meta) {
    return <Badge tone="slate">{status}</Badge>;
  }
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  if (!BATCH_STATUSES.includes(status)) return null;
  const meta = BATCH_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function ReviewStatusPill({ status }: { status: keyof typeof REVIEW_STATUS_META }) {
  const meta = REVIEW_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function BindingStatusPill({ status }: { status: keyof typeof BINDING_STATUS_META }) {
  const meta = BINDING_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function StatusBanded({
  tone,
  title,
  children,
}: {
  tone: "emerald" | "amber" | "sky" | "violet" | "rose" | "teal" | "slate";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="status-band">
      <Badge tone={tone} dot>
        {title}
      </Badge>
      {children && <span className="small muted">{children}</span>}
    </div>
  );
}

export function FlashMessage({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className="flash" data-tone={notice.tone} role="status">
      <span aria-hidden="true">●</span>
      <span>{notice.message}</span>
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  className = "archive-link",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
      <ArrowUpRight size={12} strokeWidth={2} />
    </a>
  );
}

export function InlinePerson({
  name,
  meta,
  size = "sm",
}: {
  name: string | null;
  meta?: string | null;
  size?: "sm" | "md";
}) {
  if (!name) return <span className="empty-inline">未指定</span>;
  return (
    <span className="person-inline">
      <Avatar name={name} size={size} />
      <span className="person-inline-copy">
        <span className="person-inline-name">{name}</span>
        {meta && <span className="person-inline-meta">{meta}</span>}
      </span>
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="archive-link">
      {children}
      <ArrowUpRight size={12} strokeWidth={2} />
    </Link>
  );
}
