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
                yield { text: () => "【1】 青（転んだ）\n" };
                yield { text: () => "解説: VTR動画の8秒付近で階段を踏み外して転倒した場面が確認できます。" };
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

  it("システムプロンプトがVTR完全動画・超ひっかけなぞなぞ・ビジュアル・出演者・単位逆算を網羅していること", () => {
    expect(SYSTEM_PROMPT).toContain("オールスター感謝祭");
    expect(SYSTEM_PROMPT).toContain("リモコン4択番号");
    expect(SYSTEM_PROMPT).toContain("VTR完全動画（映像＆音声）");
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

  it("VTR完全動画と出題画面をモックAPIでストリーミング推論できること", async () => {
    const generator = streamQuizAnswer({
      video: {
        base64Data: "dGVzdF92aWRlbw==",
        mimeType: "video/webm",
      },
      images: [
        { base64Data: "cXVlc3Rpb24=", mimeType: "image/webp" },
      ],
      contextText: "VTR問題: このあとどうなる？",
      apiKey: "test-mock-api-key",
    });

    const chunks: string[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("【1】 青（転んだ）\n");
    expect(chunks[1]).toContain("階段を踏み外して");
  });
});
