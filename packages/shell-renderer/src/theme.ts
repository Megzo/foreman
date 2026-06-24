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
    "--color-background": colors.background ?? "#ffffff",
    "--color-accent": colors.accent ?? colors.primary,
  };
}
