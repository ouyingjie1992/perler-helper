// 拼豆颜色单元格
export interface PerlerCell {
  row: number;
  col: number;
  colorCode: string;  // 颜色编码，如 "001", "A01"
  colorHex: string;   // 十六进制颜色值
}

// 颜色统计信息
export interface ColorStat {
  colorCode: string;
  colorHex: string;
  count: number;
  cells: Array<{ row: number; col: number }>;
}

// 拼豆图纸数据
export interface PerlerBoard {
  id: string;
  name: string;
  rows: number;
  cols: number;
  cells: PerlerCell[];
  colorStats: ColorStat[];
  imageDataUrl?: string; // 原始图片
}

// 5x5 分块信息
export interface GridBlock {
  blockRow: number;  // 第几行分块 (0-indexed)
  blockCol: number;  // 第几列分块 (0-indexed)
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// 应用视图模式
export type ViewMode = 'board' | 'upload';

// 工具页面类型（预留扩展）
export type ToolPage = 
  | 'board-helper'      // 图纸辅助器（当前功能）
  | 'photo-to-pixel'    // 照片转像素图（未来功能）
  | 'pixel-to-board'    // 像素图转拼豆图纸（未来功能）
  | 'color-palette';    // 拼豆色卡维护（未来功能）

export interface AppState {
  currentPage: ToolPage;
  board: PerlerBoard | null;
  selectedColorCode: string | null;
  highlightMode: boolean;
  cellSize: number;
  showGrid: boolean;
}
