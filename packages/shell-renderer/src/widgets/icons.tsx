/**
 * A tiny inline-SVG icon set (decorative, aria-hidden). Stroke uses
 * currentColor so each icon inherits the surrounding brand/ink color. Inline
 * rather than an icon font/dependency — same "boring, no framework" rule as the
 * rest of the shell; small enough to keep here.
 */
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

/** A task launcher — a "play/run" mark inside the brand tile. */
export function TaskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 4.5v15l13-7.5L5 4.5Z" fill="currentColor" stroke="none" opacity="0.92" />
    </svg>
  );
}

/** Forward arrow — the launcher hover affordance. */
export function ArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** Empty-history glyph — a calm "stack of pages waiting". */
export function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5 12 4l8 3.5-8 3.5-8-3.5Z" />
      <path d="m4 12 8 3.5L20 12" />
      <path d="m4 16.5 8 3.5 8-3.5" />
    </svg>
  );
}
