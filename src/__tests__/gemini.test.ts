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

describe("gemini.ts - オールスター感謝祭 特化型推論クライアント", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("システムプロンプトがオールスター感謝祭のdボタン番号・単位や問題文省略復元・引っかけ警戒を規定していること", () => {
    expect(SYSTEM_PROMPT).toContain("オールスター感謝祭");
    expect(SYSTEM_PROMPT).toContain("リモコン4択番号");
    expect(SYSTEM_PROMPT).toContain("単位・比較条件・問題文の省略");
    expect(SYSTEM_PROMPT).toContain("引っかけ・ニッチ問題");
    expect(SYSTEM_PROMPT).toContain("ズームアウト");
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

  it("モックされたGemini APIからストリーミングチャンクを逐次取得できること", async () => {
    const generator = streamQuizAnswer({
      images: [
        {
          base64Data: "dGVzdA==",
          mimeType: "image/webp",
        },
      ],
      contextText: "ズームアウト問題です",
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
