/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "#050508",
          panel: "#0A0A0E",
          card: "#101016",
          border: "#1A1A26",
          borderHover: "#2A2A3E",
          blue: "#00D8FF",
          blueDim: "rgba(0, 216, 255, 0.12)",
          text: "#F2F2F5",
          textMuted: "#8B8B9E",
          dim: "#4A4A5E",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};