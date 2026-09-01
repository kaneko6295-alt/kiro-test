import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AWS Todo App",
  description: "AWS学習用Todoアプリ - Next.js + ECS Fargate + Aurora",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
