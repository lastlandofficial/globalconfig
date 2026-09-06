export type Severity = 'error' | 'warning' | 'info';
export type Confidence = 'high' | 'medium';
export type Category = 'accessibility' | 'layout' | 'consistency' | 'ux';
export type Evidence = Record<string, string | number | boolean | string[] | number[]>;
export interface Finding {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  message: string;
  target: string;
  evidence: Evidence;
  suggestion: string;
  helpUrl?: string;
}
export interface RuleMeta {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  confidence: Confidence;
  rationale: string;
  helpUrl?: string;
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface ElementSnapshot {
  target: string;
  tag: string;
  role: string;
  name: string;
  visible: boolean;
  disabled: boolean;
  interactive: boolean;
  rect: Rect;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  /** Explicit design-system grouping; comparisons never mix unrelated components. */
  component?: string;
  variant?: string;
  ignore: string[];
}
export interface UISnapshot {
  platform: 'web' | 'native';
  url?: string;
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number };
  elements: ElementSnapshot[];
  /** Adapter-discovered limits, preserved in every report. */
  limitations?: string[];
}
export interface Suppression { ruleId: string; target?: string; reason: string }
export interface AuditOptions {
  rules?: Record<string, Severity | 'off'>;
  /** Opt-in spacing policy in CSS px (web) or layout units (native). */
  spacingScale?: number[];
  spacingTolerance?: number;
  targetSize?: number;
  suppressions?: Suppression[];
}
export interface AuditReport {
  schemaVersion: '1.0';
  engineVersion: '0.1.0';
  source: string;
  findings: Finding[];
  suppressed: Array<{ finding: Finding; reason: string }>;
  summary: { error: number; warning: number; info: number; total: number };
  coverage: { rules: string[]; elements: number; limitations: string[] };
}
export interface Rule {
  meta: RuleMeta;
  check(snapshot: UISnapshot, options: AuditOptions): Array<Omit<Finding, 'fingerprint' | 'ruleId' | 'severity' | 'confidence' | 'category' | 'helpUrl'>>;
}
