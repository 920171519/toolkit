import { getCurrentUser } from "@/lib/auth";
import { run } from "@/lib/db";

function redirectTo(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return redirectTo("/login");
  const url = new URL(request.url);
  const key = (url.searchParams.get("key") ?? "").slice(0, 200);
  const requestedNext = url.searchParams.get("next") ?? "/dashboard";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";
  if (key) {
    run(
      "INSERT OR IGNORE INTO notification_reads (user_id, notification_key, read_at) VALUES (?, ?, ?)",
      user.id,
      key,
      new Date().toISOString(),
    );
  }
  return redirectTo(next);
}
