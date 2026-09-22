---
name: Neutral Grotesk Design System
colors:
  surface: '#0e0e0e'
  surface-dim: '#0e0e0e'
  surface-bright: '#2a2d2d'
  surface-container-lowest: '#000000'
  surface-container-low: '#121314'
  surface-container: '#181a1a'
  surface-container-high: '#1e2020'
  surface-container-highest: '#242627'
  on-surface: '#e5e5e6'
  on-surface-variant: '#aaabab'
  inverse-surface: '#fbf9f8'
  inverse-on-surface: '#555555'
  outline: '#747676'
  outline-variant: '#464849'
  surface-tint: '#c8c6c5'
  primary: '#c8c6c5'
  primary-dim: '#bab8b8'
  on-primary: '#404040'
  primary-container: '#474746'
  on-primary-container: '#d2d0cf'
  inverse-primary: '#605f5e'
  secondary: '#ff7261'
  secondary-dim: '#ff7261'
  on-secondary: '#4a0001'
  secondary-container: '#7e0003'
  on-secondary-container: '#ffa99d'
  tertiary: '#7d98ff'
  tertiary-dim: '#3467ff'
  on-tertiary: '#00195b'
  tertiary-container: '#0356ff'
  on-tertiary-container: '#ffffff'
  error: '#ee7d77'
  error-dim: '#bb5551'
  on-error: '#490106'
  error-container: '#7f2927'
  on-error-container: '#ff9993'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#d6d4d3'
  on-primary-fixed: '#403f3f'
  on-primary-fixed-variant: '#5c5b5b'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffc7bf'
  on-secondary-fixed: '#850003'
  on-secondary-fixed-variant: '#b61511'
  tertiary-fixed: '#0356ff'
  tertiary-fixed-dim: '#004be4'
  on-tertiary-fixed: '#ffffff'
  on-tertiary-fixed-variant: '#cad3ff'
  background: '#0e0e0e'
  on-background: '#e5e5e6'
  surface-variant: '#242627'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

# Design System

## Brand & Style
The Neutral Grotesk design system embraces a **Modern Neutral** aesthetic, blending high-contrast industrial structure with clean, refined typography. The visual language evokes reliability, precision, and modern technological efficiency. It prioritizes clarity over ornamentation, utilizing deliberate whitespace, sharp typographic contrast via Space Grotesk, and highly legible body text in Inter.

## Colors
The color palette is built for a dark mode environment, utilizing deep charcoal surfaces anchored by a powerful neutral base. 
- **Primary (`#1a1a1a`)**: Used for grounding core structural elements and high-contrast inversions.
- **Secondary (`#e63b2e`)**: A sharp red utilized for critical call-to-actions, errors, and focal highlights.
- **Tertiary (`#0055ff`)**: A vibrant digital blue reserved for active links and selections.
- **Neutral (`#4a4a4a`)**: Forms the backbone for UI borders and structural containers.

## Typography
Typography relies on a dual-font strategy pairing **Space Grotesk** for headlines and labels with **Inter** for body copy.
- **Headlines**: Set in Space Grotesk to establish an authoritative hierarchy.
- **Body**: Set in Inter, optimized for multi-line readability.

## Layout & Spacing
The layout model uses a 12-column fluid grid system with a consistent spacing scale. Gutters are set to `1.5rem` and outer margins to `2rem`.

## Elevation & Depth
Elevation is established through tonal layering and low-contrast outlines. Surfaces use distinct neutral tint shifts to denote hierarchy, complemented by crisp, subtle borders.

## Shapes
UI elements feature a **Soft** roundedness level (`0.25rem` base radius), balancing industrial sharpness with modern accessibility.

## Components
- **Buttons**: Primary actions feature solid secondary fills; secondary variants use clean outlines.
- **Inputs**: Form fields use dark neutral backgrounds with precise focus rings.
- **Cards**: Outlined containers with fine neutral borders and generous internal padding.

## Tailwind CSS Configuration
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0e0e0e',
        'surface-dim': '#0e0e0e',
        'surface-bright': '#2a2d2d',
        'surface-container-lowest': '#000000',
        'surface-container-low': '#121314',
        'surface-container': '#181a1a',
        'surface-container-high': '#1e2020',
        'surface-container-highest': '#242627',
        'on-surface': '#e5e5e6',
        'on-surface-variant': '#aaabab',
        'inverse-surface': '#fbf9f8',
        'inverse-on-surface': '#555555',
        outline: '#747676',
        'outline-variant': '#464849',
        'surface-tint': '#c8c6c5',
        primary: '#c8c6c5',
        'primary-dim': '#bab8b8',
        'on-primary': '#404040',
        'primary-container': '#474746',
        'on-primary-container': '#d2d0cf',
        'inverse-primary': '#605f5e',
        secondary: '#ff7261',
        'secondary-dim': '#ff7261',
        'on-secondary': '#4a0001',
        'secondary-container': '#7e0003',
        'on-secondary-container': '#ffa99d',
        tertiary: '#7d98ff',
        'tertiary-dim': '#3467ff',
        'on-tertiary': '#00195b',
        'tertiary-container': '#0356ff',
        'on-tertiary-container': '#ffffff',
        error: '#ee7d77',
        'error-dim': '#bb5551',
        'on-error': '#490106',
        'error-container': '#7f2927',
        'on-error-container': '#ff9993',
        'primary-fixed': '#e5e2e1',
        'primary-fixed-dim': '#d6d4d3',
        'on-primary-fixed': '#403f3f',
        'on-primary-fixed-variant': '#5c5b5b',
        'secondary-fixed': '#ffdad5',
        'secondary-fixed-dim': '#ffc7bf',
        'on-secondary-fixed': '#850003',
        'on-secondary-fixed-variant': '#b61511',
        'tertiary-fixed': '#0356ff',
        'tertiary-fixed-dim': '#004be4',
        'on-tertiary-fixed': '#ffffff',
        'on-tertiary-fixed-variant': '#cad3ff',
        background: '#0e0e0e',
        'on-background': '#e5e5e6',
        'surface-variant': '#242627'
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px'
      },
      spacing: {
        gutter: '1.5rem',
        margin: '2rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2.5rem'
      },
      fontFamily: {
        headline: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Space Grotesk', 'sans-serif']
      },
      fontSize: {
        'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '600' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '20px', fontWeight: '500' }]
      }
    }
  }
};
```
