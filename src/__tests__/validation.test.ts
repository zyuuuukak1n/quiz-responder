import { describe, it, expect } from "vitest";
import {
  validateImageBuffer,
  detectMimeTypeFromMagicNumbers,
  MAX_FILE_SIZE_BYTES,
} from "../lib/validation";

describe("validation.ts - 防御的画像バリデーション", () => {
  // ダミーの有効なJPEGバイナリ（先頭 FF D8 FF）
  const validJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);

  // ダミーの有効なPNGバイナリ（先頭 89 50 4E 47 0D 0A 1A 0A）
  const validPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  // ダミーの有効なWebPバイナリ（先頭 RIFF + size + WEBP）
  const validWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
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

    it("短すぎるデータまたは未知のバイナリの場合はnullを返すこと", () => {
      const shortBuffer = new Uint8Array([0x01, 0x02]);
      expect(detectMimeTypeFromMagicNumbers(shortBuffer)).toBeNull();

      const unknownBuffer = new Uint8Array(16).fill(0xaa);
      expect(detectMimeTypeFromMagicNumbers(unknownBuffer)).toBeNull();
    });
  });

  describe("validateImageBuffer", () => {
    it("正常なWebPバイナリを許可すること", () => {
      const result = validateImageBuffer(validWebp, "image/webp");
      expect(result.isValid).toBe(true);
      expect(result.detectedMimeType).toBe("image/webp");
    });

    it("空のバッファを拒否すること", () => {
      const result = validateImageBuffer(new Uint8Array(0));
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("空です");
    });

    it("5MBを超えるファイルサイズを拒否すること（境界値テスト）", () => {
      // 5MB + 1 byte
      const oversized = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
      // 先頭を有効なJPEGにする
      oversized.set(validJpeg, 0);

      const result = validateImageBuffer(oversized);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("5MB");
    });

    it("偽装MIME（Content-TypeはWebPだが中身はJPEG）を検知して遮断すること", () => {
      const result = validateImageBuffer(validJpeg, "image/webp");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("一致しません");
    });

    it("実行可能ファイルやHTML等の不正形式を遮断すること", () => {
      // "MZ" (Windows EXE)
      const exeHeader = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
      const result = validateImageBuffer(exeHeader);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("許可されていない画像形式");
    });
  });
});
