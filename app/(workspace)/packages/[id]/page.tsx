import { redirect } from "next/navigation";

export default async function LegacyPackageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const target = new URLSearchParams({ open: id });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key !== "project" && key !== "q" && key !== "panel" && key !== "page" && key !== "pageSize" && !key.startsWith("f_")) continue;
    if (Array.isArray(value)) {
      for (const option of value) target.append(key, option);
    } else if (value !== undefined) target.set(key, value);
  }
  redirect(`/packages?${target}`);
}
