import type { AppProps } from "next/app";
import Head from "next/head";
import { Inter, Outfit } from "next/font/google";
import { AuthProvider } from "../contexts/AuthContext";
import Layout from "../components/Layout";
import "../styles/globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap"
});

const displayFont = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap"
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${bodyFont.variable} ${displayFont.variable}`}>
      <AuthProvider>
        <Head>
          <title>Nexus</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/png" href="/nexus-icon.png" />
          <link rel="apple-touch-icon" href="/nexus-icon.png" />
          <meta name="theme-color" content="#09090b" />
        </Head>
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </AuthProvider>
    </div>
  );
}
