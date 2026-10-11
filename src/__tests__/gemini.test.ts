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

describe("gemini.ts - リアルタイム・クイズ超速解答エンジン (gemini-3.5-flash-lite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("システムプロンプトから番組固有の固有名詞が完全に排除され、汎用4択・テレビクイズ仕様であること", () => {
    // 固有名詞が排除されていること
    expect(SYSTEM_PROMPT).not.toContain("オールスター感謝祭");
    expect(SYSTEM_PROMPT).not.toContain("TBS");
    expect(SYSTEM_PROMPT).not.toContain("今田耕司");
    expect(SYSTEM_PROMPT).not.toContain("島崎和歌子");
    expect(SYSTEM_PROMPT).not.toContain("赤坂5丁目ミニマラソン");

    // 汎用4色・クイズ解答機能が網羅されていること
    expect(SYSTEM_PROMPT).toContain("リモコン4択番号");
    expect(SYSTEM_PROMPT).toContain("VTR完全動画（映像＆音声）");
    expect(SYSTEM_PROMPT).toContain("超ひっかけ問題・なぞなぞ");
    expect(SYSTEM_PROMPT).toContain("ズームアウト");
    expect(SYSTEM_PROMPT).toContain("単位・条件・問題文省略の逆算・復元");
    expect(SYSTEM_PROMPT).toContain("ユーザー指定のクイズ説明・ルール・前提条件の絶対遵守");
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
