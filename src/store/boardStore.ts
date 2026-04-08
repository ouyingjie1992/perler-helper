import { create } from 'zustand';
import type { PerlerBoard, ToolPage } from '../types';

// ─── 提示色码条目 ─────────────────────────────────────────────────────────────
/** 用户填写的单个颜色提示：色码 + 可选数量 */
export interface HintItem {
  code: string;
  count?: number;
}

// ─── Undo/Redo 快照 ───────────────────────────────────────────────────────────
export interface BoardSnapshot {
  board: PerlerBoard;
  /** 快照描述，用于历史记录面板展示 */
  label: string;
}

const MAX_HISTORY = 50;

// ─── Store 接口 ───────────────────────────────────────────────────────────────
interface BoardStore {
  currentPage: ToolPage;
  setCurrentPage: (page: ToolPage) => void;

  board: PerlerBoard | null;
  /** 直接设置 board（不推历史栈，用于首次加载/重置） */
  setBoard: (board: PerlerBoard | null) => void;
  /** 设置 board 并推入历史栈（用于用户有意义的变更） */
  commitBoard: (board: PerlerBoard, label: string) => void;

  // ── Undo / Redo ────────────────────────────────────────────────────────
  past: BoardSnapshot[];
  future: BoardSnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  /** 当前状态描述 */
  currentLabel: string;
  undo: () => void;
  redo: () => void;
  /** 清空历史（重新上传时调用） */
  clearHistory: () => void;

  // ── 当前已保存项目的 id（null 表示尚未保存） ──────────────────────────
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  // ── hintItems ──────────────────────────────────────────────────────────
  hintItems: HintItem[];
  setHintItems: (items: HintItem[]) => void;
  toggleHintCode: (code: string) => void;
  setHintCount: (code: string, count: number | undefined) => void;

  /**
   * 把图纸中 oldCode 的所有格子替换为 newCode + newHex，
   * 同时合并/更新 colorStats，并推入历史栈。
   */
  replaceColor: (oldCode: string, newCode: string, newHex: string) => void;

  /**
   * 将图纸顺时针旋转 90 度，并推入历史栈。
   * 旋转规则：新格子 (c, rows-1-r) ← 旧格子 (r, c)
   */
  rotateBoard: () => void;

  selectedColorCode: string | null;
  setSelectedColorCode: (code: string | null) => void;
  toggleSelectedColor: (code: string) => void;

  /** 当前正在编辑（修正色码）的格子色码，null 表示未打开编辑弹窗 */
  editingColorCode: string | null;
  setEditingColorCode: (code: string | null) => void;

  /** 专注模式：隐藏所有干扰元素，只留图纸 + 色块切换 */
  focusMode: boolean;
  toggleFocusMode: () => void;

  cellSize: number;
  setCellSize: (size: number) => void;
  showGrid: boolean;
  toggleGrid: () => void;
}

// ─── Store 实现 ───────────────────────────────────────────────────────────────
export const useBoardStore = create<BoardStore>((set, get) => ({
  currentPage: 'board-helper',
  setCurrentPage: (page) => set({ currentPage: page }),

  // ── board ──────────────────────────────────────────────────────────────
  board: null,
  setBoard: (board) => set({ board, selectedColorCode: null }),

  commitBoard: (board, label) => {
    const { board: prev, past, currentLabel } = get();
    const newPast: BoardSnapshot[] = prev
      ? [...past, { board: prev, label: currentLabel }].slice(-MAX_HISTORY)
      : past;
    set({
      board,
      past: newPast,
      future: [],
      canUndo: newPast.length > 0,
      canRedo: false,
      currentLabel: label,
    });
  },

  // ── Undo / Redo ────────────────────────────────────────────────────────
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  currentLabel: '',

  undo: () => {
    const { past, board, future, currentLabel } = get();
    if (past.length === 0 || !board) return;
    const prev = past[past.length - 1];
    const newPast = past.slice(0, -1);
    const newFuture: BoardSnapshot[] = [{ board, label: currentLabel }, ...future];
    set({
      board: prev.board,
      past: newPast,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
      currentLabel: prev.label,
      selectedColorCode: null,
    });
  },

  redo: () => {
    const { future, board, past, currentLabel } = get();
    if (future.length === 0 || !board) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const newPast: BoardSnapshot[] = [...past, { board, label: currentLabel }];
    set({
      board: next.board,
      past: newPast,
      future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
      currentLabel: next.label,
      selectedColorCode: null,
    });
  },

  clearHistory: () =>
    set({ past: [], future: [], canUndo: false, canRedo: false, currentLabel: '' }),

  // ── 当前已保存项目 id ──────────────────────────────────────────────────
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  // ── hintItems ──────────────────────────────────────────────────────────
  hintItems: [],
  setHintItems: (items) => set({ hintItems: items }),
  toggleHintCode: (code) => {
    const { hintItems } = get();
    const exists = hintItems.some((h) => h.code === code);
    set({
      hintItems: exists
        ? hintItems.filter((h) => h.code !== code)
        : [...hintItems, { code }],
    });
  },
  setHintCount: (code, count) => {
    const { hintItems } = get();
    set({
      hintItems: hintItems.map((h) =>
        h.code === code ? { ...h, count } : h
      ),
    });
  },

  // ── replaceColor（推历史栈） ───────────────────────────────────────────
  replaceColor: (oldCode, newCode, newHex) => {
    const board = get().board;
    if (!board) return;

    const newCells = board.cells.map((cell) =>
      cell.colorCode === oldCode
        ? { ...cell, colorCode: newCode, colorHex: newHex }
        : cell
    );

    const statsMap = new Map(board.colorStats.map((s) => [s.colorCode, { ...s }]));
    const oldStat = statsMap.get(oldCode);
    if (!oldStat) return;

    statsMap.delete(oldCode);
    if (statsMap.has(newCode)) {
      const existing = statsMap.get(newCode)!;
      existing.count += oldStat.count;
      existing.cells = [...existing.cells, ...oldStat.cells];
    } else {
      statsMap.set(newCode, {
        colorCode: newCode,
        colorHex: newHex,
        count: oldStat.count,
        cells: oldStat.cells,
      });
    }

    const newStats = Array.from(statsMap.values()).sort((a, b) => b.count - a.count);
    const newBoard = { ...board, cells: newCells, colorStats: newStats };

    const selected = get().selectedColorCode;
    get().commitBoard(newBoard, `修正 ${oldCode} → ${newCode}`);
    set({ selectedColorCode: selected === oldCode ? newCode : selected });
  },

  // ── rotateBoard（顺时针 90°，推历史栈） ───────────────────────────────
  rotateBoard: () => {
    const board = get().board;
    if (!board) return;

    const { rows, cols, cells, colorStats } = board;
    // 旋转后新尺寸：宽高互换
    const newRows = cols;
    const newCols = rows;

    // 顺时针 90°：(r, c) → (c, rows-1-r)
    const newCells = cells.map((cell) => ({
      ...cell,
      row: cell.col,
      col: rows - 1 - cell.row,
    }));

    // colorStats 中的 cells 坐标也要更新
    const newStats = colorStats.map((stat) => ({
      ...stat,
      cells: stat.cells.map(({ row, col }) => ({
        row: col,
        col: rows - 1 - row,
      })),
    }));

    const newBoard: typeof board = {
      ...board,
      rows: newRows,
      cols: newCols,
      cells: newCells,
      colorStats: newStats,
      // 旋转后 margin 和 imageDataUrl 失效，清除 overlay 相关数据避免错位
      margin: undefined,
      imageDataUrl: undefined,
    };

    get().commitBoard(newBoard, '顺时针旋转 90°');
  },

  // ── 高亮 ───────────────────────────────────────────────────────────────
  selectedColorCode: null,
  setSelectedColorCode: (code) => set({ selectedColorCode: code }),
  toggleSelectedColor: (code) => {
    const current = get().selectedColorCode;
    set({ selectedColorCode: current === code ? null : code });
  },

  // ── 编辑弹窗 ───────────────────────────────────────────────────────────
  editingColorCode: null,
  setEditingColorCode: (code) => set({ editingColorCode: code }),

  // ── 专注模式 ───────────────────────────────────────────────────────────
  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  // ── 视图设置 ───────────────────────────────────────────────────────────
  cellSize: 20,
  setCellSize: (size) => set({ cellSize: Math.max(8, Math.min(60, size)) }),
  showGrid: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
}));
