/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        scale: {
          '0%': { transform: 'scale(0.95)' },
          '30%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)' },
        },
        scaleIconSize: {
          '25%': { transform: 'scale(0.90)' },
          '60%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
        scaleArrowIconSize: {
          '25%': {
            transform: 'translateX(-10%) scaleX(0.90)',
            transformOrigin: 'left',
          },
          '50%': {
            transform: 'translateX(10%) scaleX(1.15)',
            transformOrigin: 'left',
          },
          '100%': {
            transform: 'scaleX(1)',
            transformOrigin: 'left',
          },
        },
        bounceTrashIcon: {
          '30%': {
            transform: 'scaleY(0.90)',
            transformOrigin: 'bottom',
          },
          '70%': {
            transform: 'scaleY(1.20)',
            transformOrigin: 'bottom',
          },
          '100%': {
            transform: 'scaleY(1)',
            transformOrigin: 'bottom',
          },
        },
        movePencilIcon: {
          '25%': {
            transform: 'translateX(-10%)',
            rotate: '5deg',
          },
          '65%': {
            transform: 'translateX(20%)',
            rotate: '-10deg',
          },
          '100%': {
            transform: 'translateX(0%)',
          },
        },
        wobbleIcon: {
          '0%': {
            transform: 'rotate(0deg)',
          },
          '25%': {
            transform: 'rotate(-5deg)',
          },
          '50%': {
            transform: 'rotate(5deg)',
          },
          '75%': {
            transform: 'rotate(-5deg)',
          },
          '100%': {
            transform: 'rotate(0deg)',
          },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        fadeInDropdownMenu: {
          '0%': {
            opacity: '0',
            transform: 'scale(0.80)',
            translate: '20% -15%',
          },
          '100%': { opacity: '1', transform: 'scale(1)', translate: '0 0' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
      },
      animation: {
        scale: 'scale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        scaleIconSize:
          'scaleIconSize 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        scaleArrowIconSize:
          'scaleArrowIconSize 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        bounceTrashIcon:
          'bounceTrashIcon 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        movePencilIcon:
          'movePencilIcon 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        wobbleIcon:
          'wobbleIcon 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        fadeIn: 'fadeIn 0.2s ease-out forwards',
        fadeInDropdownMenu:
          'fadeInDropdownMenu 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
    // ...
  ],
};
