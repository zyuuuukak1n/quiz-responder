/**
 * 画像リサイズ・圧縮ユーティリティ
 * クイズの文字認識精度を保ちつつ、通信ペイロードを100KB〜300KBに抑えるため
 * 最大長辺1280pxへのリサイズとWebP/JPEG圧縮を行います。
 */

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * アスペクト比を維持しながら最大長辺に収まるサイズを計算します。
 * （純粋関数のため単体テスト可能）
 */
export function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number = 1280
): Dimensions {
  if (originalWidth <= 0 || originalHeight <= 0 || maxDimension <= 0) {
    return { width: 0, height: 0 };
  }

  const longerSide = Math.max(originalWidth, originalHeight);
  if (longerSide <= maxDimension) {
    return {
      width: Math.round(originalWidth),
      height: Math.round(originalHeight),
    };
  }

  const scale = maxDimension / longerSide;
  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

export interface CaptureOptions {
  maxDimension?: number;
  quality?: number; // 0.0 ~ 1.0
  format?: "image/webp" | "image/jpeg";
}

/**
 * HTMLVideoElementの現在のフレームをCanvas経由でキャプチャし、
 * 指定された解像度・圧縮フォーマットのBlobを生成します。
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  options: CaptureOptions = {}
): Promise<Blob> {
  const maxDimension = options.maxDimension ?? 1280;
  const quality = options.quality ?? 0.75;
  const preferredFormat = options.format ?? "image/webp";

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;

  if (!videoWidth || !videoHeight) {
    throw new Error("カメラ映像のフレームがまだ準備できていません。");
  }

  const { width, height } = calculateDimensions(
    videoWidth,
    videoHeight,
    maxDimension
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvasコンテキストの初期化に失敗しました。");
  }

  // 高画質スケーリング
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, width, height);

  // WebP対応確認とBlob生成
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          // WebP非対応ブラウザの場合、image/jpeg にフォールバック
          canvas.toBlob(
            (fallbackBlob) => {
              if (fallbackBlob) {
                resolve(fallbackBlob);
              } else {
                reject(new Error("画像のBlob生成に失敗しました。"));
              }
            },
            "image/jpeg",
            quality
          );
        }
      },
      preferredFormat,
      quality
    );
  });
}
