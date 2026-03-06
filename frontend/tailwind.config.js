/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            color: '#1a1a2e',
            maxWidth: 'none',
          },
        },
      },
    },
  },
  plugins: [],
}
