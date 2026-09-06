# Research behind glocon 0.3.0

Research date: 6 September 2026. This is a product discovery synthesis, not a representative survey or a claim that UI quality has a universal numerical score.

## Method and evidence quality

We searched public developer and design discussions for recurring complaints about forms, consistency, handoffs, accessibility, responsive behavior, and incomplete states. We checked proposed rules against primary accessibility guidance, usability research, and existing tool documentation. Community discussions identify problems worth investigating; they do not establish prevalence or prove that a proposed solution works. Research from checkout flows does not automatically generalize to every product.

The implementation decisions below are our interpretation of the evidence. Standards-backed violations, measured project-policy differences, and contextual heuristics are deliberately separate. We do not infer that a page is accessible simply because a scan passes.

## What people complain about, and what can be coded

### 1. Beautiful mockups break with real content and real devices

Developers describe screens that assume ideal monitors, fast networks, short strings, and fully populated data. They also raise loading/error states being omitted from handoffs. The discussion is a useful qualitative signal about the mismatch between a static design and a running product. It is not evidence that all designers work this way. [Developer discussion: what developers wish designers knew](https://www.reddit.com/r/webdev/comments/1pgfvxh/what_do_you_wish_uxui_designers_knew/).

**Product decision:** inspect the rendered interface rather than score screenshots. Measure horizontal page overflow at the viewport under test. Test narrow and wide layouts; use scenario fixtures containing long names, empty collections, failures, and slow responses. `layout/overflow` is a warning because the collector does not prove whether the wider content is an intentional exception.

WCAG's reflow guidance includes narrow-width and zoom-related requirements, with exceptions for content that needs a two-dimensional layout. A single horizontal-overflow check is not a complete reflow test. [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

### 2. Basic accessibility barriers keep recurring

WebAIM's February 2026 evaluation found detectable WCAG failures on 95.9% of its million-home-page sample, with 56.1 detected errors per page on average. Six categories accounted for 96% of detected errors: low text contrast, missing image alternatives, missing input labels, empty links, empty buttons, and missing document language. This concerns automated findings on sampled home pages, not all pages or all accessibility failures. [WebAIM Million 2026](https://webaim.org/projects/million/).

**Product decision:** use axe for mature automated accessibility checks instead of implementing a simplified accessible-name or contrast algorithm. Preserve unresolved checks as coverage limitations. Do not turn missing evidence into a pass or an arbitrary overall quality score. [axe-core project and limitations](https://github.com/dequelabs/axe-core).

The current web adapter uses WCAG A/AA tags through 2.2 plus axe best practices. It converts violations into the same finding format as UX rules; this does not imply each axe best-practice result is a normative WCAG failure.

### 3. Forms give confusing feedback and lose context

Developer discussion around form UX raises disappearing labels, premature validation, and disabled submit controls that leave people unsure what to fix. These reports suggest test cases, not universal prescriptions about when every form should validate. [Community discussion of form UX](https://www.reddit.com/r/webdev/comments/16g8hh0/forms_users_love_20_frontend_tips_important_uxui/).

Baymard's usability work describes the importance of timing and implementing inline validation carefully. Its 2024 checkout research included more than 200 qualitative sessions on 16 sites, exposing more than 1,350 medium-to-severe issues. The relevant implication is that familiar form interactions still deserve direct testing; these findings are specific to checkout research. [Inline validation research](https://baymard.com/blog/inline-form-validation), [2024 checkout research methodology](https://baymard.com/blog/checkout-2024-launch).

NN/g recommends error messages that explain the issue and help people recover, rather than cryptic or accusatory text. [Error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/).

**Product decision:** check invalid fields for linked readable descriptions and flag placeholder-only visible labeling as a heuristic. Provide a `Field` primitive with label/hint/error associations. Preserve caller-owned input values. Do not automatically decide validation timing, erase data, or disable invalid forms. Text quality and whether a hint actually explains the error remain review tasks.

### 4. Loading, empty, and failure screens are forgotten

A separate design discussion emphasizes considering a complete flow rather than individual screens. This supports investigating state coverage; it does not make every possible state mandatory for every component. [Community discussion of common UI mistakes](https://www.reddit.com/r/UI_Design/comments/1rn6smt/what_ui_mistakes_do_you_see_beginners_make_most/).

NN/g describes empty states as opportunities to explain what belongs in a region and guide a useful next action. [Empty-state design guidance](https://www.nngroup.com/articles/empty-state-interface-design/).

**Product decision:** use explicit state contracts. A product team declares the visible elements required for each state. An observed error state with no retry action can fail its contract. An error state that was never exercised is reported as untested, not as proof that a retry action is absent. `AsyncState` requires loading, empty, error, and success renderers at the type level. `EmptyState` requires explanatory text and allows a contextual action.

This is the central hypothesis of glocon: making state requirements executable can reduce omissions in both developer-authored and agent-authored interfaces. It still needs validation on real teams.

### 5. Components and tokens drift

Developers ask how teams keep interfaces consistent as multiple contributors build features. Other public design-system discussions describe slightly different components accumulating and design/code versions diverging. These are illustrative accounts, not measurements of how frequently drift occurs. [Consistency discussion](https://www.reddit.com/r/webdev/comments/xkeges/), [Design governance account](https://www.reddit.com/r/UXDesign/comments/1tofzvc/i_never_thought_design_governance_was_my_problem/).

**Product decision:** spacing checks require a project-provided scale. Component comparisons require explicit component and variant markers, at least three peers, and a strict majority. State differences are separated. The rule never assumes that every button, paragraph, or card should look identical. Deliberate exceptions can be suppressed with a reason.

The Design Tokens Community Group provides an interoperability direction for future import/export. This release ships CSS custom properties and a numeric spacing policy, not a claim of DTCG format compatibility. [Design Tokens Community Group](https://www.w3.org/community/design-tokens/).

### 6. Tiny targets and fragile interaction make UI harder to use

WCAG 2.2's minimum target-size criterion uses 24 by 24 CSS pixels, with spacing, equivalent-control, inline, user-agent, and essential exceptions. A control below 24px is not automatically a conformance failure. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**Product decision:** the simple measured target check is medium-confidence advice. It skips inline and disabled controls and permits a project threshold. React primitives use a 44px minimum hit area as a product default. That default is not presented as a universal WCAG requirement. Native units and platform expectations must be treated independently.

### 7. Native UI needs native evidence

React Native exposes accessibility names, roles, and platform-specific behavior. Browser DOM rules cannot replace verification of those behaviors on iOS and Android. [React Native accessibility documentation](https://reactnative.dev/docs/accessibility).

**Product decision:** provide an explicit measured-node adapter for shared naming, size, and consistency checks. Document the source of each node and prefer computed accessible names from the actual tree. Device collection, hitSlop, font scaling, VoiceOver/TalkBack navigation, and native components are outside the 0.3.0 implementation.

## Existing tools and where glocon fits

| Tool or approach | Existing strength | glocon's relationship |
| --- | --- | --- |
| axe-core | Automated accessibility rules and incomplete/manual-review results | Reuse through the Playwright integration; do not claim to supersede it |
| Playwright | Real browser actions, assertions, and accessibility integration | Use existing pages and explicit scenario setup; no proprietary test runner |
| Testing Library | Tests aligned with user-visible interaction | Keep component tests focused on labels, roles, state, and behavior |
| Storybook accessibility addon | Component-focused axe checks and reporting | Compatible conceptual workflow; no Storybook plugin shipped yet |
| Screenshot regression | Detecting visual change against a baseline | Complementary; a changed screenshot is not inherently a usability defect |
| Component libraries | Reusable UI controls | Supply a small set of state/form primitives and audit existing libraries too |

The first four descriptions are supported by their maintainers' documentation: [axe-core](https://github.com/dequelabs/axe-core), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [Testing Library principles](https://testing-library.com/docs/guiding-principles/), [Storybook accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing). The last two are distinctions used in our product design, not a comparative benchmark.

## Automation boundaries

- **High confidence:** a declared element is absent in an observed scenario; a measured value differs from an explicit project scale; a mature axe rule reports a violation.
- **Heuristic:** small interaction areas, page overflow, a placeholder without a detected visible label, missing linked error text, busy feedback, and drift among marked peers. Some measurements are precise while the inferred user problem remains contextual.
- **Needs scenarios or manual evaluation:** focus restoration, keyboard traps, navigation expectations, preservation of input, error recovery, dynamic announcements, localized content, zoom, reduced motion, and interaction latency.
- **Needs product judgment or user research:** meaningful copy, brand, hierarchy, whether a feature should exist, number of steps, task success, perceived trust, and delight.

We intentionally do not ship screenshot-based beauty scores, a universal spacing grid, automatic layout rewrites, or claims of complete accessibility certification.

## Validation and next research

The repository contains clean and deliberately broken fixtures, state-contract tests, narrow-viewport audits, dark-theme checks, and interaction tests for pending actions and error context. These establish implementation behavior, not measured effectiveness in production teams.

Next, recruit maintainers of at least one React/Next app, one Angular app, one Electron app, and one React Native app. Ask them to triage findings without changing rule settings first. Track confirmed defects, disputed findings, time to diagnosis, and whether a proposed fix creates a regression. Include keyboard and screen-reader users in scenario design.

Prioritize new rules by recurring confirmed pain, observable evidence, and actionable fixes. Before making a heuristic fail CI by default, publish its false-positive analysis and intentional exceptions. The most valuable next work is likely state discovery/integration and interaction scenarios; the current evidence does not justify claiming that more static rules alone will solve UX.
