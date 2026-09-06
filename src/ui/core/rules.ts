import type { ElementSnapshot, Rule } from './types';
const wcag = 'https://www.w3.org/WAI/WCAG22/Understanding/';
const visible = (element: ElementSnapshot) => element.visible;
const field = (element: ElementSnapshot) => ['input', 'select', 'textarea'].includes(element.tag) && !['hidden', 'button', 'submit', 'reset', 'image'].includes(element.attributes.type ?? '');

export const rules: Rule[] = [
  {
    meta: { id: 'layout/overflow', title: 'Horizontal page overflow', category: 'layout', severity: 'warning', confidence: 'high', rationale: 'Unexpected two-axis scrolling makes content harder to read at narrow widths.', helpUrl: `${wcag}reflow.html` },
    check: s => s.platform === 'web' && s.document.scrollWidth > s.document.clientWidth + 1 ? [{ target: 'html', message: 'Content is wider than the page viewport.', evidence: { contentWidth: s.document.scrollWidth, viewportWidth: s.document.clientWidth }, suggestion: 'Inspect fixed widths, long strings, and flex/grid minimum sizes. Use min-width: 0 and wrap content; preserve intentional local scrolling for tables.' }] : [],
  },
  {
    meta: { id: 'interaction/target-size', title: 'Small interaction target', category: 'ux', severity: 'warning', confidence: 'medium', rationale: 'Small controls are harder to activate. This size heuristic does not evaluate WCAG spacing, inline, or equivalent-control exceptions.', helpUrl: `${wcag}target-size-minimum.html` },
    check: (s, o) => s.elements.filter(e => visible(e) && e.interactive && !e.disabled && e.styles.display !== 'inline' && (e.rect.width < (o.targetSize ?? 24) || e.rect.height < (o.targetSize ?? 24))).map(e => ({ target: e.target, message: 'This interaction target may be difficult to activate.', evidence: { width: e.rect.width, height: e.rect.height, recommended: o.targetSize ?? 24, units: s.platform === 'web' ? 'CSS px' : 'layout units' }, suggestion: 'Increase the hit area or verify adequate spacing and an equivalent accessible control. Review platform-specific target guidance.' })),
  },
  {
    meta: { id: 'form/error-description', title: 'Invalid field without linked error text', category: 'ux', severity: 'warning', confidence: 'medium', rationale: 'People need to know what failed and how to recover.', helpUrl: `${wcag}error-identification.html` },
    check: s => s.elements.filter(e => visible(e) && field(e) && e.attributes['aria-invalid'] === 'true' && e.attributes['data-glocon-error-text'] !== 'true').map(e => ({ target: e.target, message: 'Invalid field has no readable linked error or description.', evidence: { invalid: true }, suggestion: 'Render a specific error message and associate its ID using aria-describedby or aria-errormessage. Preserve the entered value.' })),
  },
  {
    meta: { id: 'form/placeholder-label', title: 'Placeholder-only field', category: 'ux', severity: 'warning', confidence: 'medium', rationale: 'Placeholder text disappears while typing and is not a persistent label.', helpUrl: `${wcag}labels-or-instructions.html` },
    check: s => s.elements.filter(e => visible(e) && field(e) && !!e.attributes.placeholder && e.attributes['data-glocon-visible-label'] !== 'true').map(e => ({ target: e.target, message: 'This field has a placeholder but no detected persistent visible label.', evidence: { hasAccessibleName: !!e.name }, suggestion: 'Provide a visible label associated with the input. Keep examples and formatting hints in separate helper text.' })),
  },
  {
    meta: { id: 'interaction/positive-tabindex', title: 'Manually reordered keyboard navigation', category: 'accessibility', severity: 'warning', confidence: 'high', rationale: 'Positive tabindex values can make focus order diverge from reading order.', helpUrl: `${wcag}focus-order.html` },
    check: s => s.elements.filter(e => visible(e) && Number(e.attributes.tabindex) > 0).map(e => ({ target: e.target, message: 'A positive tabindex overrides natural focus order.', evidence: { tabindex: Number(e.attributes.tabindex) }, suggestion: 'Use meaningful DOM order and native controls. Use tabindex="0" only where an extra focus stop is needed.' })),
  },
  {
    meta: { id: 'ux/busy-feedback', title: 'Busy region without explicit feedback', category: 'ux', severity: 'warning', confidence: 'medium', rationale: 'Users need feedback when work is in progress.' },
    check: s => s.elements.filter(e => visible(e) && e.attributes['aria-busy'] === 'true' && e.attributes['data-glocon-feedback'] !== 'true').map(e => ({ target: e.target, message: 'Busy region has no detected status, progress, or loading marker.', evidence: { busy: true }, suggestion: 'Provide visible loading text and an appropriate status announcement. Mark a custom indicator with data-glocon-feedback="true".' })),
  },
  {
    meta: { id: 'consistency/spacing', title: 'Spacing outside the declared scale', category: 'consistency', severity: 'info', confidence: 'high', rationale: 'A project-defined spacing scale can catch accidental one-off values without imposing a visual style.' },
    check: (s, o) => {
      if (!o.spacingScale?.length) return [];
      return s.elements.filter(visible).flatMap(e => {
        const offScale = Object.entries(e.styles).filter(([property, value]) => /^(padding|margin|gap|rowGap|columnGap)/.test(property) && /^-?\d+(\.\d+)?px$/.test(value) && !o.spacingScale!.some(step => Math.abs(step - Math.abs(parseFloat(value))) <= (o.spacingTolerance ?? 0.5)));
        return offScale.length ? [{ target: e.target, message: 'Spacing differs from your configured scale.', evidence: { properties: offScale.map(([key, val]) => `${key}: ${val}`), scale: o.spacingScale! }, suggestion: 'Use a declared spacing token, extend the scale deliberately, or suppress this intentional exception with a reason.' }] : [];
      });
    },
  },
  {
    meta: { id: 'consistency/component-drift', title: 'Style drift within a declared component', category: 'consistency', severity: 'info', confidence: 'medium', rationale: 'Only elements explicitly tagged with the same component and variant are compared.' },
    check: s => {
      const groups = new Map<string, ElementSnapshot[]>();
      for (const e of s.elements.filter(visible)) if (e.component) {
        const key = JSON.stringify([e.component, e.variant ?? 'default', e.disabled, e.attributes['aria-busy'] ?? 'false', e.attributes['aria-pressed'] ?? 'false', e.attributes['aria-expanded'] ?? 'false']);
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      return [...groups.values()].flatMap(group => {
        if (group.length < 3) return [];
        const signature = (e: ElementSnapshot) => JSON.stringify(['fontSize', 'fontWeight', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(k => e.styles[k] ?? ''));
        const frequencies = new Map<string, number>();
        for (const e of group) frequencies.set(signature(e), (frequencies.get(signature(e)) ?? 0) + 1);
        const common = [...frequencies.entries()].sort((a, b) => b[1] - a[1])[0]!;
        if (common[1] <= group.length / 2) return [];
        return group.filter(e => signature(e) !== common[0]).map(e => ({ target: e.target, message: 'This component differs from the majority of its declared peers.', evidence: { component: e.component!, variant: e.variant ?? 'default', peerCount: group.length, majorityCount: common[1] }, suggestion: 'Use the shared component/tokens, or assign an explicit variant when the difference is intentional.' }));
      });
    },
  },
  {
    meta: { id: 'native/control-name', title: 'Unnamed native control', category: 'accessibility', severity: 'error', confidence: 'high', rationale: 'A native accessibility snapshot should expose a name for each actionable control.' },
    check: s => s.platform !== 'native' ? [] : s.elements.filter(e => visible(e) && e.interactive && !e.name.trim()).map(e => ({ target: e.target, message: 'Native control has no accessible name in the supplied snapshot.', evidence: { role: e.role }, suggestion: 'Set accessibilityLabel or expose meaningful accessible text, then verify with VoiceOver and TalkBack.' })),
  },
];
