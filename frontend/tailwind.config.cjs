/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // 다크 모드 활성화 ('class' 전략)
  content: [
    './src/**/*.{html,js,ts,jsx,tsx}',
    './*.html',
  ],
  theme: {
    extend: {
      colors: {
        // 2.1 Primitives (브랜드 기본 컬러)
        brand: {
          primary: '#2563EB',
          secondary: '#4F46E5',
          accent: '#06B6D4',
        },
        // 2.2 Semantic Colors (CSS Variable과 연동하여 투명도 지원)
        bg: {
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        border: {
          default: 'rgb(var(--border-default) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
        },
        // Status Colors
        status: {
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          info: '#3B82F6',
        },
      },
      fontFamily: {
        // 3. Typography
        sans: ['Inter', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // 4. Spacing & Border Radius
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
      },
      boxShadow: {
        // 5. Shadows & Elevation
        'elevation-low': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'elevation-mid': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        'elevation-high': '0 10px 15px -3px rgb(0 0 0 / 0.1)',
      },
    },
  },
  plugins: [],
};
