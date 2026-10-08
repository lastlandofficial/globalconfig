import type { ElementSnapshot, Rect, UISnapshot } from "../core/types";
export interface CollectOptions {
  maxElements?: number;
}

/** Self-contained so Playwright can serialize this function into the page. */
export function collectSnapshot(options: CollectOptions = {}): UISnapshot {
  const maxElements = options.maxElements ?? 10000;
  if (!Number.isInteger(maxElements) || maxElements < 1)
    throw new Error("maxElements must be a positive integer.");
  const all = Array.from(document.querySelectorAll("*"));
  const limitations: string[] = [];
  if (all.length > maxElements)
    limitations.push(
      `DOM collection truncated to ${maxElements} of ${all.length} elements.`,
    );
  if (document.querySelector("iframe"))
    limitations.push(
      "Custom UX/layout checks do not traverse iframe documents.",
    );
  if (all.some((el) => el.shadowRoot))
    limitations.push("Custom UX/layout checks do not traverse shadow roots.");
  limitations.push(
    "Closed shadow roots, canvas contents, and pseudo-elements are not inspected by custom checks.",
  );
  const idCounts = new Map<string, number>();
  const siblingCounts = new Map<Element, Map<string, number>>();
  const siblingIndices = new WeakMap<Element, number>();
  for (const el of all) {
    if (el.id) idCounts.set(el.id, (idCounts.get(el.id) ?? 0) + 1);
    if (el.parentElement) {
      let counts = siblingCounts.get(el.parentElement);
      if (!counts) {
        counts = new Map();
        siblingCounts.set(el.parentElement, counts);
      }
      const index = (counts.get(el.localName) ?? 0) + 1;
      counts.set(el.localName, index);
      siblingIndices.set(el, index);
    }
  }
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const rectangles = new WeakMap<Element, DOMRect>();
  const styleFor = (el: Element): CSSStyleDeclaration => {
    let style = styles.get(el);
    if (!style) {
      style = getComputedStyle(el);
      styles.set(el, style);
    }
    return style;
  };
  const rectFor = (el: Element): DOMRect => {
    let rect = rectangles.get(el);
    if (!rect) {
      rect = el.getBoundingClientRect();
      rectangles.set(el, rect);
    }
    return rect;
  };
  const hiddenSubtrees = new WeakMap<Element, boolean>();
  const inHiddenSubtree = (el: Element): boolean => {
    const pending: Element[] = [];
    let current: Element | null = el;
    while (current && !hiddenSubtrees.has(current)) {
      pending.push(current);
      current = current.parentElement;
    }
    let hidden = current ? hiddenSubtrees.get(current)! : false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index]!;
      const style = styleFor(node);
      hidden =
        hidden || style.display === "none" || Number(style.opacity) === 0;
      hiddenSubtrees.set(node, hidden);
    }
    return hidden;
  };
  const textRectangles = new WeakMap<Node, DOMRect[]>();
  const textRectsFor = (node: Node): DOMRect[] => {
    if (textRectangles.has(node)) return textRectangles.get(node)!;
    if (!node.textContent?.trim() || !node.parentElement) return [];
    const parent = node.parentElement;
    const visibility = styleFor(parent).visibility;
    if (
      inHiddenSubtree(parent) ||
      visibility === "hidden" ||
      visibility === "collapse"
    )
      return [];
    const range = document.createRange();
    range.selectNodeContents(node);
    const rectangles = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    textRectangles.set(node, rectangles);
    return rectangles;
  };
  const textIsVisible = (node: Node): boolean => textRectsFor(node).length > 0;
  const hasVisibleText = (el: Element): boolean => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (textIsVisible(node)) return true;
    return false;
  };
  const visibility = new WeakMap<Element, boolean>();
  const subtreeBounds = new WeakMap<Element, Rect>();
  const contentBounds = new WeakMap<Element, Rect>();
  const isVisible = (el: Element): boolean => {
    const pending: Array<{ node: Element; childrenReady: boolean }> = [
      { node: el, childrenReady: false },
    ];
    while (pending.length) {
      const { node, childrenReady } = pending.pop()!;
      if (visibility.has(node)) continue;
      const style = styleFor(node);
      const rect = rectFor(node);
      if (inHiddenSubtree(node)) {
        visibility.set(node, false);
        continue;
      }
      const visibleStyle =
        style.visibility !== "hidden" && style.visibility !== "collapse";
      if (visibleStyle && rect.width > 0 && rect.height > 0) {
        visibility.set(node, true);
        subtreeBounds.set(node, rect);
        continue;
      }
      if (!childrenReady) {
        pending.push({ node, childrenReady: true });
        for (const child of node.childNodes)
          if (child.nodeType === Node.ELEMENT_NODE)
            pending.push({ node: child as Element, childrenReady: false });
        continue;
      }
      let bounds: Rect | undefined;
      const include = (rect: Rect) => {
        if (!bounds) {
          bounds = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
          return;
        }
        const right = Math.max(bounds.x + bounds.width, rect.x + rect.width);
        const bottom = Math.max(bounds.y + bounds.height, rect.y + rect.height);
        const x = Math.min(bounds.x, rect.x);
        const y = Math.min(bounds.y, rect.y);
        bounds = { x, y, width: right - x, height: bottom - y };
      };
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const bounds = subtreeBounds.get(child as Element);
          if (bounds) include(bounds);
        } else if (child.nodeType === Node.TEXT_NODE) {
          for (const rect of textRectsFor(child)) include(rect);
        }
      }
      if (bounds) subtreeBounds.set(node, bounds);
      const visible = style.display === "contents" && !!bounds;
      visibility.set(node, visible);
      if (visible) contentBounds.set(node, bounds!);
    }
    return visibility.get(el)!;
  };
  const paths = new WeakMap<Element, string>();
  const targetFor = (el: Element): string => {
    if (el.id && idCounts.get(el.id) === 1) return `#${CSS.escape(el.id)}`;
    const pending: Element[] = [];
    let current: Element | null = el;
    while (current && !paths.has(current)) {
      pending.push(current);
      current = current.parentElement;
    }
    let path = current ? paths.get(current)! : "";
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index]!;
      path = node.parentElement
        ? `${path} > ${node.localName}:nth-of-type(${siblingIndices.get(node)!})`
        : node.localName;
      paths.set(node, path);
    }
    return path;
  };
  const inheritedIgnores = new WeakMap<Element, string[]>();
  const ignoreFor = (el: Element): string[] => {
    const pending: Element[] = [];
    let current: Element | null = el;
    while (current && !inheritedIgnores.has(current)) {
      pending.push(current);
      current = current.parentElement;
    }
    let ignore = current ? inheritedIgnores.get(current)! : [];
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index]!;
      const own =
        node
          .getAttribute("data-glocon-ignore")
          ?.split(/[\s,]+/)
          .filter(Boolean) ?? [];
      if (own.length) {
        limitations.push(
          `Inline suppression at ${targetFor(node)}: ${own.join(", ")} (custom rules only).`,
        );
        ignore = [...new Set([...ignore, ...own])];
      }
      inheritedIgnores.set(node, ignore);
    }
    return ignore;
  };
  const feedback =
    '[role="status"], [role="progressbar"], progress, [data-glocon-feedback="true"]';
  const feedbackAncestors = new WeakSet<Element>();
  for (const marker of document.querySelectorAll(feedback)) {
    if (!isVisible(marker)) continue;
    let ancestor = marker.parentElement;
    while (ancestor && !feedbackAncestors.has(ancestor)) {
      feedbackAncestors.add(ancestor);
      ancestor = ancestor.parentElement;
    }
  }
  const textForIds = (ids: string | null): string =>
    (ids ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
  const attributesToCollect = [
    "type",
    "tabindex",
    "aria-invalid",
    "aria-busy",
    "aria-pressed",
    "aria-expanded",
  ];
  const stylesToCollect = [
    "display",
    "fontSize",
    "fontWeight",
    "borderRadius",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "rowGap",
    "columnGap",
  ];
  const elements: ElementSnapshot[] = [];
  for (const el of all.slice(0, maxElements)) {
    if (
      ["script", "style", "meta", "link", "head", "title", "noscript"].includes(
        el.localName,
      )
    )
      continue;
    const style = styleFor(el);
    const visible = isVisible(el);
    const rect = contentBounds.get(el) ?? rectFor(el);
    const attributes: Record<string, string> = {};
    for (const name of attributesToCollect)
      if (el.hasAttribute(name)) attributes[name] = el.getAttribute(name)!;
    // Record presence only, never entered values, placeholders, or raw HTML.
    if (el.hasAttribute("placeholder")) attributes.placeholder = "present";
    const labels =
      "labels" in el ? Array.from((el as HTMLInputElement).labels ?? []) : [];
    const referencedLabels = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((label): label is HTMLElement => !!label);
    if ([...labels, ...referencedLabels].some((label) => hasVisibleText(label)))
      attributes["data-glocon-visible-label"] = "true";
    if (
      textForIds(el.getAttribute("aria-describedby")) ||
      textForIds(el.getAttribute("aria-errormessage"))
    )
      attributes["data-glocon-error-text"] = "true";
    if (el.matches(feedback) || feedbackAncestors.has(el))
      attributes["data-glocon-feedback"] = "true";
    const tag = el.localName;
    const role =
      el.getAttribute("role") ??
      (
        {
          button: "button",
          input: "textbox",
          select: "combobox",
          textarea: "textbox",
          a: "link",
        } as Record<string, string>
      )[tag] ??
      "";
    const interactive = el.matches(
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="slider"]',
    );
    const rawName =
      textForIds(el.getAttribute("aria-labelledby")) ||
      el.getAttribute("aria-label") ||
      labels
        .map((label) => label.textContent)
        .join(" ")
        .trim() ||
      (["button", "a", "summary"].includes(tag)
        ? el.textContent?.trim()
        : "") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      "";
    const ignore = ignoreFor(el);
    elements.push({
      target: targetFor(el),
      tag,
      role,
      name: rawName ? "[named]" : "",
      visible,
      disabled:
        el.matches(":disabled") ||
        !!el.closest("[inert]") ||
        el.getAttribute("aria-disabled") === "true",
      interactive,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      attributes,
      styles: Object.fromEntries(
        stylesToCollect.map((key) => [
          key,
          style[key as keyof CSSStyleDeclaration] as string,
        ]),
      ),
      ...(el.hasAttribute("data-glocon-component")
        ? { component: el.getAttribute("data-glocon-component")! }
        : {}),
      ...(el.hasAttribute("data-glocon-variant")
        ? { variant: el.getAttribute("data-glocon-variant")! }
        : {}),
      ignore,
    });
  }
  return {
    platform: "web",
    url: `${location.origin}${location.pathname}`,
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    elements,
    collection: {
      total: all.length,
      inspected: Math.min(all.length, maxElements),
      truncated: all.length > maxElements,
    },
    limitations: [...new Set(limitations)],
  };
}
