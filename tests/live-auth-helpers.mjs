export function isAuthRateLimit(error) {
  return error?.status === 429 || /rate limit/i.test(error?.message || "");
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
