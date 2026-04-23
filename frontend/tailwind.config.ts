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
        ink: "#171b22",
        amberline: "#7eb2d6",
        slateblue: "#c7d0db",
        porcelain: "#13171d",
        moss: "#2d3540"
      },
      boxShadow: {
        panel: "0 24px 80px rgba(16, 24, 32, 0.16)"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif"],
        body: ["IBM Plex Sans", "ui-sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
