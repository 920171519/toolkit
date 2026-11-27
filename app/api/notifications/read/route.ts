import { getCurrentUser } from "@/lib/auth";
import { markNotificationRead } from "@/lib/notification-reads";
import { safeLocalPath } from "@/lib/return-to";

function redirectTo(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return redirectTo("/login");
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const next = safeLocalPath(url.searchParams.get("next")) ?? "/dashboard";
  markNotificationRead(user.id, key);
  return redirectTo(next);
}
