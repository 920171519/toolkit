import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const destination = request.nextUrl.clone();
  destination.searchParams.delete("_rsc");
  headers.set("x-toolkit-workspace-path", destination.pathname + destination.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/dashboard/:path*", "/overview/:path*", "/projects/:path*", "/packages/:path*",
    "/submissions/:path*", "/integration/:path*", "/trial/:path*", "/formal/:path*",
    "/versions/:path*", "/settings/:path*", "/account/password",
  ],
};
