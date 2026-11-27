import { getCurrentUser } from "@/lib/auth";
import { markNotificationRead } from "@/lib/notification-reads";

function redirectTo(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return redirectTo("/login");
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const requestedNext = url.searchParams.get("next") ?? "/dashboard";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";
  markNotificationRead(user.id, key);
  return redirectTo(next);
}
