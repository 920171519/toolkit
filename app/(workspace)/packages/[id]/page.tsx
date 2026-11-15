import { redirect } from "next/navigation";

export default async function LegacyPackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/packages?open=${encodeURIComponent(id)}`);
}
