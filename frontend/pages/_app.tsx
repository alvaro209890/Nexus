import type { AppProps } from "next/app";
import Head from "next/head";
import { AuthProvider } from "../contexts/AuthContext";
import Layout from "../components/Layout";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Head>
        <title>Nexus</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/nexus-icon.png" />
        <link rel="apple-touch-icon" href="/nexus-icon.png" />
        <meta name="theme-color" content="#171b22" />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </AuthProvider>
  );
}
