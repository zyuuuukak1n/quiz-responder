import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamQuizAnswer, SYSTEM_PROMPT } from "../lib/gemini";

// @google/generative-ai のモッククラス
vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn(function () {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContentStream: vi.fn().mockImplementation(async () => {
            return {
              stream: (async function* () {
                yield { text: () => "【2】 赤（織田信長）\n" };
                yield { text: () => "解説: 画面の肖像画と火縄銃の特徴より織田信長が正解です。" };
              })(),
            };
          }),
        }),
      };
    }),
  };
});

describe("gemini.ts - オールスター感謝祭 完全制覇エンジン (gemini-3.5-flash-lite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("システムプロンプトがVTR映像解析・超ひっかけなぞなぞ・ビジュアル・出演者・単位逆算を網羅していること", () => {
    expect(SYSTEM_PROMPT).toContain("オールスター感謝祭");
    expect(SYSTEM_PROMPT).toContain("リモコン4択番号");
    expect(SYSTEM_PROMPT).toContain("VTRタイムシフト解析");
    expect(SYSTEM_PROMPT).toContain("超ひっかけ問題・なぞなぞ");
    expect(SYSTEM_PROMPT).toContain("ズームアウト");
    expect(SYSTEM_PROMPT).toContain("単位・条件・問題文省略の逆算・復元");
  });

  it("APIキーが未設定の場合に適切な例外を送出すること（防御的設計）", async () => {
    const generator = streamQuizAnswer({
      images: [
        {
          base64Data: "dGVzdA==",
          mimeType: "image/webp",
        },
      ],
    });

    await expect(generator.next()).rejects.toThrow(
      "GEMINI_API_KEY が設定されていません"
    );
  });

  it("複数VTRフレームと最終画面をモックAPIでストリーミング推論できること", async () => {
    const generator = streamQuizAnswer({
      images: [
        { base64Data: "ZnJhbWUx", mimeType: "image/webp" },
        { base64Data: "ZnJhbWUy", mimeType: "image/webp" },
        { base64Data: "cXVlc3Rpb24=", mimeType: "image/webp" },
      ],
      contextText: "VTR問題: このあと誰が転んだか",
      apiKey: "test-mock-api-key",
    });

    const chunks: string[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("【2】 赤（織田信長）\n");
    expect(chunks[1]).toContain("画面の肖像画");
  });
});
