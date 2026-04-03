import { create } from 'zustand';
import type { PerlerBoard, ToolPage } from '../types';

interface BoardStore {
  currentPage: ToolPage;
  setCurrentPage: (page: ToolPage) => void;

  board: PerlerBoard | null;
  setBoard: (board: PerlerBoard | null) => void;

  /**
   * 把图纸中 oldCode 的所有格子替换为 newCode + newHex，
   * 同时合并/更新 colorStats。
   */
  replaceColor: (oldCode: string, newCode: string, newHex: string) => void;

  selectedColorCode: string | null;
  setSelectedColorCode: (code: string | null) => void;
  toggleSelectedColor: (code: string) => void;

  cellSize: number;
  setCellSize: (size: number) => void;
  showGrid: boolean;
  toggleGrid: () => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  currentPage: 'board-helper',
  setCurrentPage: (page) => set({ currentPage: page }),

  board: null,
  setBoard: (board) => set({ board, selectedColorCode: null }),

  replaceColor: (oldCode, newCode, newHex) => {
    const board = get().board;
    if (!board) return;

    // 更新所有格子
    const newCells = board.cells.map((cell) =>
      cell.colorCode === oldCode
        ? { ...cell, colorCode: newCode, colorHex: newHex }
        : cell
    );

    // 重建 colorStats：先删掉 oldCode，再合并到 newCode
    const statsMap = new Map(board.colorStats.map((s) => [s.colorCode, { ...s }]));

    const oldStat = statsMap.get(oldCode);
    if (!oldStat) return;

    statsMap.delete(oldCode);

    if (statsMap.has(newCode)) {
      // newCode 已存在，合并数量和 cells
      const existing = statsMap.get(newCode)!;
      existing.count += oldStat.count;
      existing.cells = [...existing.cells, ...oldStat.cells];
    } else {
      // newCode 不存在，新增
      statsMap.set(newCode, {
        colorCode: newCode,
        colorHex: newHex,
        count: oldStat.count,
        cells: oldStat.cells,
      });
    }

    const newStats = Array.from(statsMap.values()).sort((a, b) => b.count - a.count);

    // 如果当前高亮的就是 oldCode，跟着更新
    const selected = get().selectedColorCode;

    set({
      board: { ...board, cells: newCells, colorStats: newStats },
      selectedColorCode: selected === oldCode ? newCode : selected,
    });
  },

  selectedColorCode: null,
  setSelectedColorCode: (code) => set({ selectedColorCode: code }),
  toggleSelectedColor: (code) => {
    const current = get().selectedColorCode;
    set({ selectedColorCode: current === code ? null : code });
  },

  cellSize: 20,
  setCellSize: (size) => set({ cellSize: Math.max(8, Math.min(60, size)) }),
  showGrid: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
}));
