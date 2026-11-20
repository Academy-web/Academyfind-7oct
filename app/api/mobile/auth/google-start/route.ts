import { NextRequest, NextResponse } from "next/server";

/**
 * Initiates Google OAuth for mobile app.
 * Opens Google's consent screen, then Google redirects to /api/mobile/auth/google-callback
 * The callback creates a session and redirects back to the app via deep link.
 */
export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "Google Client ID not configured" }, { status: 500 });
    }

    // Derive base URL (handles reverse proxy, custom headers, or defaults to canonical production URL)
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    const host = forwardedHost || request.headers.get("host") || "";

    let baseUrl = "https://academyfind.com";
    if (process.env.NODE_ENV === "development" && host.includes("localhost")) {
      baseUrl = "http://localhost:3000";
    } else if (forwardedHost && !forwardedHost.includes("localhost")) {
      baseUrl = `${forwardedProto}://${forwardedHost}`;
    } else if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.includes("localhost")) {
      baseUrl = process.env.NEXTAUTH_URL;
    }
    const redirectUri = `${baseUrl}/api/mobile/auth/google-callback`;

    // Generate a state token for CSRF protection
    const state = crypto.randomUUID();
    
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "select_account");
    authUrl.searchParams.set("state", `mobile_${state}`);

    return NextResponse.redirect(authUrl.toString());
  } catch (error: any) {
    console.error("Google OAuth Start Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to initiate Google login" },
      { status: 500 }
    );
  }
}
