import type { ElementSnapshot, UISnapshot } from '../core/types';
export interface CollectOptions { maxElements?: number }

/** Self-contained so Playwright can serialize this function into the page. */
export function collectSnapshot(options: CollectOptions = {}): UISnapshot {
  const maxElements = options.maxElements ?? 10000;
  if (!Number.isInteger(maxElements) || maxElements < 1) throw new Error('maxElements must be a positive integer.');
  const all = Array.from(document.querySelectorAll('*'));
  const limitations: string[] = [];
  if (all.length > maxElements) limitations.push(`DOM collection truncated to ${maxElements} of ${all.length} elements.`);
  if (document.querySelector('iframe')) limitations.push('Custom UX/layout checks do not traverse iframe documents.');
  if (all.some(el => el.shadowRoot)) limitations.push('Custom UX/layout checks do not traverse shadow roots.');
  limitations.push('Closed shadow roots, canvas contents, and pseudo-elements are not inspected by custom checks.');
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    let ancestor: Element | null = el;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || ancestor.hasAttribute('hidden')) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  };
  const targetFor = (el: Element): string => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current) {
      const tag = current.localName;
      const parent: Element | null = current.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const siblings = Array.from(parent.children).filter(child => child.localName === tag);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = parent;
    }
    return parts.join(' > ');
  };
  const textForIds = (ids: string | null): string => (ids ?? '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
  const attributesToCollect = ['type', 'tabindex', 'aria-invalid', 'aria-busy', 'aria-pressed', 'aria-expanded'];
  const stylesToCollect = ['display', 'fontSize', 'fontWeight', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap'];
  const elements: ElementSnapshot[] = [];
  for (const el of all.slice(0, maxElements)) {
    if (['script', 'style', 'meta', 'link', 'head', 'title', 'noscript'].includes(el.localName)) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (const name of attributesToCollect) if (el.hasAttribute(name)) attributes[name] = el.getAttribute(name)!;
    // Record presence only, never entered values, placeholders, or raw HTML.
    if (el.hasAttribute('placeholder')) attributes.placeholder = 'present';
    const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []) : [];
    const referencedLabels = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)).filter((label): label is HTMLElement => !!label);
    if ([...labels, ...referencedLabels].some(label => isVisible(label) && !!label.textContent?.trim())) attributes['data-glocon-visible-label'] = 'true';
    if (textForIds(el.getAttribute('aria-describedby')) || textForIds(el.getAttribute('aria-errormessage'))) attributes['data-glocon-error-text'] = 'true';
    const feedback = '[role="status"], [role="progressbar"], progress, [data-glocon-feedback="true"]';
    if (el.matches(feedback) || Array.from(el.querySelectorAll(feedback)).some(isVisible)) attributes['data-glocon-feedback'] = 'true';
    const tag = el.localName;
    const role = el.getAttribute('role') ?? ({ button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox', a: 'link' } as Record<string, string>)[tag] ?? '';
    const interactive = el.matches('button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="slider"]');
    const rawName = textForIds(el.getAttribute('aria-labelledby')) || el.getAttribute('aria-label') || labels.map(label => label.textContent).join(' ').trim() || (['button', 'a', 'summary'].includes(tag) ? el.textContent?.trim() : '') || el.getAttribute('alt') || el.getAttribute('title') || '';
    const ignored = el.closest('[data-glocon-ignore]');
    const ignore = ignored?.getAttribute('data-glocon-ignore')?.split(/[\s,]+/).filter(Boolean) ?? [];
    if (ignore.length) limitations.push(`Inline suppression at ${targetFor(ignored!)}: ${ignore.join(', ')} (custom rules only).`);
    elements.push({ target: targetFor(el), tag, role, name: rawName ? '[named]' : '', visible: isVisible(el), disabled: el.matches(':disabled') || !!el.closest('[inert]') || el.getAttribute('aria-disabled') === 'true', interactive,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, attributes,
      styles: Object.fromEntries(stylesToCollect.map(key => [key, style[key as keyof CSSStyleDeclaration] as string])),
      ...(el.hasAttribute('data-glocon-component') ? { component: el.getAttribute('data-glocon-component')! } : {}), ...(el.hasAttribute('data-glocon-variant') ? { variant: el.getAttribute('data-glocon-variant')! } : {}), ignore });
  }
  return { platform: 'web', url: `${location.origin}${location.pathname}`, viewport: { width: innerWidth, height: innerHeight }, document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }, elements, limitations: [...new Set(limitations)] };
}
