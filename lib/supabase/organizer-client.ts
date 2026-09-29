import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ORGANIZER_AUTH_COOKIE = "here-organizer-auth";
const LOCAL_FALLBACK_ORIGIN = "http://localhost:3000";

let organizerClient: SupabaseClient | null | undefined;

export function getSupabaseOrganizerClient(): SupabaseClient | null {
  if (organizerClient !== undefined) return organizerClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  organizerClient = url && publishableKey
    ? createBrowserClient(url, publishableKey, {
        isSingleton: false,
        cookieOptions: { name: ORGANIZER_AUTH_COOKIE },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

  return organizerClient;
}

export function getTrustedApplicationOrigin(browserOrigin?: string) {
  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL?.trim(), browserOrigin]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      const isLocalHttp = parsed.protocol === "http:"
        && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
      if (parsed.protocol === "https:" || isLocalHttp) return parsed.origin;
    } catch {
      // Try the next explicitly available origin.
    }
  }
  return LOCAL_FALLBACK_ORIGIN;
}

export function organizerAuthRedirect(path: "/organizer?auth=confirmed" | "/organizer?recovery=1", browserOrigin?: string) {
  return new URL(path, getTrustedApplicationOrigin(browserOrigin)).toString();
}
