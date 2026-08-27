export function isAuthRateLimit(error) {
  return error?.status === 429 || /rate limit/i.test(error?.message || "");
}

export const HERE_PRODUCTION_PROJECT_REF = "xwycdnyxuluuhylcnnjh";
export const OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const PRODUCTION_PROJECT_HOST = `${HERE_PRODUCTION_PROJECT_REF}.supabase.co`;

function isolatedProjectRef() {
  const projectRef = process.env.HERE_TEST_ISOLATED_PROJECT_REF;
  if (!projectRef) {
    throw new Error("Isolated Auth tests require HERE_TEST_ISOLATED_PROJECT_REF");
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("HERE_TEST_ISOLATED_PROJECT_REF must be an exact hosted Supabase project ref");
  }
  if (projectRef === HERE_PRODUCTION_PROJECT_REF) {
    throw new Error("The HERE production project can never be marked as an isolated Auth test project");
  }
  return projectRef;
}

export function assertIsolatedTurnstileTestEnvironment(url) {
  if (!url) throw new Error("Turnstile test proof requires HERE_TEST_SUPABASE_URL");
  if (process.env.HERE_TEST_TURNSTILE_MODE !== "isolated-repeatable") {
    throw new Error("Turnstile test proof requires HERE_TEST_TURNSTILE_MODE=isolated-repeatable");
  }
  if (process.env.HERE_TEST_ISOLATED_SUPABASE !== "true") {
    throw new Error("Turnstile test proof requires HERE_TEST_ISOLATED_SUPABASE=true");
  }
  const projectRef = isolatedProjectRef();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("HERE_TEST_SUPABASE_URL must be a valid URL");
  }
  if (parsed.hostname === PRODUCTION_PROJECT_HOST) {
    throw new Error("Cloudflare test proof must never be used against the HERE production Supabase project");
  }
  const expectedOrigin = `https://${projectRef}.supabase.co`;
  if (parsed.origin !== expectedOrigin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("HERE_TEST_SUPABASE_URL must exactly match the authorized isolated hosted Supabase project ref");
  }
}

export function assertRepeatableTurnstileTestEnvironment(url) {
  const token = process.env.HERE_TEST_TURNSTILE_TOKEN;
  if (!token) return;
  assertIsolatedTurnstileTestEnvironment(url);
  if (token !== OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN) {
    throw new Error("Isolated Auth tests require Cloudflare's official always-pass dummy token");
  }
}

export function assertIsolatedPublishableKey(key) {
  if (!key?.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) {
    throw new Error("Isolated Auth tests require the temporary project's publishable key, never a secret/service-role key");
  }
}

export function assertAuthorizedIsolatedAuthLoad(url, key) {
  assertIsolatedTurnstileTestEnvironment(url);
  assertRepeatableTurnstileTestEnvironment(url);
  assertIsolatedPublishableKey(key);
  if (process.env.HERE_TEST_ISOLATED_AUTH_LOAD_ALLOWED !== "true") {
    throw new Error("AUTH-P1/P2 require HERE_TEST_ISOLATED_AUTH_LOAD_ALLOWED=true for the authorized temporary project");
  }
  if (process.env.HERE_TEST_DELETE_ISOLATED_PROJECT_AFTER_RUN !== "true") {
    throw new Error("AUTH-P1/P2 require explicit acknowledgement that the temporary project will be deleted after the run");
  }
}

export function allowPermanentGuestFallback() {
  return process.env.HERE_REQUIRE_RELEASE_GATES !== "true";
}

export function anonymousSignInCredentials() {
  const captchaToken = process.env.HERE_TEST_TURNSTILE_TOKEN;
  if (captchaToken) assertRepeatableTurnstileTestEnvironment(process.env.HERE_TEST_SUPABASE_URL);
  return captchaToken ? { options: { captchaToken } } : undefined;
}

export function withAuthCaptcha(credentials) {
  const captchaToken = process.env.HERE_TEST_TURNSTILE_TOKEN;
  if (!captchaToken) return credentials;
  assertRepeatableTurnstileTestEnvironment(process.env.HERE_TEST_SUPABASE_URL);
  return { ...credentials, options: { ...credentials.options, captchaToken } };
}

export function withAuthCaptchaOptions(options = {}) {
  const captchaToken = process.env.HERE_TEST_TURNSTILE_TOKEN;
  if (captchaToken) assertRepeatableTurnstileTestEnvironment(process.env.HERE_TEST_SUPABASE_URL);
  return captchaToken ? { ...options, captchaToken } : options;
}

export async function retryAuthRateLimit(operation, attempts = 6) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await operation();
    if (!isAuthRateLimit(result.error)) return result;
    const delay = Math.min(10_000, 1_500 * attempt + Math.round(Math.random() * 1_000));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return result;
}
