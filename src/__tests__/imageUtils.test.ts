import { describe, it, expect } from "vitest";
import { calculateDimensions } from "../lib/imageUtils";

describe("imageUtils.ts - 画像リサイズ計算ロジック", () => {
  it("最大長辺（1280px）以内の画像はリサイズせずそのままの解像度を維持すること", () => {
    const result = calculateDimensions(800, 600, 1280);
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it("横長画像（例: 1920x1080）を最大長辺1280pxにアスペクト比を維持して縮小すること", () => {
    const result = calculateDimensions(1920, 1080, 1280);
    expect(result.width).toBe(1280);
    // 1080 * (1280 / 1920) = 720
    expect(result.height).toBe(720);
  });

  it("縦長画像（スマートフォンのカメラ写真 1080x1920）を最大長辺1280pxに縮小すること", () => {
    const result = calculateDimensions(1080, 1920, 1280);
    expect(result.height).toBe(1280);
    // 1080 * (1280 / 1920) = 720
    expect(result.width).toBe(720);
  });

  it("正方形画像（2000x2000）を1280x1280に縮小すること", () => {
    const result = calculateDimensions(2000, 2000, 1280);
    expect(result).toEqual({ width: 1280, height: 1280 });
  });

  it("不正または0の寸法が渡された場合は 0x0 を返すこと（境界値テスト）", () => {
    expect(calculateDimensions(0, 1080, 1280)).toEqual({ width: 0, height: 0 });
    expect(calculateDimensions(-100, 1080, 1280)).toEqual({ width: 0, height: 0 });
    expect(calculateDimensions(1920, 1080, 0)).toEqual({ width: 0, height: 0 });
  });
});
