---
name: Coating Store System
description: Industrial, high-contrast, utility-focused theme for factory floor parts management.
colors:
  bg: "#f5f4f0"
  bg2: "#eeece7"
  surface: "#ffffff"
  surface2: "#f9f8f5"
  border: "#d8d5ce"
  border2: "#c4c0b8"
  primary: "#001F6B"
  primary-hover: "#002a90"
  accent: "#E40046"
  accent-green: "#00934a"
  warn: "#b45309"
  danger: "#E40046"
  text: "#111827"
  text-muted: "#4b5563"
  text-light: "#6b6b83"
typography:
  display:
    fontFamily: "Inter, Noto Sans Thai, sans-serif"
    fontSize: "42px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-1px"
  body:
    fontFamily: "Inter, Noto Sans Thai, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11px"
    fontWeight: 700
rounded:
  md: "12px"
  lg: "16px"
  sm: "6px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px 16px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  badge:
    rounded: "4px"
    fontFamily: "{typography.mono.fontFamily}"
    fontSize: "10px"
---

## Overview
This design system defines the visual vocabulary of the AGC Coating Store System. It prioritizes readability and reliable operations on the factory floor (under bright or dim ambient lighting, used on handheld mobile devices). The system leverages the corporate color palette of AGC (AGC blue and red).

## Colors
The palette uses high-contrast warm-gray backgrounds and white surfaces, contrasted against deep corporate blue for primary actions and brand elements, and crimson red for warnings and critical alerts.
- **Primary / Brand Blue**: `#001F6B` (`--agc-blue`) / `#002a90` (`--agc-blue2`)
- **Accent / Alert Red**: `#E40046` (`--agc-red`, also used for danger)
- **Status Green**: `#00934a` (`--accent2` / receive confirmation)
- **Backgrounds**: Warm grey `#f5f4f0` (`--bg`) and `#eeece7` (`--bg2`)
- **Ink / Text**: Off-black `#111827` (`--text`), Slate grey `#4b5563` (`--text2`), and `#6b6b83` (`--text3`)

## Typography
Dual-font system to support multilingual Thai and English interfaces.
- **Display & UI Sans**: `'Inter'`, `'Noto Sans Thai'`, sans-serif. Highly readable at all scales.
- **Code & Tech Mono**: `'IBM Plex Mono'`, monospace. Used for status indicators, counts, QR codes, IDs, and secondary metadata tags.

## Elevation
The system relies on solid outlines rather than soft SaaS-style drop shadows.
- **Outlines**: `1px solid var(--border)` or `1.5px solid var(--border)`.
- **Default Shadow**: `0 1px 4px rgba(0,0,0,0.10)` (`--shadow`). Used to elevate cards slightly.
- **Active / Popover Shadow**: `0 4px 16px rgba(0,0,0,0.13)` (`--shadow-md`). Used for dialogs and active states.

## Components
- **Action Cards**: Sized `1fr 1fr` grids with `16px` padding and custom colored Lucide icons.
- **Status Badges**: Small caps, tracked monospace labels in solid containers (e.g., `.badge`).
- **Input Fields / Selects**: Soft grey background (`#eeece7`) with solid `1.5px` border and active focus state highlighting in AGC Blue.
- **Confirm Buttons**: Action-specific colors (`#E40046` for withdraw, `#00934a` for receive).

## Do's and Don'ts
- **DO** use distinct, semantic buttons for Withdraw (เบิกของ) and Receive (รับของ) actions.
- **DO** keep text labels high-contrast (dark slate or black against warm grey/white backgrounds).
- **DO** keep cards to simple layout roles; never nest cards.
- **DON'T** use soft-wide shadows with fine outlines ("ghost cards").
- **DON'T** use text gradients, pastel/beige backgrounds, or all-caps paragraphs.
