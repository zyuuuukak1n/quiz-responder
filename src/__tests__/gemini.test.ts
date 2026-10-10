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
                yield { text: () => "A\n" };
                yield { text: () => "解説: 問題文の条件より選択肢Aが妥当です。" };
              })(),
            };
          }),
        }),
      };
    }),
  };
});

describe("gemini.ts - Gemini 1.5 Flash 推論クライアント", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("システムプロンプトが1行目の正解と2行目の解説（前置き禁止）を規定していること", () => {
    expect(SYSTEM_PROMPT).toContain("1行目: 正解のみ");
    expect(SYSTEM_PROMPT).toContain("2行目以降: 簡潔な解説");
    expect(SYSTEM_PROMPT).toContain("挨拶、前置き");
  });

  it("APIキーが未設定の場合に適切な例外を送出すること（防御的設計）", async () => {
    const generator = streamQuizAnswer({
      base64Data: "dGVzdA==",
      mimeType: "image/webp",
    });

    await expect(generator.next()).rejects.toThrow(
      "GEMINI_API_KEY が設定されていません"
    );
  });

  it("モックされたGemini APIからストリーミングチャンクを逐次取得できること", async () => {
    const generator = streamQuizAnswer({
      base64Data: "dGVzdA==",
      mimeType: "image/webp",
      apiKey: "test-mock-api-key",
    });

    const chunks: string[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("A\n");
    expect(chunks[1]).toContain("解説: 問題文の条件より");
  });
});
