/**
 * 画像および動画入力バリデーションユーティリティ
 * 防御的設計原則に基づき、拡張子やContent-Typeの偽装を防止するため
 * バイナリ先頭のマジックナンバー検証および厳格なサイズ制限を実施します。
 * また、プロンプトインジェクションや過剰トークン消費を防止するテキスト検証も含みます。
 */

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_FILE_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES; // 後方互換性エイリアス
export const MAX_VIDEO_SIZE_BYTES = 25 * 1024 * 1024; // 25MB（動画用）
export const MAX_CONTEXT_TEXT_LENGTH = 500; // ルール・メモの最大長（トークン浪費・攻撃防止）

export const ALLOWED_IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

export const ALLOWED_VIDEO_TYPES = [
  "video/webm",
  "video/mp4",
] as const;

export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
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

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
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

  // 3. WebP: RIFF (4bytes) + size (4bytes) + WEBP (4bytes)
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

  // 4. WebM: 1A 45 DF A3 (EBML ID)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "video/webm";
  }

  // 5. MP4: offset 4-7 is "ftyp" (66 74 79 70)
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return "video/mp4";
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
  return validateMediaBuffer(buffer, declaredMimeType, false);
}

/**
 * メディア（画像または動画）の妥当性を検証します。
 */
export function validateMediaBuffer(
  buffer: Uint8Array,
  declaredMimeType?: string,
  isVideo: boolean = false
): ValidationResult {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      error: "メディアデータが空です。",
    };
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  const label = isVideo ? "動画" : "画像";

  if (buffer.length > maxSize) {
    return {
      isValid: false,
      error: `${label}ファイルサイズが上限（${(maxSize / (1024 * 1024)).toFixed(0)}MB）を超過しています。（${(
        buffer.length /
        (1024 * 1024)
      ).toFixed(2)}MB）`,
    };
  }

  const detected = detectMimeTypeFromMagicNumbers(buffer);
  const allowedList = isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;

  if (!detected || !allowedList.includes(detected as never)) {
    return {
      isValid: false,
      error: isVideo
        ? "許可されていない動画形式です。WebM, MP4のみ対応しています。"
        : "許可されていない画像形式です。WebP, JPEG, PNGのみ対応しています。",
    };
  }

  // 申告MIMEタイプがある場合、検知結果との乖離をチェック（偽装防止）
  if (declaredMimeType && !declaredMimeType.includes(detected.split("/")[1])) {
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

/**
 * 補足ルールや音声文字起こしテキストのサニタイズ & 長さ検証
 * プロンプトインジェクションや過度なトークン浪費を防御します。
 */
export function sanitizeAndValidateContextText(
  text?: string
): { isValid: boolean; sanitizedText: string; error?: string } {
  if (!text || text.trim().length === 0) {
    return { isValid: true, sanitizedText: "" };
  }

  // 制御文字（NULLバイトなど）の除去
  let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();

  // 最大長チェック
  if (cleaned.length > MAX_CONTEXT_TEXT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_CONTEXT_TEXT_LENGTH);
  }

  // システム指示の上書きを狙うXML風閉じタグのサニタイズ
  cleaned = cleaned
    .replace(/<\/?[a-zA-Z_]+>/g, "")
    .replace(/```/g, "'''");

  return {
    isValid: true,
    sanitizedText: cleaned,
  };
}

/**
 * リクエストの重複検知用キャッシュキーを生成します。
 */
export function computeMediaRequestHash(
  mainBase64Data: string,
  contextText: string = ""
): string {
  // 長大なbase64全体をハッシュ化する代わりに、先頭・末尾・長さ・コンテキストから高速キーを生成
  const head = mainBase64Data.slice(0, 64);
  const tail = mainBase64Data.slice(-64);
  const len = mainBase64Data.length;
  return `hash_${len}_${head.slice(0, 16)}_${tail.slice(-16)}_${contextText.slice(0, 32)}`;
}
