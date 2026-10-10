/**
 * 画像および入力バリデーションユーティリティ
 * 防御的設計原則に基づき、拡張子やContent-Typeの偽装を防止するため
 * バイナリ先頭のマジックナンバー検証および厳格なサイズ制限を実施します。
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const ALLOWED_MIME_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  detectedMimeType?: string;
}

/**
 * バイナリバッファの先頭バイト（マジックナンバー）からMIMEタイプを特定します。
 */
export function detectMimeTypeFromMagicNumbers(buffer: Uint8Array): string | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF (4bytes) + size (4bytes) + WEBP (4bytes)
  // RIFF: 52 49 46 46
  // WEBP: 57 45 42 50
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * アップロードされた画像バッファと申告MIMEタイプの妥当性を検証します。
 */
export function validateImageBuffer(
  buffer: Uint8Array,
  declaredMimeType?: string
): ValidationResult {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      error: "画像データが空です。",
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `ファイルサイズが上限（5MB）を超過しています。（${(
        buffer.length /
        (1024 * 1024)
      ).toFixed(2)}MB）`,
    };
  }

  const detected = detectMimeTypeFromMagicNumbers(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.includes(detected as AllowedMimeType)) {
    return {
      isValid: false,
      error: "許可されていない画像形式です。WebP, JPEG, PNGのみ対応しています。",
    };
  }

  // 申告MIMEタイプがある場合、検知結果との乖離をチェック（偽装防止）
  if (declaredMimeType && declaredMimeType !== detected) {
    return {
      isValid: false,
      error: `ヘッダーの形式(${declaredMimeType})と実際のファイル形式(${detected})が一致しません。`,
      detectedMimeType: detected,
    };
  }

  return {
    isValid: true,
    detectedMimeType: detected,
  };
}
