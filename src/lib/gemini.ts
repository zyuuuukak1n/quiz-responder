import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini 1.5 Flash 連携クライアント
 * 低遅延・高コストパフォーマンスで画像からのクイズ直接推論を実行します。
 */

export const SYSTEM_PROMPT = `あなたは画像内のクイズ・試験問題を極めて高速に解くAIアシスタントです。
画像からクイズの問題文と選択肢を正確に読み取り、以下の厳格なフォーマットに従って回答してください。

【出力ルール】
・1行目: 正解のみを端的に出力（例: 「A」「2」「織田信長」「約3.14」など、選択肢番号・記号または具体的な正解単語・数値）。
・2行目以降: 簡潔な解説を1〜3行以内（最大150文字程度）で出力。なぜそれが正解なのかの要点のみ。
・挨拶、前置き（例: 「正解は〜です」「画像を確認しました」）、冗長な思考プロセス、結びの言葉は一切出力しないでください。`;

export interface StreamQuizAnswerOptions {
  base64Data: string;
  mimeType: string;
  timeoutMs?: number;
  apiKey?: string;
  modelName?: string;
}

/**
 * Gemini 1.5 Flash をストリーミング呼び出しし、非同期ジェネレーターでトークンを逐次返却します。
 */
export async function* streamQuizAnswer(
  options: StreamQuizAnswerOptions
): AsyncGenerator<string, void, unknown> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY が設定されていません。.env ファイルを確認してください。"
    );
  }

  const modelName = options.modelName || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const timeoutMs = options.timeoutMs ?? 7000; // 7秒タイムアウト

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.1, // 正確性重視・ブレ抑制
      maxOutputTokens: 300,
    },
  });

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const promptParts = [
      {
        inlineData: {
          data: options.base64Data,
          mimeType: options.mimeType,
        },
      },
      "この画像の問題を解き、指定フォーマットで正解と解説を出力してください。",
    ];

    // ストリーミングリクエスト開始
    const responsePromise = model.generateContentStream(promptParts, {
      signal: abortController.signal,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener("abort", () => {
        reject(new Error("LLM API呼び出しがタイムアウト（7秒）しました。"));
      });
    });

    const result = await Promise.race([responsePromise, timeoutPromise]);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
