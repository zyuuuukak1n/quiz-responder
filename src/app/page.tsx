"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Keyboard,
  X,
  Video,
  VideoOff,
  Lock,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from "lucide-react";
import { captureVideoFrame } from "@/lib/imageUtils";

interface StreamResponseMeta {
  ttftMs?: number;
  elapsedMs?: number;
  cached?: boolean;
}

// 汎用クイズ・ジャンルプリセット
const QUIZ_PRESETS = [
  { id: "normal", key: "1", label: "標準4択", prompt: "テレビの標準的な4択クイズ問題。" },
  { id: "vtr", key: "2", label: "🎬 VTR動画/変化/NG", prompt: "VTR動画問題（このあと何が起きた？変化した部分は？NGは誰？）。映像と音声の時系列の流れから解け。" },
  { id: "zoom", key: "3", label: "🔍 ズームアウト/写真", prompt: "ズームアウト問題または画像特定問題。パーツや色・輪郭の特徴から全体の被写体を即断せよ。" },
  { id: "trick", key: "4", label: "⚠️ 超ひっかけ/なぞなぞ", prompt: "超ひっかけ・なぞなぞ・言葉遊び問題。直感的な罠を排除し、文字の構造や真の事実から解け。" },
  { id: "cast", key: "5", label: "🎤 番組ネタ/出演者/曲", prompt: "番組出演者、司会者・MC、歴代番組、曲名、過去の名場面問題。" },
  { id: "prediction", key: "6", label: "🏃 勝敗/順位予想", prompt: "スタジオ生対決・スポーツ対決等の勝敗・順位予想問題。" },
] as const;

// 単位・問いの条件クイック追加チップ
const QUICK_CONDITION_TAGS = [
  "📏 何m/cm (長さ・高さ)",
  "⚖️ 何kg/g (重さ)",
  "💰 金額・何円",
  "👥 人数・何人",
  "📅 西暦・何年",
  "🏆 勝敗・優勝者",
  "⬆️ 一番多い/高い",
  "⬇️ 一番少ない/低い",
  "❌ 該当しないもの",
  "🧩 なぞなぞ・言葉遊び",
];

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
  if (/1|青|①/.test(line)) {
    return {
      num: 1,
      colorName: "青",
      bgClass: "bg-blue-600/35",
      borderClass: "border-blue-500",
      textClass: "text-blue-200",
      label: "【1】 青ボタン (Blue)",
    };
  }
  if (/2|赤|②/.test(line)) {
    return {
      num: 2,
      colorName: "赤",
      bgClass: "bg-red-600/35",
      borderClass: "border-red-500",
      textClass: "text-red-200",
      label: "【2】 赤ボタン (Red)",
    };
  }
  if (/3|緑|③/.test(line)) {
    return {
      num: 3,
      colorName: "緑",
      bgClass: "bg-emerald-600/35",
      borderClass: "border-emerald-500",
      textClass: "text-emerald-200",
      label: "【3】 緑ボタン (Green)",
    };
  }
  if (/4|黄|④/.test(line)) {
    return {
      num: 4,
      colorName: "黄",
      bgClass: "bg-amber-500/35",
      borderClass: "border-amber-400",
      textClass: "text-amber-200",
      label: "【4】 黄ボタン (Yellow)",
    };
  }

  return {
    num: null,
    colorName: "正解",
    bgClass: "bg-cyan-500/25",
    borderClass: "border-cyan-400",
    textClass: "text-cyan-200",
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

  // クイズ制御ステート
  const [selectedPreset, setSelectedPreset] = useState<string>("normal");
  const [isBurstMode, setIsBurstMode] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [isFlashEffect, setIsFlashEffect] = useState(false);

  // 連打防止クールダウンタイマー (秒数)
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // パスコード保護 (設定モーダル)
  const [isPasscodeModalOpen, setIsPasscodeModalOpen] = useState(false);
  const [accessPasscode, setAccessPasscode] = useState("");

  // クイズ説明・前提ルールの折りたたみ状態（スマホUX最適化）
  const [isRuleCardExpanded, setIsRuleCardExpanded] = useState(false);
  const [quizDescription, setQuizDescription] = useState("");

  // MediaRecorder による VTR完全録画ステート
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedVideoChunksRef = useRef<Blob[]>([]);
  const [isVtrRecording, setIsVtrRecording] = useState(false);
  const [vtrRecordSeconds, setVtrRecordSeconds] = useState(0);
  const vtrTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRecordedVideoBlob, setLastRecordedVideoBlob] = useState<Blob | null>(null);

  // 回答ストリーミングステート
  const [isLoading, setIsLoading] = useState(false);
  const [answerRawText, setAnswerRawText] = useState("");
  const [metaInfo, setMetaInfo] = useState<StreamResponseMeta | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const answerSectionRef = useRef<HTMLDivElement>(null);

  // 初回マウント時に localStorage から復元
  useEffect(() => {
    try {
      const savedRule = localStorage.getItem("quiz_responder_description");
      if (savedRule) {
        setQuizDescription(savedRule);
      }
      const savedPasscode = localStorage.getItem("quiz_access_passcode");
      if (savedPasscode) {
        setAccessPasscode(savedPasscode);
      }
    } catch (e) {
      console.warn("localStorage read failed:", e);
    }
  }, []);

  // クイズ説明が変更されたら localStorage に永続化
  const handleQuizDescriptionChange = (text: string) => {
    setQuizDescription(text);
    try {
      localStorage.setItem("quiz_responder_description", text);
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
  };

  const handlePasscodeChange = (code: string) => {
    setAccessPasscode(code);
    try {
      localStorage.setItem("quiz_access_passcode", code);
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
  };

  // クイズ説明のみクリア
  const handleClearQuizDescription = () => {
    setQuizDescription("");
    try {
      localStorage.removeItem("quiz_responder_description");
    } catch (e) {
      console.warn("localStorage remove failed:", e);
    }
  };

  // クイック条件タグをクイズ説明に追加
  const handleAddConditionTag = (tag: string) => {
    setQuizDescription((prev) => {
      const next = prev ? `${prev} / ${tag}` : tag;
      try {
        localStorage.setItem("quiz_responder_description", next);
      } catch (e) {
        console.warn("localStorage write failed:", e);
      }
      return next;
    });
  };

  // クールダウンカウントダウン
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Web Speech API 音声認識
  const speechRecognitionRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const toggleMic = useCallback(() => {
    if (isMicActive) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsMicActive(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (!SpeechRecognition) {
      alert("お使いのブラウザは音声認識に対応していません。（Google Chrome等を推奨）");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ja-JP";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setSpeechTranscript(transcript);
      };

      recognition.onerror = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.warn("音声認識エラー:", event.error);
        if (event.error !== "no-speech") {
          setIsMicActive(false);
        }
      };

      recognition.onend = () => {
        setIsMicActive(false);
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
      setIsMicActive(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(50);
      }
    } catch (e) {
      console.error("音声認識起動失敗:", e);
      setIsMicActive(false);
    }
  }, [isMicActive]);

  // カメラストリームの起動・初期化
  useEffect(() => {
    let isMounted = true;
    const startCamera = async () => {
      try {
        setCameraError(null);
        setIsCameraReady(false);

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: true, // VTR録画時にテレビ音声も含めて記録
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (audioErr) {
          console.warn("マイク付きストリーム取得失敗、映像のみでフォールバック:", audioErr);
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        }

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          await videoRef.current.play();
          setIsCameraReady(true);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg =
          err instanceof Error
            ? err.message
            : "カメラへのアクセスに失敗しました。カメラ権限を許可してください。";
        console.error("Camera access error:", err);
        setCameraError(msg);
        setIsCameraReady(false);
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode, cameraReloadKey]);

  // カメラ（イン/アウト）切り替え
  const toggleFacingMode = useCallback(() => {
    if (isLoading) return;
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(30);
    }
  }, [isLoading]);

  // VTR動画録画トグル [V]
  const toggleVtrRecording = useCallback(() => {
    if (!streamRef.current) return;

    if (isVtrRecording) {
      // 録画停止
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsVtrRecording(false);
      if (vtrTimerIntervalRef.current) {
        clearInterval(vtrTimerIntervalRef.current);
        vtrTimerIntervalRef.current = null;
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([40, 40, 40]);
      }
      return;
    }

    // 録画開始
    try {
      recordedVideoChunksRef.current = [];
      const options = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? { mimeType: "video/webm;codecs=vp8,opus" }
        : MediaRecorder.isTypeSupported("video/webm")
        ? { mimeType: "video/webm" }
        : undefined;

      const mediaRecorder = new MediaRecorder(streamRef.current, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedVideoChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const videoBlob = new Blob(recordedVideoChunksRef.current, {
          type: mediaRecorder.mimeType || "video/webm",
        });
        setLastRecordedVideoBlob(videoBlob);
      };

      mediaRecorder.start(500);
      mediaRecorderRef.current = mediaRecorder;
      setIsVtrRecording(true);
      setVtrRecordSeconds(0);

      vtrTimerIntervalRef.current = setInterval(() => {
        setVtrRecordSeconds((prev) => {
          // 最長15秒で自動停止（動画サイズ肥大化・API浪費防止）
          if (prev >= 14) {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
              mediaRecorderRef.current.stop();
            }
            setIsVtrRecording(false);
            if (vtrTimerIntervalRef.current) {
              clearInterval(vtrTimerIntervalRef.current);
              vtrTimerIntervalRef.current = null;
            }
            return 15;
          }
          return prev + 1;
        });
      }, 1000);

      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(60);
      }
    } catch (e) {
      console.error("MediaRecorder start error:", e);
      alert("VTR動画録画の開始に失敗しました。");
    }
  }, [isVtrRecording]);

  // 回答リセット
  const handleReset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setAnswerRawText("");
    setMetaInfo(null);
    setErrorMessage(null);
    setSpeechTranscript("");
    setManualNote("");
    setLastRecordedVideoBlob(null);
    setIsLoading(false);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(25);
    }
  }, []);

  // 回答コピー
  const handleCopy = useCallback(async () => {
    if (!answerRawText) return;
    try {
      await navigator.clipboard.writeText(answerRawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [answerRawText]);

  // APIリクエスト送信 & SSEストリーミング受信
  const sendQuizRequest = useCallback(
    async (blobs: Blob[], videoBlobToAttach?: Blob | null) => {
      if (blobs.length === 0 && !videoBlobToAttach) return;
      if (cooldownSeconds > 0) return; // クールダウン中遮断

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);
      setErrorMessage(null);
      setAnswerRawText("");
      setMetaInfo(null);
      setCooldownSeconds(3); // 3秒クールダウン開始（連打・過剰APIコール防止）

      // 回答カードへスムーズスクロール
      setTimeout(() => {
        answerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);

      try {
        const formData = new FormData();

        blobs.forEach((b) => {
          formData.append("image", b, "frame.webp");
        });

        if (videoBlobToAttach) {
          formData.append("video", videoBlobToAttach, "vtr.webm");
        }

        // 統合コンテキスト生成（ジャンル、ルール、音声メモ、手動メモ）
        const presetObj = QUIZ_PRESETS.find((p) => p.id === selectedPreset);
        const contextParts: string[] = [];

        if (presetObj && presetObj.id !== "normal") {
          contextParts.push(`【出題ジャンル】: ${presetObj.prompt}`);
        }
        if (quizDescription.trim()) {
          contextParts.push(`【指定ルール・前提条件】: ${quizDescription.trim()}`);
        }
        if (speechTranscript.trim()) {
          contextParts.push(`【音声文字起こし】: ${speechTranscript.trim()}`);
        }
        if (manualNote.trim()) {
          contextParts.push(`【補足入力メモ】: ${manualNote.trim()}`);
        }

        if (contextParts.length > 0) {
          formData.append("context", contextParts.join("\n"));
        }

        const headers: Record<string, string> = {};
        if (accessPasscode.trim()) {
          headers["x-access-passcode"] = accessPasscode.trim();
        }

        const response = await fetch("/api/answer", {
          method: "POST",
          headers,
          body: formData,
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `エラーが発生しました (${response.status})`);
        }

        if (!response.body) {
          throw new Error("ストリーミング応答を取得できませんでした。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const eventData = JSON.parse(trimmed.slice(6));
              if (eventData.type === "meta") {
                setMetaInfo((prev) => ({
                  ...prev,
                  ttftMs: eventData.ttftMs,
                  cached: eventData.cached,
                }));
                if (typeof navigator !== "undefined" && navigator.vibrate) {
                  navigator.vibrate([20, 20]);
                }
              } else if (eventData.type === "chunk") {
                setAnswerRawText((prev) => prev + eventData.text);
              } else if (eventData.type === "done") {
                setMetaInfo((prev) => ({
                  ...prev,
                  elapsedMs: eventData.elapsedMs,
                  cached: eventData.cached,
                }));
                if (typeof navigator !== "undefined" && navigator.vibrate) {
                  navigator.vibrate(60);
                }
              } else if (eventData.type === "error") {
                setErrorMessage(eventData.error);
              }
            } catch (parseErr) {
              console.warn("SSE JSON Parse Error:", parseErr, trimmed);
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        const msg = err instanceof Error ? err.message : "予期せぬエラーが発生しました。";
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [
      selectedPreset,
      quizDescription,
      speechTranscript,
      manualNote,
      accessPasscode,
      cooldownSeconds,
    ]
  );

  // カメラフレーム撮影＆即座に回答要求
  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !isCameraReady || isLoading || cooldownSeconds > 0) return;

    // シャッターフラッシュ演出
    setIsFlashEffect(true);
    setTimeout(() => setIsFlashEffect(false), 120);

    // 録画中のVTR動画があれば停止
    let videoToAttach = lastRecordedVideoBlob;
    if (isVtrRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsVtrRecording(false);
      if (vtrTimerIntervalRef.current) {
        clearInterval(vtrTimerIntervalRef.current);
        vtrTimerIntervalRef.current = null;
      }
      await new Promise((r) => setTimeout(r, 200));
      if (recordedVideoChunksRef.current.length > 0) {
        videoToAttach = new Blob(recordedVideoChunksRef.current, { type: "video/webm" });
      }
    }

    try {
      const firstBlob = await captureVideoFrame(videoRef.current, {
        maxDimension: 1280,
        quality: 0.75,
      });
      const blobs: Blob[] = [firstBlob];

      if (isBurstMode) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (videoRef.current) {
          const secondBlob = await captureVideoFrame(videoRef.current, {
            maxDimension: 1280,
            quality: 0.75,
          });
          blobs.push(secondBlob);
        }
      }

      await sendQuizRequest(blobs, videoToAttach);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "撮影フレームの取得に失敗しました。";
      setErrorMessage(msg);
    }
  }, [
    isCameraReady,
    isLoading,
    cooldownSeconds,
    isBurstMode,
    isVtrRecording,
    lastRecordedVideoBlob,
    sendQuizRequest,
  ]);

  // ファイル直接アップロード
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type.startsWith("video/")) {
        await sendQuizRequest([], file);
      } else {
        await sendQuizRequest([file], null);
      }
      e.target.value = "";
    },
    [sendQuizRequest]
  );

  // PCキーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        handleCapture();
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMic();
      } else if (e.code === "KeyV") {
        e.preventDefault();
        toggleVtrRecording();
      } else if (e.code === "KeyB") {
        e.preventDefault();
        setIsBurstMode((prev) => !prev);
      } else if (e.code === "KeyR") {
        e.preventDefault();
        handleReset();
      } else if (["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].includes(e.code)) {
        e.preventDefault();
        const digit = e.code.replace("Digit", "");
        const preset = QUIZ_PRESETS.find((p) => p.key === digit);
        if (preset) {
          setSelectedPreset(preset.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCapture, toggleMic, toggleVtrRecording, handleReset]);

  // 回答テキストのパース
  const lines = answerRawText.split("\n");
  const firstLine = lines[0] || "";
  const explanationLines = lines.slice(1).join("\n").trim();
  const colorInfo = parseAnswerColor(firstLine);

  return (
    <div className="relative min-h-[100dvh] bg-[#070b14] text-gray-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* 撮影時フラッシュエフェクト */}
      {isFlashEffect && (
        <div className="fixed inset-0 bg-white/80 z-50 pointer-events-none transition-opacity duration-100" />
      )}

      {/* ファイル入力用ダミー */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/webp,image/jpeg,image/png,video/webm,video/mp4"
        className="hidden"
      />

      {/* ヘッダー */}
      <header className="z-20 px-3 py-2 bg-[#090e1c]/95 backdrop-blur-md border-b border-gray-800/80 sticky top-0 flex flex-col gap-1.5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-500 to-amber-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Tv className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black tracking-tight text-white">
                  QuizFast AI
                </h1>
                <span className="text-[10px] bg-red-600 text-white font-extrabold px-1.5 py-0.2 rounded shadow-sm">
                  gemini-3.5-flash-lite
                </span>
              </div>
              <p className="text-[10px] text-gray-400">
                リアルタイム4択高速解答 | 目標1〜2秒判定
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* パスコード設定ボタン */}
            <button
              onClick={() => setIsPasscodeModalOpen(true)}
              title="セキュリティ・パスコード設定"
              className={`p-1.5 rounded-lg border transition ${
                accessPasscode
                  ? "bg-emerald-600/25 border-emerald-500 text-emerald-300"
                  : "bg-gray-800/80 border-gray-700/60 text-gray-400 hover:text-white"
              }`}
            >
              <Lock className="w-4 h-4" />
            </button>

            {/* カメラ切替 */}
            {!cameraError && (
              <button
                onClick={toggleFacingMode}
                disabled={isLoading}
                title="イン/アウトカメラ切替"
                className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 text-gray-300 transition"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>
            )}

            {/* ファイルアップロード */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="ファイル選択（動画・画像）"
              className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 text-gray-300 transition"
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* クイック出題ジャンル [キー1〜6]（スマホ横スクロール対応） */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] no-scrollbar py-0.5">
          {QUIZ_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className={`px-2.5 py-1 rounded-full whitespace-nowrap transition font-semibold border text-xs flex items-center gap-1 shrink-0 ${
                selectedPreset === preset.id
                  ? "bg-gradient-to-r from-red-600 to-amber-600 border-amber-400 text-white shadow-sm"
                  : "bg-gray-900/80 border-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              <span className="opacity-60 text-[10px] hidden sm:inline">[{preset.key}]</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* メインエリア */}
      <main className="flex-1 flex flex-col items-center p-2.5 sm:p-4 gap-2.5 max-w-2xl mx-auto w-full pb-28">
        {/* クイズ説明・前提ルールの常時維持カード（スマホ向けアコーディオン） */}
        <section className="w-full bg-[#0a0f20]/90 backdrop-blur-md border border-gray-800 rounded-xl overflow-hidden shadow-lg transition">
          <div
            onClick={() => setIsRuleCardExpanded((prev) => !prev)}
            className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 select-none"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="text-xs font-black text-amber-400 flex items-center gap-1 shrink-0">
                📌 ルール前提
              </span>
              <span className="text-xs text-gray-300 truncate font-mono">
                {quizDescription ? quizDescription : "タップしてルール・条件を追加（画数順・重さ等）"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 text-gray-400">
              {quizDescription && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold border border-emerald-500/30">
                  常時適用中
                </span>
              )}
              {isRuleCardExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          </div>

          {/* 展開時エリア */}
          {isRuleCardExpanded && (
            <div className="p-3 border-t border-gray-800/80 flex flex-col gap-2 bg-black/40">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>出題者の説明やピリオド共通ルールを入力（回答後もリセットまで維持）</span>
                {quizDescription && (
                  <button
                    onClick={handleClearQuizDescription}
                    className="text-red-400 hover:text-red-300 font-bold"
                  >
                    クリア
                  </button>
                )}
              </div>
              <textarea
                value={quizDescription}
                onChange={(e) => handleQuizDescriptionChange(e.target.value)}
                placeholder="例: 「漢字の総画数が多い順」「体重が重い順」「ミニマラソン優勝予想」など"
                rows={2}
                className="w-full bg-[#060a16] border border-gray-700/80 rounded-lg p-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-400"
              />
              {/* クイック追加チップ */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
                {QUICK_CONDITION_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleAddConditionTag(tag)}
                    className="px-2 py-0.5 bg-gray-800/80 hover:bg-gray-700 text-gray-300 rounded text-[10px] whitespace-nowrap border border-gray-700/60 transition shrink-0"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 音声認識・手動メモ表示バー（アクティブ時） */}
        {(isMicActive || speechTranscript || manualNote) && (
          <section className="w-full bg-black/60 border border-gray-800 rounded-xl p-2.5 text-xs flex flex-col gap-1.5 shadow-md">
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span className="flex items-center gap-1 text-red-400 font-bold">
                <Mic className="w-3.5 h-3.5 animate-pulse" /> 音声認識＆メモ
              </span>
              <button
                onClick={() => {
                  setSpeechTranscript("");
                  setManualNote("");
                }}
                className="text-gray-500 hover:text-gray-300 text-[10px]"
              >
                消去
              </button>
            </div>
            {speechTranscript && (
              <div className="text-gray-200 bg-gray-900/80 p-2 rounded border border-gray-800 font-mono text-xs">
                {speechTranscript}
              </div>
            )}
          </section>
        )}

        {/* カメラビュー & クイズ認識ファインダー */}
        <div className="relative w-full aspect-[4/3] sm:aspect-[16/10] bg-black rounded-2xl overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gray-950/90 text-center gap-2 z-10">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-xs text-red-300 font-semibold">{cameraError}</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setCameraReloadKey((k) => k + 1)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 再起動
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border border-gray-700"
                >
                  <Upload className="w-3.5 h-3.5" /> ファイル選択
                </button>
              </div>
            </div>
          )}

          {!isCameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#050811]/90 backdrop-blur-sm z-10">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-xs text-gray-400 font-medium">カメラ起動中...</p>
            </div>
          )}

          {/* VTR録画中ステータスバッジ（画面オーバーレイ） */}
          {isVtrRecording && (
            <div className="absolute top-3 left-3 bg-red-600/90 text-white font-black px-3 py-1.5 rounded-xl shadow-2xl border border-red-400 text-xs flex items-center gap-2 animate-pulse z-20">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
              <span>VTR録画中: {vtrRecordSeconds}秒 (映像・音声 完全記録)</span>
            </div>
          )}

          {/* クイズ認識ファインダー */}
          {isCameraReady && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-3.5 z-10">
              <div className="bg-black/70 backdrop-blur-md px-3 py-1 rounded-full border border-gray-700 text-[11px] text-gray-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span>問題画面を枠に合わせて撮影してください</span>
              </div>

              <div className="relative w-[90%] h-[72%] rounded-xl border border-dashed border-amber-400/50 flex items-center justify-center">
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-sm" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-sm" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-sm" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-sm" />

                {isLoading && (
                  <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_20px_#ef4444] animate-scanline" />
                )}
              </div>

              <div className="text-[10px] text-gray-400 bg-black/60 px-2 py-0.5 rounded font-mono">
                {isVtrRecording
                  ? "🎬 VTR動画録画中"
                  : isBurstMode
                  ? "📑 2連写モードON"
                  : "⚡ 高速判定"}
                <span className="hidden sm:inline"> | [Space]キーで解答</span>
              </div>
            </div>
          )}
        </div>

        {/* 回答表示カード（dボタン巨大カラーバッジ） */}
        <div ref={answerSectionRef} className="w-full">
          {(answerRawText || isLoading || errorMessage) && (
            <div className="w-full mt-1 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="rounded-2xl bg-[#0c1224]/95 backdrop-blur-2xl border border-gray-700/80 p-3.5 shadow-2xl relative">
                <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-black text-gray-100">
                      {isLoading
                        ? "クイズ解析中..."
                        : "判定完了！回答を選択してください"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {metaInfo && (
                      <div className="text-[11px] text-gray-300 flex items-center gap-1 bg-black/70 px-2 py-0.5 rounded-full border border-gray-700 font-mono">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        {metaInfo.elapsedMs && (
                          <span className="text-amber-400 font-black">
                            ⚡ {(metaInfo.elapsedMs / 1000).toFixed(2)}s
                            {metaInfo.cached && " (キャッシュ)"}
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
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    <button
                      onClick={handleReset}
                      className="text-gray-400 hover:text-white p-1"
                      title="リセット [R]"
                    >
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

                {/* 1行目: リモコンボタン色バッジ */}
                {firstLine && (
                  <div className="mb-2">
                    <div className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1 flex items-center justify-between">
                      <span>推奨回答ボタン</span>
                      <span className="text-xs font-extrabold text-amber-300">
                        {colorInfo.label}
                      </span>
                    </div>
                    <div
                      className={`w-full ${colorInfo.bgClass} border-2 ${colorInfo.borderClass} rounded-xl px-4 py-3 text-2xl sm:text-3xl font-black ${colorInfo.textClass} shadow-xl flex items-center justify-center gap-3 text-center`}
                    >
                      {firstLine}
                    </div>
                  </div>
                )}

                {/* 2行目以降: 根拠・VTR理由・単位・ひっかけ理由 */}
                {explanationLines && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                      決定打・照合根拠
                    </div>
                    <div className="text-xs sm:text-sm text-gray-200 leading-relaxed bg-black/60 p-2.5 rounded-xl border border-gray-800 whitespace-pre-wrap">
                      {explanationLines}
                    </div>
                  </div>
                )}

                {/* 適用された前提ルール表示 */}
                {quizDescription && (
                  <div className="mt-2 pt-2 border-t border-gray-800 flex items-center gap-1.5 text-[10px] text-emerald-400">
                    <span className="font-bold shrink-0">📌 適用ルール:</span>
                    <span className="text-gray-300 font-mono truncate">
                      {quizDescription}
                    </span>
                  </div>
                )}

                {isLoading && !firstLine && (
                  <div className="flex items-center gap-2 py-3 justify-center text-amber-300 text-xs font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                    <span>高速判定中！映像・音声・画像逆算中...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* フッター操作バー（スマホ親指操作ゾーン: Thumb Zone 最適化） */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-[#070b16]/95 backdrop-blur-xl border-t border-gray-800/80 px-3 pt-2 safe-bottom shadow-2xl flex flex-col items-center gap-2">
        {/* 4色ガイドインジケーター（dボタン対応） */}
        <div className="w-full max-w-xl grid grid-cols-4 gap-1.5 text-[11px] font-black text-center text-white">
          <div className="bg-blue-600/90 py-0.5 rounded shadow-sm">1 青</div>
          <div className="bg-red-600/90 py-0.5 rounded shadow-sm">2 赤</div>
          <div className="bg-emerald-600/90 py-0.5 rounded shadow-sm">3 緑</div>
          <div className="bg-amber-500/90 py-0.5 rounded text-black font-extrabold shadow-sm">
            4 黄
          </div>
        </div>

        {/* コントロールボタン群（親指で届く最適配置） */}
        <div className="w-full max-w-xl flex items-center gap-2">
          {/* 🎥 VTR動画録画ボタン [V] */}
          <button
            onClick={toggleVtrRecording}
            title="VTR録画 [V]"
            className={`h-12 px-3 rounded-xl border transition flex items-center justify-center gap-1 font-bold text-xs shrink-0 ${
              isVtrRecording
                ? "bg-red-600 border-red-400 text-white animate-pulse shadow-lg shadow-red-600/40"
                : "bg-gray-800/90 border-gray-700/80 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {isVtrRecording ? (
              <>
                <Video className="w-5 h-5 text-white animate-bounce" />
                <span className="text-[11px]">{vtrRecordSeconds}s</span>
              </>
            ) : (
              <>
                <VideoOff className="w-5 h-5 text-gray-400" />
                <span className="hidden sm:inline text-[11px]">VTR</span>
              </>
            )}
          </button>

          {/* 🎙️ 音声聞き取りマイクボタン [M] */}
          <button
            onClick={toggleMic}
            title="マイク聞き取り [M]"
            className={`h-12 px-3 rounded-xl border transition flex items-center justify-center font-bold text-xs shrink-0 ${
              isMicActive
                ? "bg-red-500/30 border-red-500 text-red-300 animate-pulse shadow-md shadow-red-500/30"
                : "bg-gray-800/90 border-gray-700/80 text-gray-400 hover:text-white"
            }`}
          >
            {isMicActive ? <Mic className="w-5 h-5 text-red-400" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* メイン: ワンタップ撮影＆解答ボタン（Spaceキー対応） */}
          <button
            onClick={handleCapture}
            disabled={isLoading || !isCameraReady || cooldownSeconds > 0}
            className={`flex-1 h-12 rounded-xl font-black text-base sm:text-lg flex items-center justify-center gap-2 shadow-2xl transition-all duration-100 active:scale-95 ${
              isLoading || !isCameraReady || cooldownSeconds > 0
                ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
                : "bg-gradient-to-r from-red-600 via-amber-500 to-blue-600 text-white hover:brightness-110 shadow-red-500/30 animate-pulse"
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin text-white" />
                <span>解析中...</span>
              </>
            ) : cooldownSeconds > 0 ? (
              <>
                <Clock className="w-5 h-5 text-gray-400" />
                <span>待機中 ({cooldownSeconds}s)</span>
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 text-white" />
                <span>撮影＆解答！</span>
              </>
            )}
          </button>

          {/* 📑 2連写トグル [B] */}
          <button
            onClick={() => setIsBurstMode((prev) => !prev)}
            title="2連写モード [B]"
            className={`h-12 px-3 rounded-xl border transition flex items-center justify-center font-bold text-xs shrink-0 ${
              isBurstMode
                ? "bg-cyan-500/25 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-500/20"
                : "bg-gray-800/90 border-gray-700/80 text-gray-400 hover:text-white"
            }`}
          >
            <Layers className="w-5 h-5" />
          </button>

          {/* 🔄 リセットボタン [R] */}
          <button
            onClick={handleReset}
            title="回答リセット [R]"
            className="h-12 px-3 rounded-xl bg-gray-800/90 hover:bg-gray-700 border border-gray-700/80 text-gray-300 transition flex items-center justify-center shrink-0"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </footer>

      {/* セキュリティ・パスコード設定モーダル */}
      {isPasscodeModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0e1428] border border-gray-700 rounded-2xl max-w-sm w-full p-4 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-white">アクセスパスコード設定</h3>
              </div>
              <button
                onClick={() => setIsPasscodeModalOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              サーバーで環境変数 <code className="text-amber-300">ACCESS_PASSCODE</code> が設定されている場合、ここに同じパスコードを入力してください。ブラウザに安全に保存されます。
            </p>
            <input
              type="password"
              value={accessPasscode}
              onChange={(e) => handlePasscodeChange(e.target.value)}
              placeholder="パスコードを入力"
              className="w-full bg-[#060a16] border border-gray-700 rounded-lg p-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => {
                  handlePasscodeChange("");
                  setIsPasscodeModalOpen(false);
                }}
                className="px-3 py-1.5 bg-gray-800 text-gray-300 text-xs rounded-lg hover:bg-gray-700"
              >
                クリア
              </button>
              <button
                onClick={() => setIsPasscodeModalOpen(false)}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg"
              >
                保存して閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
