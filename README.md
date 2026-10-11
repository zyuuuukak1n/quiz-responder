# QuizFast AI (リアルタイム・クイズ超速解答 Webアプリケーション)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg)
![React](https://img.shields.io/badge/React-19.3-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![Gemini](https://img.shields.io/badge/Gemini-3.5%20Flash%20Lite-orange.svg)
![Vitest](https://img.shields.io/badge/Vitest-5.0-green.svg)

スマートフォンのカメラやPC Webカメラでテレビ画面や問題文を撮影し、マルチモーダルLLM（Gemini 3.5 Flash Lite）へ直接映像・静止画・音声を送信して、**目標1〜2秒台（最大5秒以内）**に正解（リモコン4色/番号）と簡潔な決定打・根拠をリアルタイムにSSEストリーミング描画する汎用Webアプリケーションです。

---

## ⚡ 主な特徴

1. **モバイルファースト・親指操作（Thumb Zone）最適化UI**:
   - スマートフォン縦画面を片手で持った際、親指が届く画面最下部に「撮影＆解答」「VTR録画」「音声マイク」「2連写」「リセット」を集約。
   - クイズ説明・ルール設定はアコーディオン式に格納され、画面を圧迫せずワンタップで展開・編集可能。
   - 回答結果が出た瞬間に特大の4色ボタン（【1:青】【2:赤】【3:緑】【4:黄】）をファーストビューでド迫力ハイライト。
2. **Gemini API 浪費防止 & クラウド課金最適化**:
   - **多段階レートリミット**: 突発バースト（10秒4回）、短期（60秒15回）、長期（1時間80回）の三層防壁でbotや乱用を遮断。
   - **In-Flight 並行排他ロック**: 同一IPから前の解析が処理中に新規リクエストが走ることを防ぎ、APIの無駄な同時多重呼び出しを阻止。
   - **同一出題重複キャッシュ (Deduplication Cache)**: 直前20秒以内の同一画像・コンテキストによる誤連打・再送信に対し、Gemini呼び出しを行わずキャッシュから即座にストリーミング返却。
   - **トークン数最小化**: `maxOutputTokens: 250` で余計な長文生成によるトークン消費を物理遮断。
   - **クライアント側クールダウン**: 回答送信後、3秒間のカウントダウン待機タイマーにより画面上での連打を遮断。
3. **堅牢な防御的設計 & セキュリティ強化**:
   - **秘密情報の秘匿**: APIキーはサーバーサイド環境変数からのみ読み込み、クライアントへの露出はゼロ。
   - **オプトイン・パスコード保護**: `ACCESS_PASSCODE` を設定することで、公開環境でも特定の利用者のみにアクセスを制限可能（Web UIからも保存可能）。
   - **CSRF / Origin 防御**: `Sec-Fetch-Site: cross-site` を遮断し、外部サイトからのスクリプト悪用を排除。
   - **プロンプトインジェクション無害化**: ユーザー指定のコンテキスト・ルールを隔離タグ `<user_context>` でカプセル化し、500文字上限・制御文字サニタイズを適用。
   - **セキュリティヘッダー**: HSTS, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy を標準装備。
   - **バイナリマジックナンバー検証**: ファイルヘッダーのシグネチャを検査し、MIMEタイプ偽装や不正バイナリを遮断。
4. **VTR完全動画・音声認識・省略逆算の高度推論**:
   - `MediaRecorder` によるVTR映像・音声の完全録画（1フレームの欠落もゼロ）。
   - Web Speech API による出題ナレーション・音声のリアルタイム文字起こし。
   - 画面上で省略された単位（m, kg, 円, 人等）や条件（最多、最少、勝敗等）を4択から自動逆算。

---

## 🛠 技術スタック

| レイヤー | 技術 |
| :--- | :--- |
| **フロントエンド** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Lucide React |
| **バックエンド API** | Next.js Route Handlers (Node.js ランタイム, SSE ReadableStream) |
| **マルチモーダル LLM** | Google Gemini 3.5 Flash Lite (`@google/generative-ai`) |
| **テスト** | Vitest (単体テスト / モックテスト 32テストPASS) |
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
│   │   │       └── route.ts   # SSEストリーミングAPI (多段階レートリミット, パスコード認証, 重複キャッシュ)
│   │   ├── globals.css        # モダンサイバーテーマ, モバイルタッチ最適化, セーフエリア
│   │   ├── layout.tsx         # 日本語SEOメタデータ, ビューポート設定
│   │   └── page.tsx           # モバイルファーストUI (Thumb Zone, カメラ制御, ガイド枠, ストリーミング描画)
│   ├── lib/
│   │   ├── gemini.ts          # Gemini 3.5 Flash Lite 呼び出し・タイムアウト・汎用4択プロンプト
│   │   ├── imageUtils.ts      # Canvas画像リサイズ・WebP圧縮
│   │   ├── rateLimiter.ts     # 多段階レートリミッター・In-Flight排他・重複キャッシュ
│   │   └── validation.ts      # マジックナンバー検証・テキストサニタイズ・ハッシュ生成
│   └── __tests__/
│       ├── gemini.test.ts     # LLMプロンプト汎用化・固有名詞排除・ストリーミングテスト
│       ├── imageUtils.test.ts # 画像リサイズ計算テスト
│       ├── rateLimiter.test.ts# 多段階リミット・In-Flight排他・キャッシュテスト
│       └── validation.test.ts # 防御的バイナリバリデーション・テキストサニタイズテスト
├── .env.example               # 環境変数テンプレート
├── .gitignore                 # 機密ファイル・成果物の厳格除外設定
├── DEPLOYMENT_GUIDE.md        # 本番公開・サーバーデプロイ手順書
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
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=3055
NODE_ENV=development
# ACCESS_PASSCODE=secret_code（任意: パスコード保護する場合）
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

---

## 📄 ライセンス

本プロジェクトは MIT License のもとで公開されています。
Copyright (c) 2026 じゅーかきん
