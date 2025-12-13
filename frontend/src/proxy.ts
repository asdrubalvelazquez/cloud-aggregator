import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  // Temporalmente deshabilitado - causar redirect loop
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
