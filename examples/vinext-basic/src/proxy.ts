import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SUPPORTED_LOCALES = ["ar", "es", "zh"];
const DEFAULT_LOCALE = "en";
const ALL_LOCALES = [DEFAULT_LOCALE, ...SUPPORTED_LOCALES];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Check if the path already starts with a supported locale prefix (e.g. /en, /ar/about-zintl)
  const segments = pathname.split("/");
  const firstSegment = segments[1];

  if (ALL_LOCALES.includes(firstSegment)) {
    // Already has a valid locale prefix. Let the request proceed as-is.
    return;
  }

  // 2. The path does not have a locale prefix. We need to handle localization.
  const acceptLanguage = request.headers.get("accept-language") || "";
  const preferredLocale = SUPPORTED_LOCALES.find((locale) =>
    acceptLanguage.toLowerCase().includes(locale),
  );

  // If a preferred locale (ar, es, zh) is detected in request headers, do a real redirect
  if (preferredLocale) {
    const targetPath = pathname === "/" ? `/${preferredLocale}` : `/${preferredLocale}${pathname}`;
    return NextResponse.redirect(new URL(targetPath, request.url));
  }

  // Default fallback: rewrite to DEFAULT_LOCALE (en) under the hood (browser URL does not change)
  const targetPath = pathname === "/" ? `/${DEFAULT_LOCALE}` : `/${DEFAULT_LOCALE}${pathname}`;
  return NextResponse.rewrite(new URL(targetPath, request.url));
}

export const config = {
  matcher: [
    // Match all paths except:
    // - api routes
    // - next internal/static assets (e.g. _next/static, _next/image)
    // - files with extensions (e.g. favicon.ico, images, stylesheets)
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
