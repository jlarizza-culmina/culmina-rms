import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cream: '#F8F5F0',
        surface: { DEFAULT: '#FFFFFF', 2: '#F2EEE8' },
        accent: { DEFAULT: '#C05A2A', light: '#FAE8DF', dark: '#9D4520' },
        sage: { DEFAULT: '#2E6B25', light: '#E5F0E2' },
        cobalt: '#2A61A0',
        muted: '#7A7568',
        hint: '#B0AB9E',
      },
      fontFamily: {
        serif: ['Lora', 'Georgia', 'serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
