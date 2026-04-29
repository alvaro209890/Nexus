import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx}",
    "./contexts/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg-base)",
        surface: "var(--bg-surface)",
        "surface-strong": "var(--bg-surface-strong)",
        "bg-surface": "var(--bg-surface)",
        "bg-surface-strong": "var(--bg-surface-strong)",
        "border-soft": "var(--border-soft)",
        "border-strong": "var(--border-strong)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
      },
      boxShadow: {
        panel: "0 10px 40px -10px rgba(0,0,0,0.5)",
        lift: "0 20px 40px -20px rgba(0,0,0,0.6)",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui"]
      }
    }
  },
  plugins: []
};

export default config;
