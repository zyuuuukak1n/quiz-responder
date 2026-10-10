import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini 3.5 Flash Lite / 1.5 Flash 連携クライアント
 * TBS「オールスター感謝祭」完全制覇エンジン
 * 
 * VTR動画（WebM完全録画・映像＋音声）直接ネイティブ入力、
 * ビジュアル問題、超ひっかけ・なぞなぞ、出演者・芸能・TBS独自ネタ、
 * 単位・条件省略逆算に完全対応。
 */

export const SYSTEM_PROMPT = `あなたはTBS「オールスター感謝祭」で完全全問正解（ノーミス・ピリオドチャンピオン）を勝ち取るための絶対的解答AIです。
制限時間わずか10秒（目標1〜2秒台で決定）のクイズに対し、VTR映像の流れ・画面の映像・データ放送画面・音声コンテキストを統合し、唯一の正解を瞬時に導き出してください。
間違えてよい問題は一問もありません。

【オールスター感謝祭 超高精度・全問正解ルール】
1. リモコン4択番号の最優先決定:
   ・オールスター感謝祭はリモコンの4色ボタン【1:青】【2:赤】【3:緑】【4:黄】で回答します。
   ・1行目には必ず冒頭に【1】〜【4】の番号（および選択肢名）を出力してください。

2. 【VTR完全動画（映像＆音声）の時系列追跡・完全理解】:
   ・VTR動画（WebM等）が提供された場合、その動画の映像の全フレームおよび音声を最初から最後まで精査してください。
   ・VTR内で起きた「人物の行動」「ハプニング」「画面の変化」「テロップ」「NGの瞬間」「オチ」を1コマ・1秒も逃さず正確にトレースし、出題画面の「このあと何が起きた？」「今の映像で変わったのは？」「誰の映像？」に完璧に合致する選択肢を選んでください。

3. 【超ひっかけ問題・なぞなぞ・言葉遊びの完全看破】:
   ・感謝祭特有の「直感で選ぶと必ず引っかかる罠」「意地悪な引っかけ」を徹底的に警戒してください。
   ・なぞなぞ・言葉遊びの場合（ひらがな、漢字の形や部首、アナグラム、だじゃれ、とんち）は、文字通りの意味に惑わされず、言葉の構造から真の答えを見抜いてください。
   ・事実問題の場合、ありがちな誤認や似た名前・紛らわしい数値を慎重に排除してください。

4. 【ビジュアル・画像・ズームアウト問題の特定】:
   ・一部拡大、徐々に引くズームアウト、モザイク、シルエット問題では、わずかな色・質感・パーツの輪郭・陰影から、被写体（人物・建造物・動物・料理・日用品等）を即座に1点特定してください。

5. 【出演者・芸能人・TBS番組固有問題】:
   ・スタジオ出演タレント、MC（今田耕司・島崎和歌子）、TBSドラマ・バラエティ番組、赤坂5丁目ミニマラソン、過去の感謝祭の名場面に関する問題では、TBSの放送文脈と芸能界の事実関係を総動員して正解を特定してください。

6. 【単位・条件・問題文省略の逆算・復元】:
   ・画面上で単位（m, kg, 円, 人, 年, 秒 等）や条件（最も大きい、最も低い、古い順、勝者、何倍 等）が省略されている場合、提供された音声認識メモを最優先し、ない場合は4つの選択肢の数字や語彙から【出題者が問うている単位・比較条件】を論理逆算して解答してください。

【出力フォーマット（厳格遵守）】
・1行目: 【番号】 選択肢テキスト（例: 「【2】 赤（明智光秀）」「【3】 3,776m」「【1】 青（転んだ）」など。番号を必ず明記！）
・2行目以降: 正解の決定打・VTR根拠・ひっかけ回避の理由（2〜3行以内、最大150字程度）。
・挨拶、前置き、余計な前置き思考は一切出力しないでください。`;

export interface MediaInputItem {
  base64Data: string;
  mimeType: string;
}

export interface StreamQuizAnswerOptions {
  video?: MediaInputItem; // VTR完全録画（映像＋音声）
  images: MediaInputItem[]; // 出題・4択画面静止画
  contextText?: string;
  timeoutMs?: number;
  apiKey?: string;
  modelName?: string;
}

/**
 * Gemini をストリーミング呼び出しし、非同期ジェネレーターでトークンを逐次返却します。
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

  const modelName =
    options.modelName || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const timeoutMs = options.timeoutMs ?? 7000; // 7秒タイムアウト

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 300,
    },
  });

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const promptParts: Array<
      | string
      | {
          inlineData: {
            data: string;
            mimeType: string;
          };
        }
    > = [];

    // 1. VTR完全録画動画（映像＋音声）が存在する場合
    if (options.video) {
      promptParts.push("【直前に流れたVTR映像の完全録画（映像フレームおよび音声）】:");
      promptParts.push({
        inlineData: {
          data: options.video.base64Data,
          mimeType: options.video.mimeType,
        },
      });
    }

    // 2. 出題・4択画面（または複数キーフレーム）
    if (options.images.length > 0) {
      promptParts.push("【現在表示されている出題・4択回答画面】:");
      for (const img of options.images) {
        promptParts.push({
          inlineData: {
            data: img.base64Data,
            mimeType: img.mimeType,
          },
        });
      }
    }

    let userPromptText =
      "このオールスター感謝祭の問題を解き、リモコンで押すべき【番号】と選択肢、簡潔な根拠を出力してください。VTR動画の内容、超ひっかけ、ビジュアル、出演者情報、省略された単位・条件を完全に加味してノーミスで正解してください。";

    if (options.contextText && options.contextText.trim().length > 0) {
      userPromptText += `\n\n【補足コンテキスト・司会者音声メモ・ジャンル指定】:\n${options.contextText.trim()}`;
    }

    promptParts.push(userPromptText);

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
