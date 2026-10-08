import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { createAxePageScope } from "../src/ui/playwright/axe-scope";
import { createDeadline } from "../src/ui/playwright/deadline";

function fixture(newPage?: () => Promise<Page>) {
  const auxiliary = {
    close: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
  };
  const unrelated = { close: vi.fn(async () => {}) };
  const context = {
    marker: "context",
    newPage: vi.fn(newPage ?? (async () => auxiliary as unknown as Page)),
    pages() {
      return [unrelated];
    },
    identity() {
      return this;
    },
    get label() {
      return this.marker;
    },
  };
  const page = {
    marker: "caller",
    context: vi.fn(() => context as unknown as BrowserContext),
    close: vi.fn(async () => {}),
    identity() {
      return this;
    },
    get label() {
      return this.marker;
    },
  };
  const scope = createAxePageScope(page as unknown as Page);
  return { scope, page, context, auxiliary, unrelated };
}

afterEach(() => vi.useRealTimers());

describe("axe auxiliary page scope", () => {
  it("closes an auxiliary page after an early evaluation error without closing the caller or unrelated pages", async () => {
    const { scope, page, context, auxiliary, unrelated } = fixture();
    auxiliary.evaluate.mockRejectedValueOnce(new Error("Injection failed"));
    const audit = async () => {
      const aggregation = await scope.page.context().newPage();
      await aggregation.evaluate(() => {});
    };
    await expect(audit().finally(() => scope.close())).rejects.toThrow(
      "Injection failed",
    );
    expect(auxiliary.close).toHaveBeenCalledOnce();
    expect(page.close).not.toHaveBeenCalled();
    expect(unrelated.close).not.toHaveBeenCalled();
    expect(scope.page.context().pages()).toEqual([unrelated]);
    expect(context.newPage).toHaveBeenCalledOnce();
  });

  it("closes an auxiliary page when analysis stalls beyond its deadline", async () => {
    vi.useFakeTimers();
    const { scope, auxiliary } = fixture();
    auxiliary.evaluate.mockImplementationOnce(() => new Promise(() => {}));
    const result = createDeadline(30, "Audit")
      .run("accessibility", async () => {
        const aggregation = await scope.page.context().newPage();
        await aggregation.evaluate(() => {});
      })
      .finally(() => scope.close());
    const assertion = expect(result).rejects.toThrow(
      "Audit timed out after 30 ms during accessibility",
    );
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(auxiliary.close).toHaveBeenCalledOnce();
  });

  it("closes and rejects a late page creation, then rejects further allocations before calling the context", async () => {
    let complete!: (page: Page) => void;
    const pending = new Promise<Page>((resolve) => {
      complete = resolve;
    });
    const { scope, auxiliary, context } = fixture(() => pending);
    const creation = scope.page.context().newPage();
    const assertion = expect(creation).rejects.toThrow(
      "Accessibility audit scope is closed",
    );
    await scope.close();
    complete(auxiliary as unknown as Page);
    await assertion;
    expect(auxiliary.close).toHaveBeenCalledOnce();
    await expect(scope.page.context().newPage()).rejects.toThrow(
      "Accessibility audit scope is closed",
    );
    expect(context.newPage).toHaveBeenCalledOnce();
  });

  it("uses an idempotent cleanup promise and contains close rejections", async () => {
    const { scope, auxiliary } = fixture();
    auxiliary.close.mockRejectedValueOnce(new Error("Already disconnected"));
    await scope.page.context().newPage();
    const first = scope.close();
    expect(scope.close()).toBe(first);
    await expect(first).resolves.toBeUndefined();
    await scope.close();
    expect(auxiliary.close).toHaveBeenCalledOnce();
  });

  it("bounds cleanup even if the underlying close never settles", async () => {
    vi.useFakeTimers();
    const { scope, auxiliary } = fixture();
    auxiliary.close.mockImplementationOnce(() => new Promise(() => {}));
    await scope.page.context().newPage();
    const cleanup = scope.close();
    const assertion = expect(cleanup).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(auxiliary.close).toHaveBeenCalledOnce();
  });

  it("forwards methods and getters with their original receiver and stable context identity", () => {
    const { scope, page, context } = fixture();
    const forwardedPage = scope.page as unknown as typeof page;
    const forwardedContext = scope.page.context() as unknown as typeof context;
    const pageIdentity = forwardedPage.identity;
    const contextIdentity = forwardedContext.identity;
    expect(pageIdentity()).toBe(page);
    expect(contextIdentity()).toBe(context);
    expect(forwardedPage.identity).toBe(pageIdentity);
    expect(forwardedContext.identity).toBe(contextIdentity);
    expect(forwardedPage.label).toBe("caller");
    expect(forwardedContext.label).toBe("context");
    expect(scope.page.context()).toBe(forwardedContext);
    expect(page.context()).toBe(context);
    expect(context.newPage).not.toHaveBeenCalled();
  });
});
