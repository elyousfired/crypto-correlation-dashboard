/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ground: "#071013",
        ink: "#ffffff",
        accent: "#69aac1",
        surface: "#102127"
      },
      fontFamily: {
        sora: ['Sora', 'sans-serif'],
        geist: ['Geist Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
