# Built-in rules

Generated from rule metadata. Run `node scripts/generate-rule-docs.mjs` after building to refresh.

## layout/overflow

**Horizontal page overflow** · warning · high confidence · layout

Unexpected two-axis scrolling makes content harder to read at narrow widths.

[Supporting guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## interaction/target-size

**Small interaction target** · warning · medium confidence · ux

Small controls are harder to activate. This size heuristic does not evaluate WCAG spacing, inline, or equivalent-control exceptions.

[Supporting guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## form/error-description

**Invalid field without linked error text** · warning · medium confidence · ux

People need to know what failed and how to recover.

[Supporting guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html).

## form/placeholder-label

**Placeholder-only field** · warning · medium confidence · ux

Placeholder text disappears while typing and is not a persistent label.

[Supporting guidance](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).

## interaction/positive-tabindex

**Manually reordered keyboard navigation** · warning · high confidence · accessibility

Positive tabindex values can make focus order diverge from reading order.

[Supporting guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html).

## ux/busy-feedback

**Busy region without explicit feedback** · warning · medium confidence · ux

Users need feedback when work is in progress.


## consistency/spacing

**Spacing outside the declared scale** · info · high confidence · consistency

A project-defined spacing scale can catch accidental one-off values without imposing a visual style.


## consistency/component-drift

**Style drift within a declared component** · info · medium confidence · consistency

Only elements explicitly tagged with the same component and variant are compared.


## native/control-name

**Unnamed native control** · error · high confidence · accessibility

A native accessibility snapshot should expose a name for each actionable control.


## axe/*

The Playwright adapter delegates accessibility checking to axe using WCAG A/AA tags through 2.2 and best practices. Violations with minor impact are warnings; other violation impacts are errors. Unresolved checks are coverage limitations. Use exact IDs such as `axe/button-name` in rule configuration. Counts vary with the installed axe version and the document.

## contract/missing-ui

Error, high confidence. An observed state has fewer visible matching elements than its explicit requirement. This does not verify the elements' behavior.

## contract/untested-state

Warning, high confidence. A declared state has no observation. This is a coverage gap, not evidence that UI is absent.

## Suppressions and scope

Use report-level suppressions with rule ID, optional exact target, and a non-empty reason. Disabled rules do not run; suppressed findings remain in the report's suppressed list. Inline `data-glocon-ignore="rule/id"` applies to custom rules on that element and descendants and is disclosed as a coverage limitation; it does not suppress axe. Prefer report-level suppressions for reviewable reasons.

Custom browser rules inspect light DOM, computed styles, and bounding boxes. They do not establish whether a control is occluded, keyboard-reachable, meaningfully named, or functional. axe handles accessible names separately. A linked description may be a hint rather than a recovery message. Busy feedback detection uses explicit status/progress/feedback markers and does not prove announcement timing.

Collection includes offscreen laid-out elements and excludes known hidden/zero-size elements from visibility-based rules. Native checks trust the caller's supplied names, visibility, and geometry.
