import { redirect } from "next/navigation";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const name of ["q", "stage", "pageSize", "page", "flash", "tone"]) {
    const value = params[name];
    if (typeof value === "string" && value) search.set(name, value);
  }
  if (!search.has("stage") && params.status === "ARCHIVED") search.set("stage", "ENDED");
  redirect(search.size ? `/overview?${search.toString()}` : "/overview");
}
