import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibe Coder — Master Your Own Code",
  description:
    "Connect any GitHub repository and get an AI-powered, interview-ready study guide tailored to your actual codebase.",
  openGraph: {
    title: "Vibe Coder — Master Your Own Code",
    description: "Turn your GitHub repos into interview-ready study guides with AI.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}