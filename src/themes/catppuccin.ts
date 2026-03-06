/**
 * Catppuccin theme variants for Angy.
 *
 * Each variant defines CSS custom property values that get applied to :root.
 * The "mocha" variant uses Angy's custom darker backgrounds (#0e0e0e base)
 * rather than standard Catppuccin mocha (#1e1e2e).
 */

export interface ThemeTokens {
  // Backgrounds
  bgBase: string;
  bgSurface: string;
  bgWindow: string;
  bgRaised: string;

  // Borders
  borderSubtle: string;
  borderStandard: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;

  // Accents
  accentMauve: string;
  accentBlue: string;
  accentGreen: string;
  accentRed: string;
  accentYellow: string;
  accentTeal: string;
  accentPeach: string;
}

export type ThemeVariant = "mocha" | "mocha-classic" | "macchiato" | "frappe" | "latte" | "cursor";

export const themes: Record<ThemeVariant, ThemeTokens> = {
  mocha: {
    bgBase: "#0e0e0e",
    bgSurface: "#141414",
    bgWindow: "#1a1a1a",
    bgRaised: "#252525",
    borderSubtle: "#1e1e1e",
    borderStandard: "#2a2a2a",
    textPrimary: "#cdd6f4",
    textSecondary: "#a6adc8",
    textMuted: "#6c7086",
    textFaint: "#45475a",
    accentMauve: "#cba6f7",
    accentBlue: "#89b4fa",
    accentGreen: "#a6e3a1",
    accentRed: "#f38ba8",
    accentYellow: "#f9e2af",
    accentTeal: "#94e2d5",
    accentPeach: "#fab387",
  },

  "mocha-classic": {
    // Standard Catppuccin Mocha palette (official colors, no custom darks)
    bgBase: "#11111b",      // Crust
    bgSurface: "#181825",   // Mantle
    bgWindow: "#1e1e2e",    // Base
    bgRaised: "#313244",    // Surface0
    borderSubtle: "#313244", // Surface0
    borderStandard: "#45475a", // Surface1
    textPrimary: "#cdd6f4",
    textSecondary: "#a6adc8",
    textMuted: "#6c7086",
    textFaint: "#45475a",
    accentMauve: "#cba6f7",
    accentBlue: "#89b4fa",
    accentGreen: "#a6e3a1",
    accentRed: "#f38ba8",
    accentYellow: "#f9e2af",
    accentTeal: "#94e2d5",
    accentPeach: "#fab387",
  },

  macchiato: {
    bgBase: "#181825",
    bgSurface: "#1e1e2e",
    bgWindow: "#24273a",
    bgRaised: "#363a4f",
    borderSubtle: "#2a2d3d",
    borderStandard: "#363a4f",
    textPrimary: "#cad3f5",
    textSecondary: "#a5adcb",
    textMuted: "#6e738d",
    textFaint: "#494d64",
    accentMauve: "#c6a0f6",
    accentBlue: "#8aadf4",
    accentGreen: "#a6da95",
    accentRed: "#ed8796",
    accentYellow: "#eed49f",
    accentTeal: "#8bd5ca",
    accentPeach: "#f5a97f",
  },

  frappe: {
    bgBase: "#232634",
    bgSurface: "#292c3c",
    bgWindow: "#303446",
    bgRaised: "#414559",
    borderSubtle: "#353948",
    borderStandard: "#414559",
    textPrimary: "#c6d0f5",
    textSecondary: "#a5adce",
    textMuted: "#737994",
    textFaint: "#51576d",
    accentMauve: "#ca9ee6",
    accentBlue: "#8caaee",
    accentGreen: "#a6d189",
    accentRed: "#e78284",
    accentYellow: "#e5c890",
    accentTeal: "#81c8be",
    accentPeach: "#ef9f76",
  },

  latte: {
    bgBase: "#eff1f5",
    bgSurface: "#e6e9ef",
    bgWindow: "#dce0e8",
    bgRaised: "#ccd0da",
    borderSubtle: "#dce0e8",
    borderStandard: "#ccd0da",
    textPrimary: "#4c4f69",
    textSecondary: "#5c5f77",
    textMuted: "#7c7f93",
    textFaint: "#9ca0b0",
    accentMauve: "#8839ef",
    accentBlue: "#1e66f5",
    accentGreen: "#40a02b",
    accentRed: "#d20f39",
    accentYellow: "#df8e1d",
    accentTeal: "#179299",
    accentPeach: "#fe640b",
  },

  cursor: {
    bgBase: "#0a0a0a",
    bgSurface: "#111111",
    bgWindow: "#171717",
    bgRaised: "#222222",
    borderSubtle: "#1a1a1a",
    borderStandard: "#262626",
    textPrimary: "#e4e4e7",
    textSecondary: "#a1a1aa",
    textMuted: "#71717a",
    textFaint: "#3f3f46",
    accentMauve: "#a78bfa",
    accentBlue: "#60a5fa",
    accentGreen: "#4ade80",
    accentRed: "#f87171",
    accentYellow: "#fbbf24",
    accentTeal: "#2dd4bf",
    accentPeach: "#fb923c",
  },
};

const tokenToCssVar: Record<keyof ThemeTokens, string> = {
  bgBase: "--bg-base",
  bgSurface: "--bg-surface",
  bgWindow: "--bg-window",
  bgRaised: "--bg-raised",
  borderSubtle: "--border-subtle",
  borderStandard: "--border-standard",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  textFaint: "--text-faint",
  accentMauve: "--accent-mauve",
  accentBlue: "--accent-blue",
  accentGreen: "--accent-green",
  accentRed: "--accent-red",
  accentYellow: "--accent-yellow",
  accentTeal: "--accent-teal",
  accentPeach: "--accent-peach",
};

export function applyTheme(variant: ThemeVariant): void {
  const tokens = themes[variant];
  const root = document.documentElement;

  for (const [key, cssVar] of Object.entries(tokenToCssVar)) {
    root.style.setProperty(cssVar, tokens[key as keyof ThemeTokens]);
  }
}
