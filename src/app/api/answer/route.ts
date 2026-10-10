import { NextRequest, NextResponse } from "next/server";
import { defaultRateLimiter } from "@/lib/rateLimiter";
import { validateImageBuffer } from "@/lib/validation";
import { streamQuizAnswer, ImageInputItem } from "@/lib/gemini";

/**
 * 構造化ログ出力ヘルパー
 */
function logEvent(data: {
  level: "info" | "warn" | "error";
  requestId: string;
  clientIpMasked: string;
  durationMs?: number;
  status?: number;
  message: string;
  error?: string;
}) {
  const logObj = {
    timestamp: new Date().toISOString(),
    ...data,
  };
  if (data.level === "error") {
    console.error(JSON.stringify(logObj));
  } else if (data.level === "warn") {
    console.warn(JSON.stringify(logObj));
  } else {
    console.log(JSON.stringify(logObj));
  }
}

/**
 * IPアドレスの末尾をマスクしてログ用の安全な識別子を生成します。
 */
function maskIp(ip: string): string {
  if (!ip) return "unknown";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + ":****";
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  return "masked";
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId =
    request.headers.get("x-request-id") ||
    `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // クライアントIPの取得（リバースプロキシヘッダー対応）
  const forwardedFor = request.headers.get("x-forwarded-for");
  const rawIp = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : request.headers.get("x-real-ip") || "127.0.0.1";
  const clientIpMasked = maskIp(rawIp);

  // 1. レートリミット検証
  const rateLimitResult = defaultRateLimiter.check(rawIp);
  if (!rateLimitResult.allowed) {
    const durationMs = Date.now() - startTime;
    logEvent({
      level: "warn",
      requestId,
      clientIpMasked,
      durationMs,
      status: 429,
      message: "レートリミット超過（短時間での過剰リクエスト）",
    });

    return NextResponse.json(
      {
        error: "短時間でのリクエストが多すぎます。少し待ってから再試行してください。",
        resetTimeMs: rateLimitResult.resetTimeMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(
            (rateLimitResult.resetTimeMs - Date.now()) / 1000
          ).toString(),
        },
      }
    );
  }

  // 2. アップロードデータの取得 & バリデーション
  const imageInputs: ImageInputItem[] = [];
  let contextText: string | undefined;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      logEvent({
        level: "warn",
        requestId,
        clientIpMasked,
        status: 400,
        message: "不正なContent-Type（multipart/form-data が必要です）",
      });
      return NextResponse.json(
        { error: "Content-Type は multipart/form-data である必要があります。" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    contextText = (formData.get("context") as string) || undefined;

    // 単一または複数の画像ファイルを取得
    const files = formData.getAll("image").concat(formData.getAll("images"));

    if (files.length === 0) {
      logEvent({
        level: "warn",
        requestId,
        clientIpMasked,
        status: 400,
        message: "画像ファイルが送信されていません。",
      });
      return NextResponse.json(
        { error: "有効な画像ファイル（image）を添付してください。" },
        { status: 400 }
      );
    }

    // 最大10フレームまで処理（VTRタイムシフト＋出題画面）
    const targetFiles = files.slice(0, 10);

    for (const file of targetFiles) {
      if (!(file instanceof Blob)) continue;

      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = new Uint8Array(arrayBuffer);

      // マジックナンバー & サイズ検証
      const validation = validateImageBuffer(fileBuffer, file.type);
      if (!validation.isValid) {
        logEvent({
          level: "warn",
          requestId,
          clientIpMasked,
          status: 400,
          message: "画像バリデーション不合格",
          error: validation.error,
        });
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      imageInputs.push({
        base64Data: Buffer.from(fileBuffer).toString("base64"),
        mimeType: validation.detectedMimeType!,
      });
    }

    if (imageInputs.length === 0) {
      return NextResponse.json(
        { error: "有効な画像データが解析できませんでした。" },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "データ解析失敗";
    logEvent({
      level: "error",
      requestId,
      clientIpMasked,
      status: 400,
      message: "リクエストボディの解析に失敗しました。",
      error: errorMessage,
    });
    return NextResponse.json(
      { error: "不正なリクエスト形式です。" },
      { status: 400 }
    );
  }

  // 3. SSEストリーミングレスポンス構築
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let firstTokenTime: number | null = null;
        let tokenCount = 0;

        // Gemini 1.5 Flash へのストリーミング推論（7秒タイムアウト設定済み）
        for await (const chunk of streamQuizAnswer({
          images: imageInputs,
          contextText,
        })) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            const ttftMs = firstTokenTime - startTime;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "meta",
                  ttftMs,
                })}\n\n`
              )
            );
          }

          tokenCount++;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "chunk",
                text: chunk,
              })}\n\n`
            )
          );
        }

        const totalElapsedMs = Date.now() - startTime;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              elapsedMs: totalElapsedMs,
            })}\n\n`
          )
        );
        controller.close();

        logEvent({
          level: "info",
          requestId,
          clientIpMasked,
          durationMs: totalElapsedMs,
          status: 200,
          message: `オールスター感謝祭解答ストリーミング完了 (画像数: ${
            imageInputs.length
          }, トークン数: ${tokenCount}, TTFT: ${
            firstTokenTime ? firstTokenTime - startTime : 0
          }ms)`,
        });
      } catch (streamError: unknown) {
        const errorMsg =
          streamError instanceof Error
            ? streamError.message
            : "推論中にエラーが発生しました。";

        logEvent({
          level: "error",
          requestId,
          clientIpMasked,
          durationMs: Date.now() - startTime,
          status: 500,
          message: "ストリーミング処理中に例外発生",
          error: errorMsg,
        });

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              error: errorMsg.includes("タイムアウト")
                ? "サーバー応答がタイムアウトしました。もう一度撮影してください。"
                : "AI解答の生成中にエラーが発生しました。時間をおいて再試行してください。",
            })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
