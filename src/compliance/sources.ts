import { createHash } from "node:crypto";
import { setMaxListeners } from "node:events";
import type { Requirement } from "./types";

export interface SourceBaselineRecord {
  version: 1;
  digest: string;
  effectiveURL: string;
}
/** Legacy digest strings are accepted and upgraded when explicitly recorded. */
export type SourceBaseline = Record<string, string | SourceBaselineRecord>;
export interface SourceObservation {
  url: string;
  status: "unchanged" | "changed" | "unavailable" | "not-checked";
  checkedAt: string;
  digest?: string;
  effectiveURL?: string;
  /** Requested document URL followed by each allowed redirect destination. */
  redirectChain?: string[];
  reviewRequired?: boolean;
  message?: string;
}
export interface SourceCheckOptions {
  /** Maximum simultaneous requests across all hosts (1–32, default 4). */
  concurrency?: number;
  /** Maximum simultaneous requests to one host (default 1). */
  perHostConcurrency?: number;
  /** Minimum delay between request starts on one host (default 200 ms). */
  perHostDelayMs?: number;
  /** Deadline for the entire check, including queueing (default 60,000 ms). */
  timeoutMs?: number;
  /** Deadline for one document, including redirects/body (default 12,000 ms). */
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

function documentURL(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 10_000)
    throw Error(`${label} must be an absolute HTTPS URL.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Error(`${label} must be an absolute HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  )
    throw Error(`${label} must be an HTTPS URL without credentials.`);
  parsed.hash = ""; // Fragments are not sent when requesting a document.
  return parsed.href;
}

function contentDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{64}$/i.test(value))
    throw Error("Source baseline digest must be a SHA-256 hexadecimal string.");
  return value.toLowerCase();
}

/** Validate persisted baselines before performing any network or write work. */
export function validateSourceBaseline(input: unknown): SourceBaseline {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Source baseline must be an object keyed by document URL.");
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw Error("Source baseline must be a plain object.");
  const entries = Object.entries(input);
  if (entries.length > 10_000)
    throw Error("Source baseline cannot contain more than 10000 documents.");
  const baseline: SourceBaseline = {};
  for (const [url, entry] of entries) {
    documentURL(url, "Source baseline key");
    if (typeof entry === "string") {
      baseline[url] = contentDigest(entry);
      continue;
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) ||
      Object.keys(entry).some(
        (key) => !["version", "digest", "effectiveURL"].includes(key),
      )
    )
      throw Error(
        "Source baseline record must contain version, digest and effectiveURL.",
      );
    const record = entry as Record<string, unknown>;
    if (record.version !== 1)
      throw Error("Source baseline record version must be 1.");
    baseline[url] = {
      version: 1,
      digest: contentDigest(record.digest),
      effectiveURL: documentURL(
        record.effectiveURL,
        "Source baseline effectiveURL",
      ),
    };
  }
  return baseline;
}

/** Record successful, explicitly reviewed observations and preserve failed checks. */
export function recordSourceBaseline(
  baseline: Readonly<SourceBaseline>,
  observations: readonly SourceObservation[],
): SourceBaseline {
  const next = validateSourceBaseline(baseline);
  for (const observation of observations) {
    if (
      observation.status === "unavailable" ||
      !observation.digest ||
      !observation.effectiveURL
    )
      continue;
    if (
      !officialSource(observation.url) ||
      !officialSource(observation.effectiveURL)
    )
      throw Error(
        "Cannot record a source outside the supported official-source allowlist.",
      );
    next[observation.url] = {
      version: 1,
      digest: contentDigest(observation.digest),
      effectiveURL: documentURL(
        observation.effectiveURL,
        "Source effectiveURL",
      ),
    };
  }
  return validateSourceBaseline(next);
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

function integerOption(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < minimum || result > maximum)
    throw Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return result;
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : Error("Source check was aborted.");
}

/** Bounds custom fetchers/body readers that do not honor AbortSignal. */
function withSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(aborted(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted(signal));
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface Waiter {
  grant: () => void;
}
class RequestSlots {
  private available: number;
  private readonly queue: Waiter[] = [];
  constructor(limit: number) {
    this.available = limit;
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw aborted(signal);
    if (this.available > 0) this.available--;
    else
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(aborted(signal));
        };
        const waiter = {
          grant: () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        this.queue.push(waiter);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next.grant();
      else this.available++;
    };
  }
}

/** Opt-in document-byte checks; no automatic updates to legal rules. */
export async function checkSources(
  requirements: readonly Requirement[],
  baseline: Readonly<SourceBaseline> = {},
  fetcher: typeof fetch = fetch,
  options: SourceCheckOptions = {},
): Promise<SourceObservation[]> {
  const recorded = validateSourceBaseline(baseline);
  if (!Array.isArray(requirements) || requirements.length > 1000)
    throw Error("Source checks require an array of at most 1000 requirements.");
  if (
    !requirements.every(
      (r) => r && typeof r.source === "string" && r.source.length <= 10_000,
    )
  )
    throw Error("Each source requirement must have a document URL.");
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw Error("Source check options must be an object.");
  const concurrency = integerOption(
      options.concurrency,
      4,
      "concurrency",
      1,
      32,
    ),
    perHostConcurrency = integerOption(
      options.perHostConcurrency,
      1,
      "perHostConcurrency",
      1,
      concurrency,
    ),
    perHostDelayMs = integerOption(
      options.perHostDelayMs,
      200,
      "perHostDelayMs",
      0,
      60_000,
    ),
    timeoutMs = integerOption(
      options.timeoutMs,
      60_000,
      "timeoutMs",
      1,
      3_600_000,
    ),
    requestTimeoutMs = integerOption(
      options.requestTimeoutMs,
      12_000,
      "requestTimeoutMs",
      1,
      300_000,
    );
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw Error("Source check signal must be an AbortSignal.");
  const controller = new AbortController();
  // One listener per bounded requirement is intentional; every listener is removed.
  setMaxListeners(0, controller.signal);
  const externalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        Error(`Source check exceeded its ${timeoutMs} ms deadline.`),
      ),
    timeoutMs,
  );
  const slots = new RequestSlots(concurrency);
  const hosts = new Map<
    string,
    { slots: RequestSlots; starts: RequestSlots; lastStarted: number }
  >();
  const urls = [...new Set(requirements.map((r) => r.source))];
  try {
    return await Promise.all(
      urls.map(async (url): Promise<SourceObservation> => {
        let checkedAt = new Date().toISOString();
        if (!officialSource(url))
          return {
            url,
            status: "not-checked",
            checkedAt,
            reviewRequired: true,
            message: "URL is not in the supported official-source allowlist.",
          };
        const requestController = new AbortController();
        const parentAbort = () =>
          requestController.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", parentAbort, {
          once: true,
        });
        if (controller.signal.aborted) parentAbort();
        const signal = requestController.signal;
        let requestTimer: ReturnType<typeof setTimeout> | undefined;
        let response: Response | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let current = documentURL(url, "Source URL");
        const redirectChain = [current];
        try {
          for (let redirect = 0; ; redirect++) {
            const hostname = new URL(current).hostname;
            let host = hosts.get(hostname);
            if (!host) {
              host = {
                slots: new RequestSlots(perHostConcurrency),
                starts: new RequestSlots(1),
                lastStarted: 0,
              };
              hosts.set(hostname, host);
            }
            const releaseHost = await host.slots.acquire(signal);
            let releaseGlobal: (() => void) | undefined;
            try {
              releaseGlobal = await slots.acquire(signal);
              // Serialize starts separately from response bodies. Recompute from
              // the actual start so event-loop delays cannot produce a burst.
              const releaseStart = await host.starts.acquire(signal);
              let request: Promise<Response>;
              try {
                await delay(
                  host.lastStarted + perHostDelayMs - Date.now(),
                  signal,
                );
                if (signal.aborted) throw aborted(signal);
                if (requestTimer === undefined)
                  requestTimer = setTimeout(
                    () =>
                      requestController.abort(
                        Error(
                          `Source document exceeded its ${requestTimeoutMs} ms deadline.`,
                        ),
                      ),
                    requestTimeoutMs,
                  );
                checkedAt = new Date().toISOString();
                host.lastStarted = Date.now();
                request = fetcher(current, {
                  redirect: "manual",
                  signal,
                  headers: {
                    accept:
                      "text/html,application/xhtml+xml,application/pdf,text/plain",
                  },
                });
              } finally {
                releaseStart();
              }
              void request.then(
                (lateResponse) => {
                  if (signal.aborted)
                    void lateResponse.body?.cancel().catch(() => {});
                },
                () => {},
              );
              response = await withSignal(request, signal);
              if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get("location");
                void response.body?.cancel().catch(() => {});
                if (!location) throw Error("Redirect has no destination.");
                if (redirect >= 4)
                  throw Error("Source exceeds the four-redirect limit.");
                const next = documentURL(
                  new URL(location, current).href,
                  "Redirect destination",
                );
                if (!officialSource(next))
                  throw Error("Redirect left supported official sources.");
                if (redirectChain.includes(next))
                  throw Error("Source redirect loop.");
                current = next;
                redirectChain.push(current);
                continue;
              }
              if (response.status !== 200 || !response.body)
                throw Error(
                  `Source unavailable (HTTP ${response.status}). A complete HTTP 200 document is required.`,
                );
              if (response.headers.has("content-range"))
                throw Error(
                  "Partial source documents cannot be used as a content baseline.",
                );
              const length = response.headers.get("content-length");
              const expectedSize =
                length !== null && !response.headers.get("content-encoding")
                  ? Number(length)
                  : undefined;
              if (
                expectedSize !== undefined &&
                (!/^\d+$/.test(length!) || !Number.isSafeInteger(expectedSize))
              )
                throw Error("Source has an invalid Content-Length header.");
              if (expectedSize !== undefined && expectedSize > 5 * 1024 * 1024)
                throw Error("Source exceeds the 5 MiB document limit.");
              const mediaType = response.headers
                .get("content-type")
                ?.split(";", 1)[0]
                ?.trim()
                .toLowerCase();
              if (
                !mediaType ||
                ![
                  "text/html",
                  "application/xhtml+xml",
                  "application/pdf",
                  "text/plain",
                ].includes(mediaType)
              )
                throw Error(
                  `Source response is not a supported document (${mediaType ?? "missing content-type"}).`,
                );
              if (response.url) {
                const actualURL = documentURL(response.url, "Response URL");
                if (actualURL !== current)
                  throw Error(
                    "Fetcher followed an unverified redirect; manual redirects are required.",
                  );
              }
              reader = response.body.getReader();
              const hash = createHash("sha256");
              let size = 0;
              while (true) {
                const chunk = await withSignal(reader.read(), signal);
                if (chunk.done) break;
                size += chunk.value.length;
                if (size > 5 * 1024 * 1024)
                  throw Error("Source exceeds the 5 MiB document limit.");
                hash.update(chunk.value);
              }
              if (!size) throw Error("Empty document.");
              if (expectedSize !== undefined && size !== expectedSize)
                throw Error(
                  "Source document is incomplete: Content-Length does not match its body.",
                );
              const value = hash.digest("hex");
              const previous = recorded[url];
              const previousDigest =
                typeof previous === "string" ? previous : previous?.digest;
              const destinationChanged =
                previous !== undefined &&
                (typeof previous === "string"
                  ? current !== documentURL(url, "Source URL")
                  : current !== previous.effectiveURL);
              const status = !previous
                ? "not-checked"
                : previousDigest !== value || destinationChanged
                  ? "changed"
                  : "unchanged";
              return {
                url,
                status,
                checkedAt,
                digest: value,
                effectiveURL: current,
                redirectChain,
                reviewRequired: status !== "unchanged",
                ...(!previous
                  ? {
                      message:
                        "No recorded content baseline. Review the document and its destination before recording.",
                    }
                  : destinationChanged
                    ? {
                        message:
                          typeof previous === "string"
                            ? "The legacy baseline did not record this redirected destination. Review it before recording."
                            : `Document destination changed from ${previous.effectiveURL} to ${current}. Review it before recording.`,
                      }
                    : {}),
              };
            } finally {
              releaseGlobal?.();
              releaseHost();
            }
          }
        } catch (error) {
          if (reader) void reader.cancel().catch(() => {});
          else void response?.body?.cancel().catch(() => {});
          return {
            url,
            status: "unavailable",
            checkedAt,
            effectiveURL: current,
            redirectChain,
            reviewRequired: true,
            message:
              error instanceof Error ? error.message : "Source request failed.",
          };
        } finally {
          if (requestTimer !== undefined) clearTimeout(requestTimer);
          controller.signal.removeEventListener("abort", parentAbort);
        }
      }),
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}
