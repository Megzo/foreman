import type { ManifestBranding } from "@foreman/shell-main/ipc";

/**
 * The CSS custom properties a manifest's branding drives (FR-1.1; UX: "the shell
 * must look like the client's app, not a coding tool"). Applied at the app root
 * so a second manifest restyles the whole UI — the framework-not-hardcoded
 * acceptance item. Optional colors fall back to sensible neutrals.
 */
export function themeTokens(branding: ManifestBranding): Record<string, string> {
  const { colors } = branding;
  return {
    "--color-primary": colors.primary,
    // Text drawn on top of the primary color (buttons, the launcher accent bar):
    // flip to dark on a light brand color so a pale manifest stays readable.
    "--color-primary-contrast": readableTextOn(colors.primary),
    "--color-background": colors.background ?? "#ffffff",
    "--color-accent": colors.accent ?? colors.primary,
  };
}

/** White on dark brand colors, the app's ink on light ones (perceived-luminance, YIQ). */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq > 140 ? "#1f2328" : "#ffffff";
}
