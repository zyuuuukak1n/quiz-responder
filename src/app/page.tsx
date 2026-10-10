"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  RefreshCw,
  SwitchCamera,
  Copy,
  Check,
  AlertCircle,
  Upload,
  Clock,
  Mic,
  MicOff,
  Layers,
  Sparkles,
  Tv,
} from "lucide-react";
import { captureVideoFrame } from "@/lib/imageUtils";

interface StreamResponseMeta {
  ttftMs?: number;
  elapsedMs?: number;
}

// オールスター感謝祭・ジャンルプリセット
const QUIZ_PRESETS = [
  { id: "normal", label: "標準4択", prompt: "オールスター感謝祭の標準4択問題" },
  { id: "zoom", label: "🔍 ズームアウト/写真", prompt: "ズームアウト問題または画像特定問題。パーツや色・輪郭の特徴から全体の正解を特定せよ。" },
  { id: "trick", label: "⚠️ ひっかけ・意地悪", prompt: "意地悪・引っかけ問題。ありがちな直感の間違いを徹底警戒し、真の事実関係で判断せよ。" },
  { id: "person_song", label: "🎤 人物/曲名/過去映像", prompt: "人物当て・曲名・セリフ・過去のTBS名場面問題。" },
  { id: "prediction", label: "🏃 勝敗/順位予想", prompt: "スタジオ生対決・マラソン等の勝敗・順位予想問題。" },
] as const;

// リモコンカラー判定ヘルパー
interface AnswerColorInfo {
  num: number | null;
  colorName: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  label: string;
}

function parseAnswerColor(line: string): AnswerColorInfo {
  // 1:青, 2:赤, 3:緑, 4:黄 の判定
  if (/1|青|①/.test(line)) {
    return {
      num: 1,
      colorName: "青",
      bgClass: "bg-blue-600/30",
      borderClass: "border-blue-500",
      textClass: "text-blue-300",
      label: "【1】 青ボタン",
    };
  }
  if (/2|赤|②/.test(line)) {
    return {
      num: 2,
      colorName: "赤",
      bgClass: "bg-red-600/30",
      borderClass: "border-red-500",
      textClass: "text-red-300",
      label: "【2】 赤ボタン",
    };
  }
  if (/3|緑|③/.test(line)) {
    return {
      num: 3,
      colorName: "緑",
      bgClass: "bg-emerald-600/30",
      borderClass: "border-emerald-500",
      textClass: "text-emerald-300",
      label: "【3】 緑ボタン",
    };
  }
  if (/4|黄|④/.test(line)) {
    return {
      num: 4,
      colorName: "黄",
      bgClass: "bg-amber-500/30",
      borderClass: "border-amber-400",
      textClass: "text-amber-300",
      label: "【4】 黄ボタン",
    };
  }

  return {
    num: null,
    colorName: "正解",
    bgClass: "bg-cyan-500/20",
    borderClass: "border-cyan-400",
    textClass: "text-cyan-300",
    label: "正解",
  };
}

export default function QuizResponderPage() {
  // カメラ関連ステート & Ref
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraReloadKey, setCameraReloadKey] = useState(0);

  // オールスター感謝祭・拡張制御ステート
  const [selectedPreset, setSelectedPreset] = useState<string>("normal");
  const [isBurstMode, setIsBurstMode] = useState(false); // 2枚連続撮影（ズームアウト用）
  const [isMicActive, setIsMicActive] = useState(false); // 音声聞き取り
  const [speechTranscript, setSpeechTranscript] = useState(""); // 音声文字起こし
  const [manualNote, setManualNote] = useState(""); // 手動補足メモ

  // 解析・推論ステート
  const [isLoading, setIsLoading] = useState(false);
  const [answerRawText, setAnswerRawText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metaInfo, setMetaInfo] = useState<StreamResponseMeta | null>(null);
  const [copied, setCopied] = useState(false);

  // ファイル入力参照（カメラ非対応時のフォールバック用）
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 音声認識オブジェクト参照
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  /**
   * Web Speech API（テレビ出題音声・ナレーション自動取得）
   */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "ja-JP";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) {
          setSpeechTranscript((prev) => {
            const combined = `${prev} ${transcript}`.trim();
            // 直近150文字程度を保持
            return combined.slice(-150);
          });
        }
      };

      recognition.onerror = () => {
        setIsMicActive(false);
      };

      recognition.onend = () => {
        if (isMicActive) {
          try {
            recognition.start();
          } catch {
            setIsMicActive(false);
          }
        }
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn("Speech recognition init error:", e);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [isMicActive]);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("お使いのブラウザは音声認識に対応していません。手動メモ欄をご活用ください。");
      return;
    }

    if (isMicActive) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsMicActive(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsMicActive(true);
      } catch (err) {
        console.error("Mic start error:", err);
      }
    }
  };

  /**
   * カメラの初期化Effect
   */
  useEffect(() => {
    let isMounted = true;

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

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

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
            ? err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
              ? "カメラの使用が拒否されています。ブラウザの設定でカメラアクセスを許可してください。"
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

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  /**
   * SSEストリーミング解析の実行
   */
  const executeAnalysis = async (blobs: Blob[]) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(40);
    }

    setIsLoading(true);
    setErrorMessage(null);
    setAnswerRawText("");
    setMetaInfo(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const formData = new FormData();
    blobs.forEach((blob, idx) => {
      formData.append("images", blob, `frame_${idx}.webp`);
    });

    // コンテキストの組み立て（ジャンル + 音声認識 + 手動メモ）
    const preset = QUIZ_PRESETS.find((p) => p.id === selectedPreset);
    const contextParts: string[] = [];
    if (preset && preset.id !== "normal") {
      contextParts.push(`【出題ジャンル・特性】: ${preset.prompt}`);
    }
    if (speechTranscript.trim()) {
      contextParts.push(`【テレビ音声/司会ナレーション聞き取り】: ${speechTranscript.trim()}`);
    }
    if (manualNote.trim()) {
      contextParts.push(`【ユーザー補足ヒント】: ${manualNote.trim()}`);
    }

    if (contextParts.length > 0) {
      formData.append("context", contextParts.join("\n"));
    }

    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `リクエスト失敗 (Status: ${response.status})`);
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
              // ignore
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : "予期せぬエラーが発生しました。";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * ワンタップ撮影キャプチャ（通常またはバースト連続2枚）
   */
  const handleCapture = async () => {
    if (isLoading) return;
    if (!videoRef.current || !isCameraReady) {
      setErrorMessage("カメラの準備が整っていません。");
      return;
    }

    try {
      const blobs: Blob[] = [];

      // 1枚目キャプチャ
      const firstBlob = await captureVideoFrame(videoRef.current, {
        maxDimension: 1280,
        quality: 0.75,
        format: "image/webp",
      });
      blobs.push(firstBlob);

      // バースト（ズームアウト変化検知）モードの場合、0.7秒後に2枚目を取得
      if (isBurstMode) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (videoRef.current) {
          const secondBlob = await captureVideoFrame(videoRef.current, {
            maxDimension: 1280,
            quality: 0.75,
            format: "image/webp",
          });
          blobs.push(secondBlob);
        }
      }

      await executeAnalysis(blobs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "キャプチャ処理に失敗しました。";
      setErrorMessage(msg);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      executeAnalysis([file]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCopy = () => {
    if (!answerRawText) return;
    navigator.clipboard.writeText(answerRawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setAnswerRawText("");
    setErrorMessage(null);
    setMetaInfo(null);
    setSpeechTranscript("");
    setManualNote("");
  };

  // テキストのパース
  const lines = answerRawText.split("\n");
  const firstLine = lines[0]?.trim() || "";
  const explanationLines = lines.slice(1).join("\n").trim();
  const colorInfo = parseAnswerColor(firstLine);

  return (
    <div className="relative min-h-screen bg-[#060911] text-gray-100 flex flex-col justify-between">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/webp,image/jpeg,image/png"
        className="hidden"
      />

      {/* ヘッダー */}
      <header className="z-20 px-3 py-2.5 bg-[#0a0f1d]/90 backdrop-blur-md border-b border-gray-800/80 sticky top-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-red-500 to-blue-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Tv className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black tracking-tight text-white">
                  オールスター感謝祭 AI解答器
                </h1>
                <span className="text-[10px] bg-red-600/80 text-white font-bold px-1.5 py-0.2 rounded">
                  dボタン直結
                </span>
              </div>
              <p className="text-[10px] text-gray-400">
                10秒カウントダウン即答特化 | 1:青 2:赤 3:緑 4:黄
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* マイク聞き取りボタン */}
            <button
              onClick={toggleMic}
              title={isMicActive ? "テレビ音声聞き取り中（タップで停止）" : "テレビ音声聞き取り開始"}
              className={`p-2 rounded-lg border transition flex items-center gap-1 text-xs font-bold ${
                isMicActive
                  ? "bg-red-500/20 border-red-500 text-red-300 animate-pulse"
                  : "bg-gray-800/80 border-gray-700/60 text-gray-400 hover:text-white"
              }`}
            >
              {isMicActive ? <Mic className="w-4 h-4 text-red-400" /> : <MicOff className="w-4 h-4" />}
            </button>

            {/* ズームアウト2連写トグル */}
            <button
              onClick={() => setIsBurstMode((prev) => !prev)}
              title="ズームアウト/映像用 2連写モード"
              className={`p-2 rounded-lg border transition text-xs font-bold flex items-center gap-1 ${
                isBurstMode
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                  : "bg-gray-800/80 border-gray-700/60 text-gray-400 hover:text-white"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span className="text-[10px] hidden sm:inline">{isBurstMode ? "2連写ON" : "通常"}</span>
            </button>

            {/* カメラ切替 */}
            {!cameraError && (
              <button
                onClick={toggleFacingMode}
                disabled={isLoading}
                title="カメラ切替"
                className="p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 text-gray-300 transition"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>
            )}

            {/* 画像アップロード */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="画像ファイルから解答"
              className="p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 text-gray-300 transition"
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* クイック出題ジャンルバー */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
          {QUIZ_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className={`px-2.5 py-1 rounded-full whitespace-nowrap transition font-semibold border ${
                selectedPreset === preset.id
                  ? "bg-gradient-to-r from-red-600 to-amber-600 border-amber-400 text-white shadow-sm"
                  : "bg-gray-900/80 border-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* 音声認識テキスト・手動補足表示（ある場合のみ） */}
        {(speechTranscript || manualNote || isMicActive) && (
          <div className="flex items-center gap-2 bg-[#121829] px-2.5 py-1.5 rounded-lg border border-gray-800 text-[11px]">
            <span className="text-red-400 font-bold shrink-0 flex items-center gap-1">
              {isMicActive && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />}
              音声/メモ:
            </span>
            <input
              type="text"
              value={manualNote || speechTranscript}
              onChange={(e) => setManualNote(e.target.value)}
              placeholder="司会者のヒントや問題文補足をここに追記可能"
              className="bg-transparent border-none outline-none text-gray-200 flex-1 text-[11px]"
            />
            {(speechTranscript || manualNote) && (
              <button
                onClick={() => {
                  setSpeechTranscript("");
                  setManualNote("");
                }}
                className="text-gray-500 hover:text-gray-300 text-[10px]"
              >
                クリア
              </button>
            )}
          </div>
        )}
      </header>

      {/* メインカメラビュー & オーバーレイ */}
      <main className="relative flex-1 flex flex-col items-center justify-center overflow-hidden p-2">
        <div className="relative w-full max-w-lg aspect-[3/4] sm:aspect-[4/3] rounded-2xl overflow-hidden bg-black/70 border border-gray-800 shadow-2xl flex items-center justify-center">
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
              <p className="text-xs text-gray-300 leading-relaxed">{cameraError}</p>
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

          {!isCameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#060911]/80 backdrop-blur-sm z-10">
              <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
              <p className="text-xs text-gray-400 font-medium">テレビ画面カメラ起動中...</p>
            </div>
          )}

          {/* クイズ認識ガイド枠 */}
          {isCameraReady && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4 z-10">
              {/* ガイド上部バッジ */}
              <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-gray-700/60 text-[11px] text-gray-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>dボタン・テレビ問題文を枠内に収めてください</span>
              </div>

              {/* 中央ファインダー枠 */}
              <div className="relative w-[92%] h-[72%] rounded-xl border border-dashed border-amber-400/50 flex items-center justify-center">
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-sm" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-sm" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-sm" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-sm" />

                {isLoading && (
                  <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_15px_#ef4444] animate-scanline" />
                )}
              </div>

              <div className="text-[10px] text-gray-400 bg-black/50 px-2 py-0.5 rounded">
                {isBurstMode ? "⚡ ズームアウト用 2連写モードON" : "⚡ 1枚高速判定"}
              </div>
            </div>
          )}
        </div>

        {/* 回答表示エリア（dボタンリモコンカラー特大表示） */}
        {(answerRawText || isLoading || errorMessage) && (
          <div className="w-full max-w-lg mt-2.5 z-20 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="rounded-2xl bg-[#0d1326]/95 backdrop-blur-2xl border border-gray-700/80 p-4 shadow-2xl relative">
              {/* カードヘッダー */}
              <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-bold text-gray-200">
                    {isLoading ? "オールスター感謝祭 解析中..." : "判定完了！リモコンを押してください"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {metaInfo && (
                    <div className="text-[11px] text-gray-300 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded-full border border-gray-700 font-mono">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      {metaInfo.elapsedMs && (
                        <span className="text-amber-400 font-black">
                          ⚡ {(metaInfo.elapsedMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>
                  )}

                  {answerRawText && (
                    <button
                      onClick={handleCopy}
                      className="text-gray-400 hover:text-white p-1"
                      title="回答をコピー"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  <button onClick={handleReset} className="text-gray-400 hover:text-white p-1" title="リセット">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {errorMessage && (
                <div className="p-2.5 bg-red-500/15 border border-red-500/40 rounded-xl text-xs text-red-300 flex items-start gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </div>
              )}

              {/* 1行目: リモコンdボタンカラーの特大バッジ表示 */}
              {firstLine && (
                <div className="mb-2.5">
                  <div className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1 flex items-center justify-between">
                    <span>リモコン推奨ボタン</span>
                    <span className="text-xs font-bold text-amber-400">{colorInfo.label}</span>
                  </div>
                  <div
                    className={`w-full ${colorInfo.bgClass} border-2 ${colorInfo.borderClass} rounded-xl px-4 py-3 text-2xl sm:text-3xl font-black ${colorInfo.textClass} shadow-xl flex items-center justify-center gap-3 text-center`}
                  >
                    {firstLine}
                  </div>
                </div>
              )}

              {/* 2行目以降: 根拠・ひっかけ理由の解説 */}
              {explanationLines && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    根拠・ひっかけ対策
                  </div>
                  <div className="text-xs sm:text-sm text-gray-200 leading-relaxed bg-black/60 p-2.5 rounded-xl border border-gray-800 whitespace-pre-wrap">
                    {explanationLines}
                  </div>
                </div>
              )}

              {isLoading && !firstLine && (
                <div className="flex items-center gap-2 py-4 justify-center text-amber-300 text-xs font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span>10秒カウントダウン勝負！超速推論中...（目標2秒）</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* フッター操作バー */}
      <footer className="z-20 p-3 pb-5 bg-[#070b16]/95 backdrop-blur-md border-t border-gray-800/80 flex flex-col items-center gap-2">
        {/* dボタン 4色ガイドインジケーター */}
        <div className="w-full max-w-lg grid grid-cols-4 gap-1.5 text-[10px] font-black text-center text-white mb-1">
          <div className="bg-blue-600/80 py-1 rounded">1 青</div>
          <div className="bg-red-600/80 py-1 rounded">2 赤</div>
          <div className="bg-emerald-600/80 py-1 rounded">3 緑</div>
          <div className="bg-amber-500/80 py-1 rounded text-black font-extrabold">4 黄</div>
        </div>

        {/* ワンタップ撮影ボタン */}
        <div className="w-full max-w-lg">
          <button
            onClick={handleCapture}
            disabled={isLoading || !isCameraReady}
            className={`w-full py-4 rounded-xl font-black text-lg flex items-center justify-center gap-2 shadow-2xl transition-all duration-150 active:scale-95 ${
              isLoading || !isCameraReady
                ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
                : "bg-gradient-to-r from-red-600 via-amber-500 to-blue-600 text-white hover:brightness-110 shadow-red-500/30 animate-pulse"
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-6 h-6 animate-spin text-white" />
                <span>オールスター感謝祭 解析中...</span>
              </>
            ) : (
              <>
                <Camera className="w-6 h-6 text-white" />
                <span>ワンタップで解答！（dボタン判定）</span>
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
