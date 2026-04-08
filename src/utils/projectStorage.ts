/**
 * projectStorage.ts
 *
 * 使用 idb-keyval 将图纸项目持久化到 IndexedDB。
 * 每条记录保存：
 *   - 原始图片（imageDataUrl）
 *   - 当前 board 数据（colorStats + cells）
 *   - 用户填写的 hintItems
 *   - 名称、时间戳、缩略图（canvas 缩略）
 *
 * IndexedDB store 名称：perler-projects
 * Key 格式：项目 id（nanoid 风格的时间戳字符串）
 */

import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore } from 'idb-keyval';
import type { PerlerBoard } from '../types';
import type { HintItem } from '../store/boardStore';

// 自定义 store（隔离命名空间）
const projectStore = createStore('perler-helper', 'projects');

// ─── 数据结构 ─────────────────────────────────────────────────────────────────

export interface SavedProject {
  id: string;
  /** 用户可编辑的项目名称 */
  name: string;
  /** 保存时间（ISO 字符串） */
  savedAt: string;
  /** 最后修改时间（ISO 字符串） */
  updatedAt: string;
  /** 原始图片 dataUrl（首次解析时的原图，保存一次，不随修改变化） */
  originalImageDataUrl: string;
  /** 当前（最新）board 数据 */
  board: PerlerBoard;
  /** 用户填写的 hintItems */
  hintItems: HintItem[];
  /** 缩略图 dataUrl（约 120×120，用于列表预览） */
  thumbnailDataUrl?: string;
}

// ─── 缩略图生成 ───────────────────────────────────────────────────────────────

/**
 * 把 board 渲染为小缩略图（纯色格子，不依赖 Canvas 组件）
 * 如果浏览器不支持 OffscreenCanvas，则降级返回 undefined。
 */
export function generateThumbnail(board: PerlerBoard, size = 120): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const cellW = size / board.cols;
    const cellH = size / board.rows;

    for (const cell of board.cells) {
      ctx.fillStyle = cell.colorHex;
      ctx.fillRect(
        cell.col * cellW,
        cell.row * cellH,
        Math.ceil(cellW),
        Math.ceil(cellH),
      );
    }

    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

// ─── CRUD 操作 ────────────────────────────────────────────────────────────────

/** 生成唯一 id */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 保存新项目（首次保存）。
 * 返回生成的项目 id。
 */
export async function saveNewProject(params: {
  name: string;
  board: PerlerBoard;
  hintItems: HintItem[];
  originalImageDataUrl: string;
}): Promise<string> {
  const id = genId();
  const now = new Date().toISOString();
  const thumbnail = generateThumbnail(params.board);

  const project: SavedProject = {
    id,
    name: params.name,
    savedAt: now,
    updatedAt: now,
    originalImageDataUrl: params.originalImageDataUrl,
    board: params.board,
    hintItems: params.hintItems,
    thumbnailDataUrl: thumbnail,
  };

  await idbSet(id, project, projectStore);
  return id;
}

/**
 * 覆盖更新已有项目（二次调优后保存）。
 */
export async function updateProject(
  id: string,
  updates: Partial<Pick<SavedProject, 'name' | 'board' | 'hintItems'>>,
): Promise<void> {
  const existing = await idbGet<SavedProject>(id, projectStore);
  if (!existing) throw new Error(`Project ${id} not found`);

  const updated: SavedProject = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    thumbnailDataUrl: updates.board
      ? generateThumbnail(updates.board)
      : existing.thumbnailDataUrl,
  };

  await idbSet(id, updated, projectStore);
}

/** 读取单个项目 */
export async function loadProject(id: string): Promise<SavedProject | undefined> {
  return idbGet<SavedProject>(id, projectStore);
}

/** 读取所有项目（按 updatedAt 倒序） */
export async function listProjects(): Promise<SavedProject[]> {
  const allKeys = await idbKeys<string>(projectStore);
  const projects = await Promise.all(
    allKeys.map((k) => idbGet<SavedProject>(k, projectStore)),
  );
  return (projects.filter(Boolean) as SavedProject[]).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/** 删除项目 */
export async function deleteProject(id: string): Promise<void> {
  await idbDel(id, projectStore);
}

/** 格式化时间为友好显示 */
export function formatProjectTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 7) return `${diffD} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
