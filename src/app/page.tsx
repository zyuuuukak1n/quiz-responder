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
} from "lucide-react";
import { captureVideoFrame } from "@/lib/imageUtils";

interface StreamResponseMeta {
  ttftMs?: number;
  elapsedMs?: number;
}

// オールスター感謝祭・ジャンルプリセット（全タイプ完全網羅）
const QUIZ_PRESETS = [
  { id: "normal", key: "1", label: "標準4択", prompt: "オールスター感謝祭の標準4択問題。" },
  { id: "vtr", key: "2", label: "🎬 VTR動画/変化/NG", prompt: "VTR動画問題（このあと何が起きた？変化した部分は？NGは誰？）。映像と音声の時系列の流れから解け。" },
  { id: "zoom", key: "3", label: "🔍 ズームアウト/写真", prompt: "ズームアウト問題または画像特定問題。パーツや色・輪郭の特徴から全体の被写体を即断せよ。" },
  { id: "trick", key: "4", label: "⚠️ 超ひっかけ/なぞなぞ", prompt: "超ひっかけ・なぞなぞ・言葉遊び問題。直感的な罠を排除し、文字の構造や真の事実から解け。" },
  { id: "cast_tbs", key: "5", label: "🎤 出演者/TBSネタ/曲", prompt: "出演タレント、MC（今田・島崎）、TBS歴代番組、曲名、過去の名場面問題。" },
  { id: "prediction", key: "6", label: "🏃 勝敗/順位予想", prompt: "スタジオ生対決・マラソン等の勝敗・順位予想問題。" },
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

  // オールスター感謝祭・制御ステート
  const [selectedPreset, setSelectedPreset] = useState<string>("normal");
  const [isBurstMode, setIsBurstMode] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [isFlashEffect, setIsFlashEffect] = useState(false);

  // VTR完全録画（MediaRecorder）ステート
  const [isVtrRecording, setIsVtrRecording] = useState(false);
  const [vtrRecordSeconds, setVtrRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // 解析・推論ステート
  const [isLoading, setIsLoading] = useState(false);
  const [answerRawText, setAnswerRawText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metaInfo, setMetaInfo] = useState<StreamResponseMeta | null>(null);
  const [copied, setCopied] = useState(false);

  // ファイル入力参照
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const manualNoteInputRef = useRef<HTMLInputElement>(null);

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
            return combined.slice(-200);
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

  const toggleMic = useCallback(() => {
    if (!recognitionRef.current) {
      alert("お使いのブラウザは音声認識APIに対応していません。手動メモ欄をご利用ください。");
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
  }, [isMicActive]);

  /**
   * VTR完全動画録画の開始 / 停止
   */
  const startVtrRecording = useCallback(() => {
    if (!streamRef.current) {
      alert("カメラが準備できていません。");
      return;
    }

    try {
      recordedChunksRef.current = [];
      const options = { mimeType: "video/webm;codecs=vp8" };
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(streamRef.current, options);
      } catch {
        // フォールバック
        recorder = new MediaRecorder(streamRef.current);
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.start(500); // 500msごとにチャンク取得
      mediaRecorderRef.current = recorder;
      setIsVtrRecording(true);
      setVtrRecordSeconds(0);
      setSelectedPreset("vtr");
    } catch (err) {
      console.error("VTR record start error:", err);
      alert("VTR録画の開始に失敗しました。");
    }
  }, []);

  const stopVtrRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsVtrRecording(false);
  }, []);

  const toggleVtrRecording = useCallback(() => {
    if (isVtrRecording) {
      stopVtrRecording();
    } else {
      startVtrRecording();
    }
  }, [isVtrRecording, startVtrRecording, stopVtrRecording]);

  // VTR録画中タイマー
  useEffect(() => {
    if (!isVtrRecording) return;
    const interval = setInterval(() => {
      setVtrRecordSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isVtrRecording]);

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
        // 映像＋音声を同時に取得（VTR録画でテレビ音声も一緒に保存）
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 }, // 高速転送に最適な720p
            height: { ideal: 720 },
          },
          audio: true, // 音声も含めてVTR録画
        };

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // マイクが許可されない場合は映像のみでフォールバック
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        }

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
              ? "カメラまたはマイクの使用が拒否されています。ブラウザの設定でアクセスを許可してください。"
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
   * SSEストリーミング解析の実行（VTR動画Blob + 出題画面Blob）
   */
  const executeAnalysis = useCallback(
    async (params: { videoBlob?: Blob; imageBlobs: Blob[] }) => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(40);
      }

      setIsFlashEffect(true);
      setTimeout(() => setIsFlashEffect(false), 150);

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

      // VTR完全録画動画
      if (params.videoBlob && params.videoBlob.size > 0) {
        formData.append("video", params.videoBlob, "vtr_recording.webm");
      }

      // 出題・4択画面静止画
      params.imageBlobs.forEach((blob, idx) => {
        formData.append("images", blob, `question_${idx}.webp`);
      });

      const preset = QUIZ_PRESETS.find((p) => p.id === selectedPreset);
      const contextParts: string[] = [];
      if (preset && preset.id !== "normal") {
        contextParts.push(`【出題ジャンル・特性】: ${preset.prompt}`);
      }
      if (speechTranscript.trim()) {
        contextParts.push(`【テレビ出題音声/司会ナレーション】: ${speechTranscript.trim()}`);
      }
      if (manualNote.trim()) {
        contextParts.push(`【単位・条件ヒント】: ${manualNote.trim()}`);
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
        recordedChunksRef.current = [];
      }
    },
    [selectedPreset, speechTranscript, manualNote]
  );

  /**
   * 解答キャプチャ実行（VTR動画があれば完全動画＋現在の出題画面を同時送信）
   */
  const handleCapture = useCallback(async () => {
    if (isLoading) return;
    if (!videoRef.current || !isCameraReady) {
      setErrorMessage("カメラの準備が整っていません。");
      return;
    }

    try {
      // 1. VTR録画中だった場合は即座に停止してBlobを取得
      let videoBlob: Blob | undefined;
      if (isVtrRecording && mediaRecorderRef.current) {
        const recorder = mediaRecorderRef.current;
        if (recorder.state !== "inactive") {
          await new Promise<void>((resolve) => {
            recorder.onstop = () => {
              if (recordedChunksRef.current.length > 0) {
                videoBlob = new Blob(recordedChunksRef.current, {
                  type: "video/webm",
                });
              }
              resolve();
            };
            recorder.stop();
          });
        }
        setIsVtrRecording(false);
      }

      // 2. 現在の出題・4択画面フレームをキャプチャ
      const imageBlobs: Blob[] = [];
      const currentBlob = await captureVideoFrame(videoRef.current, {
        maxDimension: 1280,
        quality: 0.75,
        format: "image/webp",
      });
      imageBlobs.push(currentBlob);

      // 3. 2連写モードの場合、0.7秒後にもう1枚
      if (isBurstMode) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (videoRef.current) {
          const secondBlob = await captureVideoFrame(videoRef.current, {
            maxDimension: 1280,
            quality: 0.75,
            format: "image/webp",
          });
          imageBlobs.push(secondBlob);
        }
      }

      await executeAnalysis({ videoBlob, imageBlobs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "キャプチャ処理に失敗しました。";
      setErrorMessage(msg);
    }
  }, [isLoading, isCameraReady, isVtrRecording, isBurstMode, executeAnalysis]);

  /**
   * PCキーボードショートカット割り当て
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        if (e.key === "Escape") {
          (activeEl as HTMLElement).blur();
        }
        return;
      }

      // Space または Enter: 撮影・解答取得
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        handleCapture();
        return;
      }

      // V: VTR完全録画 開始/停止トグル
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        toggleVtrRecording();
        return;
      }

      // M: マイクON/OFF
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMic();
        return;
      }

      // B: 2連写バースト切替
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setIsBurstMode((prev) => !prev);
        return;
      }

      // R: 結果リセット
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setAnswerRawText("");
        setErrorMessage(null);
        setMetaInfo(null);
        recordedChunksRef.current = [];
        setIsVtrRecording(false);
        return;
      }

      // C: 音声メモ・手動メモのクリア
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setSpeechTranscript("");
        setManualNote("");
        return;
      }

      // 1〜6: ジャンルプリセット切り替え
      const foundPreset = QUIZ_PRESETS.find((p) => p.key === e.key);
      if (foundPreset) {
        e.preventDefault();
        setSelectedPreset(foundPreset.id);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCapture, toggleMic, toggleVtrRecording]);

  const addConditionTag = (tag: string) => {
    setManualNote((prev) => {
      if (prev.includes(tag)) return prev;
      return `${prev} ${tag}`.trim();
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      executeAnalysis({ imageBlobs: [file] });
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
    recordedChunksRef.current = [];
    setIsVtrRecording(false);
  };

  const lines = answerRawText.split("\n");
  const firstLine = lines[0]?.trim() || "";
  const explanationLines = lines.slice(1).join("\n").trim();
  const colorInfo = parseAnswerColor(firstLine);

  return (
    <div className="relative min-h-screen bg-[#050811] text-gray-100 flex flex-col justify-between">
      {isFlashEffect && <div className="fixed inset-0 bg-white/40 z-50 pointer-events-none transition-opacity" />}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/webp,image/jpeg,image/png,video/webm,video/mp4"
        className="hidden"
      />

      {/* ヘッダー */}
      <header className="z-20 px-3 py-2 bg-[#090d19]/95 backdrop-blur-md border-b border-gray-800/80 sticky top-0 flex flex-col gap-1.5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-red-500 to-blue-500 flex items-center justify-center shadow-lg shadow-red-500/25">
              <Tv className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black tracking-tight text-white">
                  オールスター感謝祭 AI完全制覇
                </h1>
                <span className="text-[10px] bg-red-600 text-white font-extrabold px-1.5 py-0.2 rounded shadow-sm">
                  gemini-3.5-flash-lite
                </span>
              </div>
              <p className="text-[10px] text-gray-400">
                VTR完全録画（1フレームも逃さない）| 10秒タイマー即答
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* 🎥 VTR完全動画録画ボタン [V] */}
            <button
              onClick={toggleVtrRecording}
              title="VTR動画録画 [V]（司会者の『映像をご覧ください』で押す）"
              className={`px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 text-xs font-black ${
                isVtrRecording
                  ? "bg-red-600 border-red-400 text-white animate-pulse shadow-lg shadow-red-600/40"
                  : "bg-gray-800/90 border-gray-700/80 text-gray-300 hover:text-white hover:bg-gray-700"
              }`}
            >
              {isVtrRecording ? (
                <>
                  <Video className="w-4 h-4 text-white animate-bounce" />
                  <span>VTR録画中 ({vtrRecordSeconds}s)</span>
                </>
              ) : (
                <>
                  <VideoOff className="w-4 h-4 text-gray-400" />
                  <span>VTR録画 [V]</span>
                </>
              )}
            </button>

            {/* マイク聞き取りボタン [M] */}
            <button
              onClick={toggleMic}
              title="テレビ音声聞き取り [M]"
              className={`px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1 text-xs font-bold ${
                isMicActive
                  ? "bg-red-500/25 border-red-500 text-red-300 animate-pulse shadow-md shadow-red-500/30"
                  : "bg-gray-800/80 border-gray-700/60 text-gray-400 hover:text-white"
              }`}
            >
              {isMicActive ? <Mic className="w-4 h-4 text-red-400" /> : <MicOff className="w-4 h-4" />}
              <span className="text-[10px] hidden sm:inline">[M]</span>
            </button>

            {/* 2連写バースト [B] */}
            <button
              onClick={() => setIsBurstMode((prev) => !prev)}
              title="ズームアウト/映像 2連写モード [B]"
              className={`px-2 py-1.5 rounded-lg border transition text-xs font-bold flex items-center gap-1 ${
                isBurstMode
                  ? "bg-cyan-500/25 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-500/20"
                  : "bg-gray-800/80 border-gray-700/60 text-gray-400 hover:text-white"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span className="text-[10px] hidden sm:inline">[B]</span>
            </button>

            {/* カメラ切替 */}
            {!cameraError && (
              <button
                onClick={toggleFacingMode}
                disabled={isLoading}
                title="USBカメラ/背面切替"
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

        {/* クイック出題ジャンル [キー1〜6] */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] no-scrollbar">
          {QUIZ_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className={`px-2.5 py-0.5 rounded-full whitespace-nowrap transition font-semibold border text-xs flex items-center gap-1 ${
                selectedPreset === preset.id
                  ? "bg-gradient-to-r from-red-600 to-amber-600 border-amber-400 text-white shadow-sm"
                  : "bg-gray-900/80 border-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              <span className="opacity-60 text-[10px]">[{preset.key}]</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>

        {/* 単位・条件クイック補完チップ */}
        <div className="flex items-center gap-1 overflow-x-auto text-[10px] no-scrollbar py-0.5">
          <span className="text-gray-400 font-bold shrink-0">省略補完:</span>
          {QUICK_CONDITION_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => addConditionTag(tag)}
              className="px-2 py-0.5 rounded bg-gray-800/90 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 whitespace-nowrap transition"
            >
              +{tag}
            </button>
          ))}
        </div>

        {/* 音声文字起こし & 手動メモ欄 */}
        <div className="flex items-center gap-2 bg-[#0d1326] px-2.5 py-1.5 rounded-lg border border-gray-800 text-[11px]">
          <span className="text-red-400 font-bold shrink-0 flex items-center gap-1">
            {isMicActive && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />}
            司会音声/補足:
          </span>
          <input
            ref={manualNoteInputRef}
            type="text"
            value={manualNote || speechTranscript}
            onChange={(e) => setManualNote(e.target.value)}
            placeholder="テレビから聞こえた問題文・単位（何m/何人/誰）を追記"
            className="bg-transparent border-none outline-none text-gray-200 flex-1 text-[11px] placeholder-gray-500"
          />
          {(speechTranscript || manualNote) && (
            <button
              onClick={() => {
                setSpeechTranscript("");
                setManualNote("");
              }}
              title="クリア [C]"
              className="text-gray-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* メインカメラプレビュー & オーバーレイエリア */}
      <main className="relative flex-1 flex flex-col items-center justify-center overflow-hidden p-2">
        <div className="relative w-full max-w-xl aspect-[16/10] sm:aspect-[16/9] rounded-2xl overflow-hidden bg-black/80 border border-gray-800 shadow-2xl flex items-center justify-center">
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
                  <Upload className="w-3.5 h-3.5" /> ファイル選択
                </button>
              </div>
            </div>
          )}

          {!isCameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#050811]/90 backdrop-blur-sm z-10">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-xs text-gray-400 font-medium">USB/PCカメラ起動中...</p>
            </div>
          )}

          {/* VTR録画中ステータスバッジ（画面オーバーレイ） */}
          {isVtrRecording && (
            <div className="absolute top-3 left-3 bg-red-600/90 text-white font-black px-3.5 py-1.5 rounded-xl shadow-2xl border border-red-400 text-xs flex items-center gap-2 animate-pulse z-20">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
              <span>VTR動画録画中: {vtrRecordSeconds}秒 (映像・音声 完全記録) ➔ 終了後Spaceで解答</span>
            </div>
          )}

          {/* クイズ認識ファインダー */}
          {isCameraReady && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-3.5 z-10">
              <div className="bg-black/70 backdrop-blur-md px-3 py-1 rounded-full border border-gray-700 text-[11px] text-gray-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span>テレビのdボタン問題画面を中央に合わせてください</span>
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
                {isVtrRecording ? "🎬 VTR動画録画中（1コマも逃さない）" : isBurstMode ? "📑 2連写モードON" : "⚡ 高速判定"} | [Space]キーで解答
              </div>
            </div>
          )}
        </div>

        {/* 回答表示カード（dボタン巨大カラーバッジ） */}
        {(answerRawText || isLoading || errorMessage) && (
          <div className="w-full max-w-xl mt-2.5 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="rounded-2xl bg-[#0c1224]/95 backdrop-blur-2xl border border-gray-700/80 p-3.5 shadow-2xl relative">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-black text-gray-100">
                    {isLoading ? "オールスター感謝祭 解析中..." : "判定完了！リモコンを押してください"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {metaInfo && (
                    <div className="text-[11px] text-gray-300 flex items-center gap-1 bg-black/70 px-2 py-0.5 rounded-full border border-gray-700 font-mono">
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

                  <button onClick={handleReset} className="text-gray-400 hover:text-white p-1" title="リセット [R]">
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
                    <span>リモコン推奨ボタン</span>
                    <span className="text-xs font-extrabold text-amber-300">{colorInfo.label}</span>
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
                    根拠・VTR照合・復元した単位
                  </div>
                  <div className="text-xs sm:text-sm text-gray-200 leading-relaxed bg-black/60 p-2.5 rounded-xl border border-gray-800 whitespace-pre-wrap">
                    {explanationLines}
                  </div>
                </div>
              )}

              {isLoading && !firstLine && (
                <div className="flex items-center gap-2 py-3 justify-center text-amber-300 text-xs font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span>10秒カウントダウン！VTR動画全編・音声・画像逆算中...（目標1〜2秒）</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* フッター操作バー & キーボードガイド */}
      <footer className="z-20 p-3 pb-4 bg-[#070b16]/95 backdrop-blur-md border-t border-gray-800/80 flex flex-col items-center gap-2">
        {/* dボタン 4色ガイドインジケーター */}
        <div className="w-full max-w-xl grid grid-cols-4 gap-1.5 text-[11px] font-black text-center text-white">
          <div className="bg-blue-600/90 py-1 rounded shadow-sm">1 青</div>
          <div className="bg-red-600/90 py-1 rounded shadow-sm">2 赤</div>
          <div className="bg-emerald-600/90 py-1 rounded shadow-sm">3 緑</div>
          <div className="bg-amber-500/90 py-1 rounded text-black font-extrabold shadow-sm">4 黄</div>
        </div>

        {/* ワンタップ撮影＆解答ボタン（Spaceキー対応） */}
        <div className="w-full max-w-xl flex gap-2 items-center">
          <button
            onClick={handleCapture}
            disabled={isLoading || !isCameraReady}
            className={`flex-1 py-3.5 rounded-xl font-black text-lg flex items-center justify-center gap-2 shadow-2xl transition-all duration-100 active:scale-95 ${
              isLoading || !isCameraReady
                ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
                : "bg-gradient-to-r from-red-600 via-amber-500 to-blue-600 text-white hover:brightness-110 shadow-red-500/30 animate-pulse"
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-6 h-6 animate-spin text-white" />
                <span>超速判定中...</span>
              </>
            ) : (
              <>
                <Camera className="w-6 h-6 text-white" />
                <span>ワンタップで解答！ [Space]</span>
              </>
            )}
          </button>
        </div>

        {/* PCキーボードショートカット一覧ガイド */}
        <div className="w-full max-w-xl flex items-center justify-center gap-3 text-[10px] text-gray-400 font-mono bg-black/40 py-1 px-2 rounded-lg border border-gray-800">
          <span className="flex items-center gap-1 text-gray-300">
            <Keyboard className="w-3 h-3" /> 操作:
          </span>
          <span><strong className="text-amber-400">[Space]</strong> 撮影</span>
          <span><strong className="text-red-400">[V]</strong> VTR録画</span>
          <span><strong className="text-cyan-400">[M]</strong> マイク</span>
          <span><strong className="text-cyan-400">[B]</strong> 2連写</span>
          <span><strong className="text-cyan-400">[R]</strong> リセット</span>
          <span><strong className="text-cyan-400">[1〜6]</strong> ジャンル</span>
        </div>
      </footer>
    </div>
  );
}
