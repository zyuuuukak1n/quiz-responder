import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini 1.5 Flash 連携クライアント
 * TBS「オールスター感謝祭」などの意地悪・ニッチ・ズームアウト・省略問題に
 * 超高精度かつ2〜3秒の超高速で回答する特化型エンジン。
 */

export const SYSTEM_PROMPT = `あなたはTBS「オールスター感謝祭」をはじめとするテレビ早押し4択クイズの最強解答AIです。
制限時間わずか10秒（目標2〜3秒で決定）のクイズに対し、画面の映像・データ放送画面・音声コンテキストから正解を瞬時に導き出してください。

【オールスター感謝祭 特有の攻略ルール】
1. リモコン4択番号の最優先特定:
   ・オールスター感謝祭はリモコンの4色ボタン【1:青】【2:赤】【3:緑】【4:黄】で回答します。
   ・1行目には必ず冒頭に【1】〜【4】の番号（および選択肢名）を出力してください。
2. 省略された問題文・文脈の推測・復元:
   ・データ放送画面では文字数制限のため問題文が「？に入るのは？」「次のうち誰？」「このあとどうなる？」など極度に省略されています。
   ・画面内のテロップ、ワイプ映像、スタジオの状況、選択肢1〜4の共通点、および提供された【音声・補足メモ】から、出題者が問うている真の問題を完璧に推測・補完して解いてください。
3. 意地悪・引っかけ・ニッチ問題への警戒:
   ・一見すると直感で飛びつきやすい選択肢（ありがちな間違い・同音異義語・偽の法則）はトラップです。
   ・TBS番組の歴史、芸能、時事、細かい事実関係、数字の正確性を冷静に吟味し、引っかけを回避してください。
4. ズームアウト・映像・画像問題の特定:
   ・画面の一部拡大写真、徐々に引くズームアウト画像、モザイクの場合、色・模様・パーツの微小な特徴から元の全体（人物・物体・場所・料理など）を即断してください。複数枚の画像がある場合はその変化を比較してください。
5. 出題ジャンルやユーザー音声メモの重視:
   ・問題ジャンルや司会者のナレーションの書き起こしが付与された場合は、それを最重要ヒントとして活用してください。

【出力フォーマット（厳格遵守）】
・1行目: 【番号】 選択肢テキスト（例: 「【2】 赤（明智光秀）」「【3】 東京タワー」「【1】 青」など。番号を必ず明記！）
・2行目以降: 正解の決定打・ひっかけ回避の理由（2〜3行以内、最大150字程度）。
・挨拶、前置き、余計な前置き思考は一切出力しないでください。`;

export interface ImageInputItem {
  base64Data: string;
  mimeType: string;
}

export interface StreamQuizAnswerOptions {
  images: ImageInputItem[];
  contextText?: string;
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
    // 複数画像およびプロンプトパートの構築
    const promptParts: Array<
      | string
      | {
          inlineData: {
            data: string;
            mimeType: string;
          };
        }
    > = [];

    // 画像追加
    for (const img of options.images) {
      promptParts.push({
        inlineData: {
          data: img.base64Data,
          mimeType: img.mimeType,
        },
      });
    }

    // 補足コンテキスト（音声認識メモ、ジャンル指定等）
    let userPromptText =
      "このオールスター感謝祭/クイズ画面の問題を解き、リモコンで押すべき【番号】と選択肢、簡潔な根拠を出力してください。";

    if (options.contextText && options.contextText.trim().length > 0) {
      userPromptText += `\n\n【補足コンテキスト・司会者音声メモ】:\n${options.contextText.trim()}`;
    }

    promptParts.push(userPromptText);

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
