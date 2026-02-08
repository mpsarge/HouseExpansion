import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          DEFAULT: "#111827",
          light: "#f8fafc",
        },
      },
      boxShadow: {
        card: "0 12px 30px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
