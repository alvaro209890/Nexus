import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./lib/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101820",
        amberline: "#ECA72C",
        slateblue: "#385170",
        porcelain: "#F7F3EA",
        moss: "#6A8D73"
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
