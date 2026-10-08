import type { BrowserContext, Page } from "playwright";

/** Own only the auxiliary pages axe opens, while preserving the caller's page. */
export function createAxePageScope(page: Page): {
  page: Page;
  close(): Promise<void>;
} {
  const auxiliaryPages = new Set<Page>();
  const contexts = new WeakMap<BrowserContext, BrowserContext>();
  let closed = false;
  let cleanup: Promise<void> | undefined;

  // Cleanup must not replace an audit failure or obtain an unlimited time budget.
  const closePage = async (auxiliary: Page): Promise<void> => {
    if (auxiliary === page) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => auxiliary.close())
          .catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      auxiliaryPages.delete(auxiliary);
    }
  };

  const forwarding = <T extends object>(target: T) => {
    const methods = new WeakMap<Function, Function>();
    return (property: PropertyKey): unknown => {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      let method = methods.get(value);
      if (!method) {
        method = value.bind(target);
        methods.set(value, method!);
      }
      return method;
    };
  };

  const wrappedContext = (): BrowserContext => {
    const context = page.context();
    const cached = contexts.get(context);
    if (cached) return cached;
    const forward = forwarding(context);
    const newPage = async (): Promise<Page> => {
      if (closed) throw new Error("Accessibility audit scope is closed.");
      const auxiliary = await context.newPage();
      if (closed) {
        await closePage(auxiliary);
        throw new Error("Accessibility audit scope is closed.");
      }
      if (auxiliary !== page) auxiliaryPages.add(auxiliary);
      return auxiliary;
    };
    const proxy = new Proxy(context, {
      get: (_target, property) =>
        property === "newPage" ? newPage : forward(property),
    });
    contexts.set(context, proxy);
    return proxy;
  };

  const forward = forwarding(page);
  const proxy = new Proxy(page, {
    get: (_target, property) =>
      property === "context" ? wrappedContext : forward(property),
  });
  return {
    page: proxy,
    close() {
      if (!cleanup) {
        closed = true;
        cleanup = Promise.all([...auxiliaryPages].map(closePage)).then(
          () => {},
        );
      }
      return cleanup;
    },
  };
}
