/** Resolve a reviewed destination without allowing credentials or another app origin. */
export function expectedDestination(value: string, baseURL: string): URL {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    /[\\\u0000-\u0020]/.test(value) ||
    (!value.startsWith("/") && !/^https?:\/\//i.test(value)) ||
    value.startsWith("//")
  )
    throw new Error(
      "expectedURL must be a same-origin HTTP(S) URL or a path starting with a single /.",
    );
  const url = new URL(value, baseURL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== new URL(baseURL).origin ||
    url.username ||
    url.password
  )
    throw new Error(
      "expectedURL must stay on baseURL's origin and omit credentials.",
    );
  return url;
}

export function sameDestination(actual: URL, expected: URL): boolean {
  return (
    actual.origin === expected.origin &&
    actual.pathname.replace(/\/$/, "") ===
      expected.pathname.replace(/\/$/, "") &&
    actual.search === expected.search &&
    actual.hash === expected.hash
  );
}
