import { auditSnapshot } from "../core/engine";
import type {
  AuditOptions,
  ElementSnapshot,
  Rect,
  UISnapshot,
} from "../core/types";
export interface NativeNode {
  testID: string;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  /** Supply a name when your accessibility tree computes it from child text. */
  accessibleName?: string;
  disabled?: boolean;
  visible?: boolean;
  actionable?: boolean;
  frame: Rect;
  style?: Record<string, string>;
  component?: string;
  variant?: string;
}
/** Adapter for measured native nodes; this does not collect a device tree itself. */
export function fromNativeNodes(
  nodes: NativeNode[],
  viewport: UISnapshot["viewport"],
): UISnapshot {
  if (!Array.isArray(nodes)) throw new Error("Native nodes must be an array.");
  if (
    !viewport ||
    typeof viewport !== "object" ||
    !["width", "height"].every(
      (key) =>
        typeof viewport[key as keyof typeof viewport] === "number" &&
        Number.isFinite(viewport[key as keyof typeof viewport]) &&
        viewport[key as keyof typeof viewport] > 0,
    )
  )
    throw new Error(
      "Native viewport width and height must be positive finite numbers.",
    );
  for (const node of nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      typeof node.testID !== "string"
    )
      throw new Error("Each native node needs a string testID.");
    if (
      !node.frame ||
      typeof node.frame !== "object" ||
      Array.isArray(node.frame) ||
      !["x", "y", "width", "height"].every(
        (key) =>
          typeof node.frame[key as keyof Rect] === "number" &&
          Number.isFinite(node.frame[key as keyof Rect]),
      ) ||
      node.frame.width < 0 ||
      node.frame.height < 0
    )
      throw new Error(
        "Native frames require finite x, y, width and height, with non-negative dimensions.",
      );
    for (const key of ["visible", "disabled", "actionable"] as const)
      if (node[key] !== undefined && typeof node[key] !== "boolean")
        throw new Error(`Native ${key} must be boolean.`);
    for (const key of [
      "accessibilityRole",
      "accessibilityLabel",
      "accessibleName",
      "component",
      "variant",
    ] as const)
      if (node[key] !== undefined && typeof node[key] !== "string")
        throw new Error(`Native ${key} must be a string.`);
    if (
      node.style !== undefined &&
      (!node.style ||
        typeof node.style !== "object" ||
        Array.isArray(node.style) ||
        Object.values(node.style).some((value) => typeof value !== "string"))
    )
      throw new Error("Native style must map property names to strings.");
  }
  const ids = nodes.map((n) => n.testID);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error("Native nodes require unique, non-empty testIDs.");
  const elements: ElementSnapshot[] = nodes.map((node) => ({
    target: node.testID,
    tag: "native",
    role: node.accessibilityRole ?? "",
    name: node.accessibleName ?? node.accessibilityLabel ?? "",
    visible: node.visible ?? true,
    disabled: node.disabled ?? false,
    interactive:
      node.actionable ??
      [
        "button",
        "link",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "adjustable",
        "search",
      ].includes(node.accessibilityRole ?? ""),
    rect: { ...node.frame },
    styles: { ...node.style },
    attributes: {},
    ...(node.component !== undefined ? { component: node.component } : {}),
    ...(node.variant !== undefined ? { variant: node.variant } : {}),
    ignore: [],
  }));
  return {
    platform: "native",
    viewport: { ...viewport },
    document: { scrollWidth: viewport.width, clientWidth: viewport.width },
    elements,
    collection: {
      total: nodes.length,
      inspected: nodes.length,
      truncated: false,
    },
    limitations: [
      "Native support is a supplied-node adapter, not device automation. No DOM/axe checks, screen-reader interaction, hitSlop, or font-scaling validation is performed.",
    ],
  };
}
export function auditNative(
  nodes: NativeNode[],
  viewport: UISnapshot["viewport"],
  options: AuditOptions = {},
) {
  return auditSnapshot(fromNativeNodes(nodes, viewport), {
    targetSize: 44,
    ...options,
  });
}
