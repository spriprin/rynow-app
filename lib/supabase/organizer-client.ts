import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ORGANIZER_AUTH_COOKIE = "here-organizer-auth";
const PRODUCTION_ORIGIN = "https://here-social-room.spriprin.chatgpt.site";

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
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return PRODUCTION_ORIGIN;
    }
  }

  if (browserOrigin) {
    try {
      const parsed = new URL(browserOrigin);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return parsed.origin;
    } catch {
      // Fall through to the fixed production origin.
    }
  }

  return PRODUCTION_ORIGIN;
}

export function organizerAuthRedirect(path: "/organizer?auth=confirmed" | "/organizer?recovery=1", browserOrigin?: string) {
  return new URL(path, getTrustedApplicationOrigin(browserOrigin)).toString();
}
