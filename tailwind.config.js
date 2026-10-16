/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        cream: '#f5f0e8',
        'cream-dark': '#ebe5d9',
        accent: '#5fcb88',
        'accent-dark': '#4fb777',
      },
    },
  },
  plugins: [],
};
