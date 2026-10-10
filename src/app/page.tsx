"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  Zap,
  RefreshCw,
  SwitchCamera,
  Copy,
  Check,
  AlertCircle,
  Upload,
  Sparkles,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { captureVideoFrame } from "@/lib/imageUtils";

interface StreamResponseMeta {
  ttftMs?: number;
  elapsedMs?: number;
}

export default function QuizResponderPage() {
  // カメラ関連ステート & Ref
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraReloadKey, setCameraReloadKey] = useState(0);

  // 解析・推論ステート
  const [isLoading, setIsLoading] = useState(false);
  const [answerRawText, setAnswerRawText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metaInfo, setMetaInfo] = useState<StreamResponseMeta | null>(null);
  const [copied, setCopied] = useState(false);
  const [capturedImagePreview, setCapturedImagePreview] = useState<string | null>(
    null
  );

  // ファイル入力参照（カメラ非対応時のフォールバック用）
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * カメラの初期化Effect（React 19 & ESLint推奨プラクティス）
   */
  useEffect(() => {
    let isMounted = true;

    // 前のストリームを停止
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const initCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (isMounted) {
          setCameraError(
            "お使いのブラウザはカメラアクセスに対応していません。画像ファイルをアップロードして回答してください。"
          );
        }
        return;
      }
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(
          constraints
        );

        if (!isMounted) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = mediaStream;

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = () => {
            if (!isMounted) return;
            videoRef.current?.play().catch((err) => {
              console.warn("自動再生失敗:", err);
            });
            setIsCameraReady(true);
          };
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        console.error("Camera init error:", err);
        const message =
          err instanceof Error
            ? err.name === "NotAllowedError" ||
              err.name === "PermissionDeniedError"
              ? "カメラの使用が拒否されています。ブラウザの設定でカメラへのアクセスを許可してください。"
              : `カメラの起動に失敗しました: ${err.message}`
            : "カメラの起動に失敗しました。";
        setCameraError(message);
        setIsCameraReady(false);
      }
    };

    initCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [facingMode, cameraReloadKey]);

  /**
   * カメラの前後切り替え
   */
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  /**
   * SSEストリーミング解析の実行
   */
  const executeAnalysis = async (imageBlob: Blob) => {
    // 触覚フィードバック（対応端末のみ）
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(40);
    }

    setIsLoading(true);
    setErrorMessage(null);
    setAnswerRawText("");
    setMetaInfo(null);

    // 画像プレビューURL生成
    const previewUrl = URL.createObjectURL(imageBlob);
    setCapturedImagePreview(previewUrl);

    // 前のリクエストがあれば中断
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const formData = new FormData();
    formData.append("image", imageBlob, "captured.webp");

    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `リクエスト失敗 (Status: ${response.status})`
        );
      }

      if (!response.body) {
        throw new Error("ストリーミングレスポンスを受信できませんでした。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const payload = JSON.parse(trimmed.replace(/^data:\s*/, ""));
              if (payload.type === "chunk") {
                setAnswerRawText((prev) => prev + payload.text);
              } else if (payload.type === "meta") {
                setMetaInfo((prev) => ({
                  ...prev,
                  ttftMs: payload.ttftMs,
                }));
              } else if (payload.type === "done") {
                setMetaInfo((prev) => ({
                  ...prev,
                  elapsedMs: payload.elapsedMs,
                }));
              } else if (payload.type === "error") {
                setErrorMessage(payload.error || "推論エラーが発生しました。");
              }
            } catch {
              // JSONパース不完全行は無視
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Request aborted");
        return;
      }
      const message =
        err instanceof Error ? err.message : "予期せぬエラーが発生しました。";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * ワンタップ撮影キャプチャ
   */
  const handleCapture = async () => {
    if (isLoading) return; // 連打防止
    if (!videoRef.current || !isCameraReady) {
      setErrorMessage("カメラの準備が整っていません。");
      return;
    }

    try {
      // 1280px WebP (0.75品質) でフレーム取得
      const blob = await captureVideoFrame(videoRef.current, {
        maxDimension: 1280,
        quality: 0.75,
        format: "image/webp",
      });

      await executeAnalysis(blob);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "キャプチャ処理に失敗しました。";
      setErrorMessage(msg);
    }
  };

  /**
   * ファイルアップロードによる代替実行
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      executeAnalysis(file);
    }
    // 入力をリセット
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /**
   * テキストコピー
   */
  const handleCopy = () => {
    if (!answerRawText) return;
    navigator.clipboard.writeText(answerRawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * 結果リセット・再撮影
   */
  const handleReset = () => {
    setAnswerRawText("");
    setErrorMessage(null);
    setMetaInfo(null);
    if (capturedImagePreview) {
      URL.revokeObjectURL(capturedImagePreview);
      setCapturedImagePreview(null);
    }
  };

  // テキストを1行目（正解）と2行目以降（解説）に分離
  const lines = answerRawText.split("\n");
  const firstLine = lines[0]?.trim() || "";
  const explanationLines = lines.slice(1).join("\n").trim();

  return (
    <div className="relative min-h-screen bg-[#080c14] text-gray-100 flex flex-col justify-between">
      {/* 隠しファイル入力（フォールバック用） */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/webp,image/jpeg,image/png"
        className="hidden"
      />

      {/* ヘッダー */}
      <header className="z-20 flex items-center justify-between px-4 py-3 bg-[#0d1322]/80 backdrop-blur-md border-b border-gray-800/60 sticky top-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Zap className="w-5 h-5 text-[#080c14] fill-[#080c14]" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">
              QuizFast AI
            </h1>
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              Gemini 1.5 Flash リアルタイム推論
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* カメラ切替 */}
          {!cameraError && (
            <button
              onClick={toggleFacingMode}
              disabled={isLoading}
              title="カメラを切り替え"
              className="p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/60 text-gray-300 hover:text-white transition disabled:opacity-50"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          )}

          {/* 画像ファイル選択ボタン */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="ファイルから読み込み"
            className="p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/60 text-gray-300 hover:text-white transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* メインカメラプレビュー & オーバーレイエリア */}
      <main className="relative flex-1 flex flex-col items-center justify-center overflow-hidden p-2 sm:p-4">
        <div className="relative w-full max-w-lg aspect-[3/4] sm:aspect-[4/3] rounded-2xl overflow-hidden bg-black/60 border border-gray-800 shadow-2xl flex items-center justify-center">
          {/* カメラ映像 */}
          {!cameraError ? (
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                isCameraReady ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : (
            <div className="p-6 text-center max-w-xs flex flex-col items-center gap-3">
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-full text-red-400">
                <AlertCircle className="w-8 h-8" />
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                {cameraError}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setCameraReloadKey((k) => k + 1)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 再試行
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border border-gray-700"
                >
                  <Upload className="w-3.5 h-3.5" /> 画像選択
                </button>
              </div>
            </div>
          )}

          {/* カメラ読み込み中スピナー */}
          {!isCameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0e17]/80 backdrop-blur-sm z-10">
              <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
              <p className="text-xs text-gray-400 font-medium">カメラ起動中...</p>
            </div>
          )}

          {/* クイズ認識ガイド枠（オーバーレイ） */}
          {isCameraReady && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-6 z-10">
              {/* ガイド枠上部 */}
              <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-gray-700/50 text-[11px] text-gray-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>問題文と選択肢を中央の枠に合わせてください</span>
              </div>

              {/* 中央ファインダー枠 */}
              <div className="relative w-[85%] h-[65%] rounded-xl border border-dashed border-emerald-500/40 flex items-center justify-center">
                {/* 4隅のHUDコーナー */}
                <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-emerald-400 rounded-tl-sm" />
                <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-sm" />
                <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-sm" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-emerald-400 rounded-br-sm" />

                {/* スキャンレーザーアニメーション（ローディング時） */}
                {isLoading && (
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] animate-scanline" />
                )}
              </div>

              {/* 下部ステータス */}
              <div className="text-[10px] text-gray-500">
                1280px 高速WebP圧縮最適化
              </div>
            </div>
          )}
        </div>

        {/* 回答表示エリア / ストリーミング結果カード */}
        {(answerRawText || isLoading || errorMessage) && (
          <div className="w-full max-w-lg mt-3 z-20 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="rounded-xl bg-[#0f172a]/95 backdrop-blur-xl border border-gray-700/80 p-4 shadow-2xl relative">
              {/* カードヘッダー */}
              <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-gray-200">
                    {isLoading ? "AIが解析・推論中..." : "回答結果"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* 所要時間バッジ */}
                  {metaInfo && (
                    <div className="text-[11px] text-gray-400 flex items-center gap-1 bg-gray-800/80 px-2 py-0.5 rounded-full border border-gray-700/60 font-mono">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      {metaInfo.ttftMs && (
                        <span>TTFT: {(metaInfo.ttftMs / 1000).toFixed(2)}s</span>
                      )}
                      {metaInfo.elapsedMs && (
                        <span className="text-emerald-400 font-bold">
                          ⚡ {(metaInfo.elapsedMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>
                  )}

                  {/* コピーボタン */}
                  {answerRawText && (
                    <button
                      onClick={handleCopy}
                      className="text-gray-400 hover:text-white transition p-1"
                      title="回答をコピー"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  {/* リセットボタン */}
                  <button
                    onClick={handleReset}
                    className="text-gray-400 hover:text-white transition p-1"
                    title="クリア"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* エラー表示 */}
              {errorMessage && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300 flex items-start gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </div>
              )}

              {/* 1行目: 正解の特大バッジ表示 */}
              {firstLine && (
                <div className="mb-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 mb-1">
                    正解
                  </div>
                  <div className="inline-block bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/50 rounded-lg px-4 py-2 text-xl sm:text-2xl font-black text-emerald-300 shadow-lg shadow-emerald-500/10">
                    {firstLine}
                  </div>
                </div>
              )}

              {/* 2行目以降: 解説の表示 */}
              {explanationLines && (
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1">
                    解説
                  </div>
                  <div className="text-xs sm:text-sm text-gray-200 leading-relaxed bg-[#0b101d] p-3 rounded-lg border border-gray-800 whitespace-pre-wrap">
                    {explanationLines}
                  </div>
                </div>
              )}

              {/* ストリーミング中の点滅カーソル */}
              {isLoading && !firstLine && (
                <div className="flex items-center gap-2 py-4 justify-center text-gray-400 text-xs">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>画像を送信して推論しています...（目標2〜3秒）</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* フッター操作エリア */}
      <footer className="z-20 p-4 pb-6 bg-[#090d16]/90 backdrop-blur-md border-t border-gray-800/60 flex flex-col items-center gap-2">
        <div className="w-full max-w-lg flex items-center justify-center gap-4">
          {/* ワンタップ「解答を取得」アクションボタン */}
          <button
            onClick={handleCapture}
            disabled={isLoading || !isCameraReady}
            className={`w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all duration-200 active:scale-95 ${
              isLoading || !isCameraReady
                ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
                : "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-gray-950 hover:brightness-110 shadow-emerald-500/25 animate-glow-pulse"
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                <span>高速解析中...</span>
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 text-gray-950 fill-gray-950/20" />
                <span>ワンタップで解答を取得</span>
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-gray-500 text-center">
          ※ 撮影画像は回答推論にのみ使用され、サーバー上に永続保存されません。
        </p>
      </footer>
    </div>
  );
}
