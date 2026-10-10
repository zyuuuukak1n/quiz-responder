import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI クイズ超速アンサー | リアルタイム画像回答",
  description:
    "カメラでクイズや問題文をワンタップ撮影するだけで、マルチモーダルAIが即座に正解と解説を高速ストリーミング表示するWebアプリケーション。",
  keywords: ["クイズ", "AI回答", "Gemini", "画像認識", "リアルタイム", "高速", "OCR"],
  authors: [{ name: "じゅーかきん" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#090d16",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#090d16] text-gray-100 selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
