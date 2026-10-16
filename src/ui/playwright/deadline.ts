/** A single time budget shared by browser setup, readiness and audit phases. */
export function createDeadline(timeout: number, operation: string) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647)
    throw new Error(
      "timeout must be a positive integer no greater than 2147483647 milliseconds.",
    );
  const expires = performance.now() + timeout;
  const timeoutError = (phase: string) =>
    new Error(`${operation} timed out after ${timeout} ms during ${phase}.`);
  const remaining = (phase: string) => {
    const milliseconds = Math.ceil(expires - performance.now());
    if (milliseconds < 1) throw timeoutError(phase);
    return milliseconds;
  };
  return {
    remaining,
    async run<T>(phase: string, action: () => Promise<T>): Promise<T> {
      const milliseconds = remaining(phase);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(action),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(timeoutError(phase)), milliseconds);
          }),
        ]);
        remaining(phase);
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
