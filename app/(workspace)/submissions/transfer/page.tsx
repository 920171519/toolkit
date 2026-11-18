import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canSubmitForPackage } from "@/lib/permissions";
import { getPackagesOverview } from "@/lib/queries";
import { TransferRequestForm } from "@/components/transfer-request-form";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "提交转测申请" };

export default async function NewTransferRequestPage() {
  const user = await requireUser();
  const packages = getPackagesOverview().filter((pkg) => pkg.isActive && canSubmitForPackage(user, pkg.ownerId));
  return (
    <>
      <PageHeader
        eyebrow="Transfer request"
        title="提交转测申请"
        description="提交后会同步发送到该软件包涉及的全部在行项目；五项信息均为必填。"
        actions={<Link href="/submissions" className="button button-secondary"><ArrowLeft size={14} />返回待转测申请</Link>}
      />
      <section className="card" style={{ maxWidth: 760 }}>
        <div className="card-body">
          {packages.length === 0 ? <EmptyState title="没有可提交的软件包" description="你当前不是启用软件包的责任人，无法提交转测申请。" /> : <TransferRequestForm packages={packages} />}
        </div>
      </section>
    </>
  );
}
