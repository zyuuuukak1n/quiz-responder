# QuizFast AI (リアルタイム・クイズ高速回答 Webアプリケーション)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg)
![React](https://img.shields.io/badge/React-19.3-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![Gemini](https://img.shields.io/badge/Gemini-1.5%20Flash-orange.svg)
![Vitest](https://img.shields.io/badge/Vitest-5.0-green.svg)

スマートフォンのカメラやWebカメラで写したクイズ・問題文を手動ワンタップで撮影し、マルチモーダルLLM（Gemini 1.5 Flash）へ直接画像を送信して、**目標2〜3秒（最大5秒以内）**に正解と簡潔な解説をリアルタイムにSSEストリーミング描画するWebアプリケーションです。

---

## ⚡ 主な特徴

1. **ワンタップ・キャプチャ & 高速最適化**:
   - ボタンを1回タップするだけで、`<canvas>` 経由でフレームを取得。
   - 文字認識精度と通信速度のバランスを考慮し、長辺最大 `1280px`（720p〜1080p相当）に縮小リサイズ。
   - 高効率な `image/webp`（品質 0.75、JPEGフォールバック）で圧縮し、ペイロードサイズを **100KB〜300KB** に抑制。
2. **Server-Sent Events (SSE) によるリアルタイム描画**:
   - 最初のトークン到着（TTFT: Time to First Token）から即座に画面へ回答を逐次ストリーミング。
   - 1行目の**正解**（記号・単語）を大文字バッジで強調ハイライト。
   - 2行目以降の**簡潔な解説**（最大150文字程度）をカード形式でクリアに表示。
3. **洗練されたサイバー/モダンUI**:
   - スマホ縦画面・PC Webカメラ対応のレスポンシブデザイン。
   - クイズ認識用のファインダー枠（HUDコーナー、照準線、スキャンアニメーション）。
   - 外カメラ（背面）優先起動、イン/アウト切り替え、カメラ非対応環境向けの画像ファイル直接選択フォールバック。
   - ボタン連打防止（Disabled制御）とハプティック触覚フィードバック。
4. **防御的設計と堅牢なセキュリティ**:
   - **秘密情報の秘匿**: APIキーはサーバーサイド環境変数からのみ読み込み、クライアントへの露出はゼロ。
   - **バイナリマジックナンバー検証**: ファイルヘッダーのシグネチャを検査し、MIMEタイプ偽装や不正バイナリをサーバーサイドで遮断。
   - **厳格なファイルサイズ制限**: 5MB超過のアップロードを即座に 400 Bad Request で遮断。
   - **IPレートリミット**: スライディングウィンドウ方式により短時間の過剰リクエストを 429 で遮断。
   - **APIタイムアウト保護**: 7秒タイムアウト設定によりハングアップや課金爆発を防御。
   - **安全な構造化ロギング**: 個人識別情報や画像バイナリをログに残さず、内部スタックトレースをクライアントに漏洩しない設計。

---

## 🛠 技術スタック

| レイヤー | 技術 |
| :--- | :--- |
| **フロントエンド** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Lucide React |
| **バックエンド API** | Next.js Route Handlers (Node.js ランタイム, SSE ReadableStream) |
| **マルチモーダル LLM** | Google Gemini 1.5 Flash (`@google/generative-ai`) |
| **テスト** | Vitest (単体テスト / モックテスト) |
| **インフラ / デプロイ** | 自宅 Ubuntu Server (Apache2 リバースプロキシ / systemd デーモン化) |

---

## 📁 ディレクトリ構成

```
.
├── .github/
│   └── workflows/
│       └── main.yml           # CI/CD (Lint, Vitest単体テスト, Next.jsビルド検証)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── answer/
│   │   │       └── route.ts   # SSEストリーミングAPI (バリデーション, レートリミット, Gemini連携)
│   │   ├── globals.css        # モダンテーマ, スキャンアニメーション
│   │   ├── layout.tsx         # 日本語SEOメタデータ, ビューポート設定
│   │   └── page.tsx           # メインUI (カメラ制御, ガイド枠, キャプチャ, ストリーミング描画)
│   ├── lib/
│   │   ├── gemini.ts          # Gemini 1.5 Flash 呼び出し・タイムアウト・厳格プロンプト
│   │   ├── imageUtils.ts      # Canvas画像リサイズ・WebP圧縮
│   │   ├── rateLimiter.ts     # IPベース・スライディングウィンドウ型レートリミッター
│   │   └── validation.ts      # マジックナンバー検証・MIME・サイズ上限バリデーション
│   └── __tests__/
│       ├── gemini.test.ts     # LLMモック & プロンプト・エラーテスト
│       ├── imageUtils.test.ts # 画像リサイズ計算テスト
│       ├── rateLimiter.test.ts# レートリミット動作テスト
│       └── validation.test.ts # 防御的バイナリバリデーションテスト
├── .env.example               # 環境変数テンプレート
├── .gitignore                 # 機密ファイル・成果物の厳格除外設定
├── DEPLOYMENT_GUIDE.md        # 本番公開・サーバーデプロイ手動オペレーション手順書
├── INTERACTION_LOG.md         # 開発対話・意思決定ログ
├── LICENSE                    # MIT License (じゅーかきん)
├── package.json
└── vitest.config.mjs          # 単体テスト設定
```

---

## 🚀 ローカル開発環境での起動手順

### 1. 必要要件
- Node.js 20.x または 22.x / 24.x
- npm 10.x 以上
- Google Gemini API キー（[Google AI Studio](https://aistudio.google.com/) から無料で即時取得可能）

### 2. 環境変数の設定
リポジトリ直下の `.env.example` をコピーして `.env` を作成します。

```bash
cp .env.example .env
```

`.env` を開き、取得した Gemini API キーを設定します。

```env
GEMINI_API_KEY=AIzaSy...（あなたのAPIキー）
PORT=3055
NODE_ENV=development
```

### 3. 依存パッケージのインストール
```bash
npm install
```

### 4. 単体テストの実行
```bash
npm test
```

### 5. 開発サーバーの起動
```bash
npm run dev
```

ブラウザで `http://localhost:3000` または指定ポートにアクセスしてください。
（スマホ実機からローカルテストを行う場合は、同一Wi-Fi環境から `https://` 経由または開発ツールのポートフォワーディングを利用してください）

---

## 📦 本番デプロイ

自宅 Ubuntu Server（Apache2環境）やクラウドサーバーへのデプロイ手順、systemd による常駐化、ポート保護、リバースプロキシ設定の詳細は [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) を参照してください。

---

## 📄 ライセンス

本プロジェクトは MIT License のもとで公開されています。
Copyright (c) 2026 じゅーかきん
