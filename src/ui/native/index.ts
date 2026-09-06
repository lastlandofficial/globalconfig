import { auditSnapshot } from '../core/engine';
import type { AuditOptions, ElementSnapshot, Rect, UISnapshot } from '../core/types';
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
export function fromNativeNodes(nodes: NativeNode[], viewport: UISnapshot['viewport']): UISnapshot {
  const ids = nodes.map(n => n.testID);
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Native nodes require unique, non-empty testIDs.');
  for (const node of nodes) if (Object.values(node.frame).some(n => !Number.isFinite(n)) || node.frame.width < 0 || node.frame.height < 0) throw new Error('Native frames must contain finite coordinates and non-negative dimensions.');
  const elements: ElementSnapshot[] = nodes.map(node => ({
    target: node.testID, tag: 'native', role: node.accessibilityRole ?? '', name: node.accessibleName ?? node.accessibilityLabel ?? '', visible: node.visible ?? true,
    disabled: node.disabled ?? false, interactive: node.actionable ?? ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'adjustable', 'search'].includes(node.accessibilityRole ?? ''),
    rect: node.frame, styles: node.style ?? {}, attributes: {}, ...(node.component !== undefined ? { component: node.component } : {}), ...(node.variant !== undefined ? { variant: node.variant } : {}), ignore: [],
  }));
  return { platform: 'native', viewport, document: { scrollWidth: viewport.width, clientWidth: viewport.width }, elements,
    limitations: ['Native support is a supplied-node adapter, not device automation. No DOM/axe checks, screen-reader interaction, hitSlop, or font-scaling validation is performed.'] };
}
export function auditNative(nodes: NativeNode[], viewport: UISnapshot['viewport'], options: AuditOptions = {}) {
  return auditSnapshot(fromNativeNodes(nodes, viewport), { targetSize: 44, ...options });
}
