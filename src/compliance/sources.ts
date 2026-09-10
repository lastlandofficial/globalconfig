import { createHash } from "node:crypto";
import type { Requirement } from "./types";
export interface SourceObservation {
  url: string;
  status: "unchanged" | "changed" | "unavailable" | "not-checked";
  checkedAt: string;
  digest?: string;
  message?: string;
}
export function officialSource(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      [
        "taxinformation.cbic.gov.in",
        "cbic-gst.gov.in",
        "tutorial.gst.gov.in",
        "www.nta.go.jp",
        "cdtfa.ca.gov",
        "www.cdtfa.ca.gov",
        "www.meity.gov.in",
        "oag.ca.gov",
        "www.ftc.gov",
        "www.ppc.go.jp",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
/** Opt-in document-byte checks; no automatic updates to legal rules. */
export async function checkSources(
  requirements: readonly Requirement[],
  baseline: Readonly<Record<string, string>> = {},
  fetcher: typeof fetch = fetch,
): Promise<SourceObservation[]> {
  const results: SourceObservation[] = [];
  for (const url of new Set(requirements.map((r) => r.source))) {
    const checkedAt = new Date().toISOString();
    if (!officialSource(url)) {
      results.push({
        url,
        status: "not-checked",
        checkedAt,
        message: "URL is not in the supported official-source allowlist.",
      });
      continue;
    }
    try {
      let current = url,
        response: Response | undefined;
      const signal = AbortSignal.timeout(12000);
      for (let redirect = 0; redirect < 4; redirect++) {
        response = await fetcher(current, {
          redirect: "manual",
          signal,
          headers: { accept: "text/html,application/pdf" },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw Error("Redirect has no destination.");
          current = new URL(location, current).href;
          if (!officialSource(current))
            throw Error("Redirect left supported official sources.");
          continue;
        }
        break;
      }
      if (!response?.ok || !response.body)
        throw Error(
          `Source unavailable (HTTP ${response?.status ?? "unknown"}).`,
        );
      const reader = response.body.getReader(),
        hash = createHash("sha256");
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 5 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Source exceeds the 5 MiB document limit.");
        }
        hash.update(chunk.value);
      }
      if (!size) throw Error("Empty document.");
      const value = hash.digest("hex");
      results.push({
        url,
        status: baseline[url]
          ? baseline[url] === value
            ? "unchanged"
            : "changed"
          : "not-checked",
        checkedAt,
        digest: value,
        ...(!baseline[url]
          ? {
              message:
                "No recorded content baseline. Review the document before recording its digest.",
            }
          : {}),
      });
    } catch (e) {
      results.push({
        url,
        status: "unavailable",
        checkedAt,
        message: e instanceof Error ? e.message : "Source request failed.",
      });
    }
  }
  return results;
}
