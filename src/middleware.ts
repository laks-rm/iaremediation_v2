import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/setup-password"];
const PUBLIC_PREFIXES = ["/api/auth", "/api/v1/auth"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "callbackUrl",
      `${pathname}${request.nextUrl.search}`,
    );

    return NextResponse.redirect(loginUrl);
  }

  if (token.role === "Pending" && pathname !== "/pending-access") {
    return NextResponse.redirect(new URL("/pending-access", request.url));
  }

  if (pathname === "/admin" && token.is_admin !== true) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (
    token.role === "Auditee" &&
    pathname === "/dashboard" &&
    !searchParams.has("view")
  ) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.searchParams.set("view", "mine");

    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
