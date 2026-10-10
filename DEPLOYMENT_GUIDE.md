# QuizFast AI 手動オペレーション手順書 (DEPLOYMENT_GUIDE.md)

本手順書は、Antigravityによるコード生成が完了した状態から、GitHub Publicリポジトリの作成・公開、自宅Ubuntu Server（Apache2環境）への本番デプロイ、常駐デーモン化、およびヘルスチェックに至る全ステップを網羅した完全ガイドです。

---

## 目次
- [STEP 1: GitHubリポジトリの初期化とPush](#step-1-githubリポジトリの初期化とpush)
- [STEP 2: アーキテクチャ判定結果と設計理由](#step-2-アーキテクチャ判定結果と設計理由)
- [STEP 3: 実行・ホスティング環境のセットアップ](#step-3-実行ホスティング環境のセットアップ)
- [STEP 4: 環境変数（.env）の配置と設定](#step-4-環境変数envの配置と設定)
- [STEP 5: CI/CD（GitHub Actions）の設定](#step-5-cicdgithub-actionsの設定)
- [STEP 6: 動作確認・ヘルスチェック](#step-6-動作確認ヘルスチェック)

---

## STEP 1: GitHubリポジトリの初期化とPush

### 1.1. リポジトリ設定テキストの確認
- **リポジトリ名候補**: `quiz-fast-ai` または `quiz-responder`
- **Description（概要文・350文字以内・日本語）**:
  > カメラで写したクイズ・問題文を手動ワンタップで撮影し、Gemini 1.5 Flashへの直接推論により目標2〜3秒で正解と簡潔な解説をリアルタイムにSSEストリーミング表示する超高速回答Webアプリ。WebPリサイズ最適化、バイナリマジックナンバー検証、レートリミットを完備。
- **トピックタグ候補**:
  `nextjs`, `react`, `gemini-api`, `multimodal-ai`, `quiz-solver`, `server-sent-events`, `real-time`, `tailwindcss`, `typescript`

### 1.2. Git初期化と除外ファイルの確認
作業ディレクトリで `.env` などの秘密情報が含まれていないかを確認の上、Git初期化を行います。

```bash
# Git管理の初期化
git init

# .gitignoreの確認（.envやbuild成果物が確実に除外されているか確認）
git status

# 全ファイルをステージング
git add .

# 初回コミット
git commit -m "feat: initial commit of QuizFast AI real-time responder"
```

### 1.3. GitHub Publicリポジトリの作成とPush
1. GitHub（ブラウザ）にログインし、新しいリポジトリ（Public）を作成します。
   - Repository name: `quiz-responder`
   - Public を選択（README、.gitignore、LICENSEは作成済みのためチェックを外す）
2. 以下のコマンドを実行してリモートを追加し、Pushします。

```bash
# mainブランチを設定
git branch -M main

# リモートリポジトリの追加（YOUR_GITHUB_USERNAMEを自身のアカウントに置換）
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/quiz-responder.git

# プッシュ
git push -u origin main
```

---

## STEP 2: アーキテクチャ判定結果と設計理由

### 2.1. 判定結果区分
- **区分4: Webアプリ（軽量〜中規模、API、セッション管理型）**
  - **ホスティング先**: 自宅 Ubuntu Server（既存稼働環境と同機）
  - **割り当てポート**: `3055`（既存アプリに一切干渉しない独立未使用ポート）
  - **構成**: Next.js 16 (App Router) フルスタック構成 + Apache2 リバースプロキシ + systemd サービス

### 2.2. 選定理由
1. **既存稼働保護とポート分離**:
   - 自宅サーバー内の他アプリ（Webサーバー、DB、Bot等）と干渉しないよう、環境変数 `PORT=3055` で独立したリスニングポートを確保。
2. **YAGNI原則に則った単一プロセス運用**:
   - フロントエンド（React 19）とバックエンドAPI（SSEストリーミングRoute Handler）をNext.jsで統合管理することにより、Python/Nodeなどの複数ランタイムや過剰なマイクロサービス分割を回避。デプロイと運用コストを最小化。
3. **SSE（Server-Sent Events）の低レイテンシ配信**:
   - WebSocketのようなステートフルな接続維持が不要な一方向ストリーミング要件に対し、標準HTTPベースのSSEを採用することで、Apache2プロキシ経由でも安定した高速レスポンス（目標2〜3秒）を実現。

---

## STEP 3: 実行・ホスティング環境のセットアップ

自宅 Ubuntu Server にSSHログインして作業を実施します。

### 3.1. Node.js環境のセットアップ (Node.js 22 LTS 推奨)
```bash
# Node.js 22 LTS のインストール確認（未インストールの場合は NodeSource より導入）
node -v
# v22.x.x または v20.x.x が出力されればOK

# 未導入の場合の例:
# curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
# sudo apt-get install -y nodejs
```

### 3.2. プロジェクトのクローンとビルド
サーバー上の配置先（例: `/var/www/quiz-responder`）へクローンします。

```bash
# アプリケーション配置ディレクトリの準備
sudo mkdir -p /var/www/quiz-responder
sudo chown -R $USER:$USER /var/www/quiz-responder

# リポジトリのクローン
git clone https://github.com/YOUR_GITHUB_USERNAME/quiz-responder.git /var/www/quiz-responder
cd /var/www/quiz-responder

# 依存パッケージのインストール
npm ci

# 本番用ビルドの実行
npm run build
```

### 3.3. systemd サービスユニットの作成（常駐化・自動再起動）
クラッシュ時の自動再起動およびサーバー再起動時の自動起動を設定します。

```bash
sudo tee /etc/systemd/system/quiz-responder.service << 'EOF'
[Unit]
Description=QuizFast AI Web Application
After=network.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/var/www/quiz-responder
Environment=NODE_ENV=production
Environment=PORT=3055
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=quiz-responder

# 防御的制限
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
```
> **注意**: `YOUR_LINUX_USER` は実際の実行ユーザー名（例: `ubuntu` や `user`）に置き換えてください。

サービスのリロードと有効化:
```bash
sudo systemctl daemon-reload
sudo systemctl enable quiz-responder
sudo systemctl start quiz-responder

# 起動状態の確認
sudo systemctl status quiz-responder
```

### 3.4. 公開ルーティング設定（Cloudflare Tunnel または Apache2）

自宅サーバー環境に合わせて、以下のいずれかの方法で外部公開を設定します。

#### 【推奨】方法A: Cloudflare Tunnel（config.yml 管理）で直接公開する場合
Cloudflare Tunnel を導入済みの場合、Apache2 や Let's Encrypt（SSL証明書）の設定を一切介さず、Cloudflare Tunnel から直接 Next.js（ポート3055）へトラフィックを転送するのが最も低遅延かつ確実です。

1. **サーバー側の設定ファイル（`/etc/cloudflared/config.yml`）を編集**:
   ```bash
   sudo nano /etc/cloudflared/config.yml
   ```
2. **`ingress` ルールにサブドメインを追加**:
   ```yaml
   ingress:
     # ▼ QuizFast AI のルーティングを追加
     - hostname: quiz.zyuuuukak1n.dev
       service: http://localhost:3055

     # 既存の他サービス設定...
     # - hostname: example.zyuuuukak1n.dev
     #   service: http://localhost:8080

     # 最後のフォールバック（必ず末尾に配置）
     - service: http_status:404
   ```
3. **Cloudflare DNS に CNAME が登録されていることを確認**:
   - Cloudflare ダッシュボードの DNS レコードまたは Zero Trust の Public Hostname に `quiz` -> `<Tunnel-ID>.cfargotunnel.com` が設定されていること。
4. **cloudflared サービスを再起動**:
   ```bash
   sudo systemctl restart cloudflared
   ```

---

#### 方法B: Apache2 リバースプロキシ経由で公開する場合
既存のApache2設定に干渉しないよう、独立した設定ファイル `/etc/apache2/sites-available/quiz-responder.conf` を作成します。
SSEストリーミングをリアルタイムに届けるため、`proxy_http` および `proxy_wstunnel`（または `no-buffer` ヘッダー対応）を有効化します。

```bash
# 必要なApacheモジュールの有効化
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod headers
sudo a2enmod ssl

# バーチャルホスト設定の作成
sudo tee /etc/apache2/sites-available/quiz-responder.conf << 'EOF'
<VirtualHost *:80>
    ServerName quiz.yourdomain.com

    # ログ設定（独立ファイルに出力）
    ErrorLog ${APACHE_LOG_DIR}/quiz_responder_error.log
    CustomLog ${APACHE_LOG_DIR}/quiz_responder_access.log combined

    # プロキシ設定 (ポート3055への転送)
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3055/
    ProxyPassReverse / http://127.0.0.1:3055/

    # SSEストリーミング用バッファリング無効化
    SetEnv no-gzip 1
    SetEnv proxy-nokeepalive 1
</VirtualHost>
EOF
```

設定の反映:
```bash
# サイトの有効化
sudo a2ensite quiz-responder.conf

# 構文チェック
sudo apache2ctl configtest

# Apache2の再読み込み
sudo systemctl reload apache2
```

> **HTTPS化について**: スマートフォンのカメラAPI（`getUserMedia`）はセキュリティ上、ローカルホスト（`localhost`）または `HTTPS` 環境でしか動作しません。Apache2経由で公開する場合は Let's Encrypt（`certbot`）等でSSL証明書を適用してください。
> ```bash
> sudo certbot --apache -d quiz.yourdomain.com
> ```

---

## STEP 4: 環境変数（.env）の配置と設定

本番環境のサーバーに `.env` ファイルを安全に配置します。

```bash
cd /var/www/quiz-responder
cp .env.example .env

# パーミッションを厳格に保護（他ユーザーの読み取りを遮断）
chmod 600 .env

# 設定ファイルを編集
nano .env
```

### `.env` の設定内容例:
```env
# Google AI Studio で取得したAPIキー
GEMINI_API_KEY=AIzaSyD_EXAMPLE_KEY_XXXXXXXXXXXXXXXXXXXX

# 使用モデル
GEMINI_MODEL=gemini-1.5-flash

# サーバー起動ポート（Apache2設定と一致させる）
PORT=3055

# 本番環境フラグ
NODE_ENV=production
```

設定を反映するため、サービスを再起動します:
```bash
sudo systemctl restart quiz-responder
```

---

## STEP 5: CI/CD（GitHub Actions）の設定

リポジトリへのPush時およびPull Request時に、コードの構文チェック・単体テスト・ビルド検証が自動実行されます。

### 5.1. GitHub Secrets の登録
リポジトリの Settings > Secrets and variables > Actions > **Repository secrets** にて以下を登録します。

| Secret 名 | 設定値 | 説明 |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | `AIzaSy...`（実際のキーまたはテスト用キー） | CIパイプラインでのビルド時・テスト時に参照（未登録でもダミー値でビルドが通るよう設計済み） |

### 5.2. ワークフローの動作確認
1. コードを変更してGitHubの `main` ブランチへPushします。
2. GitHubリポジトリの **Actions** タブを開きます。
3. `CI / Test & Build` ワークフローが起動し、以下がすべて緑のチェック（Pass）になることを確認します。
   - `Run ESLint`
   - `Run Unit Tests (Vitest)`
   - `Build Next.js Application`

---

## STEP 6: 動作確認・ヘルスチェック

### 6.1. ローカルリスニング確認（サーバー内部）
```bash
# ポート3055がNext.jsによってリッスンされているか確認
sudo ss -tulpn | grep 3055
# または
sudo lsof -i :3055
```

### 6.2. 内部HTTPレスポンス確認
```bash
# サーバー内から直接トップページへのリクエスト確認
curl -I http://127.0.0.1:3055/
# HTTP/1.1 200 OK が返ることを確認
```

### 6.3. APIエンドポイントの防御テスト
```bash
# 不正リクエスト（画像なし）を送信して 400 Bad Request が正しく返るか検証
curl -X POST http://127.0.0.1:3055/api/answer
# {"error":"Content-Type は multipart/form-data である必要があります。"} が返れば正常
```

### 6.4. systemdログの監視
実稼働時のリアルタイムログ（TTFT時間、トークン数、エラー状況）を確認します。
```bash
sudo journalctl -u quiz-responder -f
```

### 6.5. ブラウザ・スマホ実機での検証
1. ブラウザで `https://quiz.yourdomain.com`（またはローカル環境）にアクセスします。
2. カメラのアクセス許可ダイアログを「許可」します。
3. プレビューのガイド枠内に問題文を収め、「ワンタップで解答を取得」ボタンを押下します。
4. 2〜3秒以内に正解と簡潔な解説が画面上にリアルタイムストリーミング描画されることを確認します。
