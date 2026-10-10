import { describe, it, expect } from "vitest";
import {
  validateImageBuffer,
  validateMediaBuffer,
  detectMimeTypeFromMagicNumbers,
  MAX_FILE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from "../lib/validation";

describe("validation.ts - 防御的画像・動画バリデーション", () => {
  const validJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);

  const validPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  const validWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  // WebM: 1A 45 DF A3
  const validWebm = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81,
  ]);

  describe("detectMimeTypeFromMagicNumbers", () => {
    it("JPEGのマジックナンバーを正確に検知すること", () => {
      expect(detectMimeTypeFromMagicNumbers(validJpeg)).toBe("image/jpeg");
    });

    it("PNGのマジックナンバーを正確に検知すること", () => {
      expect(detectMimeTypeFromMagicNumbers(validPng)).toBe("image/png");
    });

    it("WebPのマジックナンバーを正確に検知すること", () => {
      expect(detectMimeTypeFromMagicNumbers(validWebp)).toBe("image/webp");
    });

    it("WebM動画のマジックナンバーを正確に検知すること", () => {
      expect(detectMimeTypeFromMagicNumbers(validWebm)).toBe("video/webm");
    });

    it("短すぎるデータまたは未知のバイナリの場合はnullを返すこと", () => {
      const shortBuffer = new Uint8Array([0x01, 0x02]);
      expect(detectMimeTypeFromMagicNumbers(shortBuffer)).toBeNull();

      const unknownBuffer = new Uint8Array(16).fill(0xaa);
      expect(detectMimeTypeFromMagicNumbers(unknownBuffer)).toBeNull();
    });
  });

  describe("validateImageBuffer / validateMediaBuffer", () => {
    it("正常なWebPバイナリを許可すること", () => {
      const result = validateImageBuffer(validWebp, "image/webp");
      expect(result.isValid).toBe(true);
      expect(result.detectedMimeType).toBe("image/webp");
    });

    it("正常なWebM動画バイナリを許可すること", () => {
      const result = validateMediaBuffer(validWebm, "video/webm", true);
      expect(result.isValid).toBe(true);
      expect(result.detectedMimeType).toBe("video/webm");
    });

    it("空のバッファを拒否すること", () => {
      const result = validateImageBuffer(new Uint8Array(0));
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("空です");
    });

    it("5MBを超える画像ファイルサイズを拒否すること（境界値テスト）", () => {
      const oversized = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
      oversized.set(validJpeg, 0);

      const result = validateImageBuffer(oversized);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("5MB");
    });

    it("25MBを超える動画ファイルサイズを拒否すること（境界値テスト）", () => {
      const oversizedVideo = new Uint8Array(MAX_VIDEO_SIZE_BYTES + 1);
      oversizedVideo.set(validWebm, 0);

      const result = validateMediaBuffer(oversizedVideo, "video/webm", true);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("25MB");
    });

    it("偽装MIME（Content-TypeはWebPだが中身はJPEG）を検知して遮断すること", () => {
      const result = validateImageBuffer(validJpeg, "image/webp");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("一致しません");
    });

    it("実行可能ファイルやHTML等の不正形式を遮断すること", () => {
      const exeHeader = new Uint8Array([
        0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
      ]);
      const result = validateImageBuffer(exeHeader);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("許可されていない画像形式");
    });
  });
});
