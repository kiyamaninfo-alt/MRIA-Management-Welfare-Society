/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./js/**/*.js"
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#006194",
        "primary-hover": "#004d77",
        "primary-container": "#007bb9",
        "on-primary": "#ffffff",
        surface: "#f8f9ff",
        "on-surface": "#0b1c30",
        "on-surface-variant": "#3f4850",
        "surface-container": "#e5eeff",
        "surface-container-low": "#eff4ff",
        "surface-container-lowest": "#ffffff",
        "surface-bright": "#f8f9ff",
        outline: "#707881",
        "outline-variant": "#bfc7d2",
        error: "#ba1a1a",
        "error-container": "#ffdad6",
        secondary: "#565e74",
        "secondary-container": "#dae2fd",
        tertiary: "#894d00",
        "tertiary-container": "#ac6200",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Noto Sans Sinhala", "sans-serif"],
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries"),
  ],
};
