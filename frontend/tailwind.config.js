import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)'
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)'
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)'
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)'
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)'
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)'
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)'
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)'
        },
        success: 'var(--success)',
        'success-foreground': 'var(--success-foreground)',
        warning: 'var(--warning)',
        'warning-foreground': 'var(--warning-foreground)',
        info: 'var(--info)',
        'info-foreground': 'var(--info-foreground)',
        cream: 'var(--background)',
        'warm-white': 'var(--card)',
        ink: 'var(--foreground)',
        'ink-light': 'oklch(0.75 0.02 260)',
        'ink-muted': 'var(--muted-foreground)',
        sage: 'var(--primary)',
        'sage-light': 'var(--accent)',
        'sage-pale': 'var(--secondary)',
        amber: 'var(--warning)',
        'amber-light': 'oklch(0.78 0.14 65 / 0.15)',
        'red-soft': 'var(--destructive)',
        'red-light': 'oklch(0.58 0.2 25 / 0.15)',
        'blue-sg': 'var(--info)',
        'blue-light': 'oklch(0.62 0.14 250 / 0.15)'
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)'
      },
      boxShadow: {
        xs: '0 1px 0 0 oklch(1 0 0 / 0.06) inset',
        // Keep a subtle inset highlight; lower drop-shadow opacity to ~5% globally.
        sm: '0 1px 0 0 oklch(1 0 0 / 0.06) inset, 0 4px 24px oklch(0 0 0 / 0.05)',
        md: '0 1px 0 0 oklch(1 0 0 / 0.08) inset, 0 8px 32px oklch(0 0 0 / 0.05)',
        lg: '0 8px 40px oklch(0 0 0 / 0.05)',
        glow: '0 0 40px oklch(0.58 0.15 145 / 0.15)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      fontSize: {
        display: ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-sm': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }]
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        blink: 'blink 1.2s ease-in-out infinite'
      }
    }
  },
  plugins: [tailwindcssAnimate]
}
