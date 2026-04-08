import React, { useState, useCallback } from 'react';
import { useBoardStore } from '../../store/boardStore';
import {
  saveNewProject,
  updateProject,
} from '../../utils/projectStorage';
import styles from './Header.module.css';

const PAGE_TITLES: Record<string, string> = {
  'board-helper': '图纸辅助器',
  'photo-to-pixel': '照片转像素图',
  'pixel-to-board': '像素图转图纸',
  'color-palette': '色卡管理',
};

export const Header: React.FC = () => {
  const {
    currentPage,
    board,
    canUndo,
    canRedo,
    undo,
    redo,
    past,
    future,
    currentLabel,
    hintItems,
    currentProjectId,
    setCurrentProjectId,
    focusMode,
    toggleFocusMode,
  } = useBoardStore();

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ── 保存逻辑 ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!board) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const originalDataUrl = board.imageDataUrl ?? '';
      if (currentProjectId) {
        // 已有项目 → 覆盖更新
        await updateProject(currentProjectId, { board, hintItems });
        setSaveMsg('已更新');
      } else {
        // 新项目 → 询问名称（简单 prompt；后续可改为 Modal）
        const name = window.prompt('项目名称', board.name || `图纸 ${new Date().toLocaleDateString('zh-CN')}`);
        if (!name) { setSaving(false); return; }
        const id = await saveNewProject({ name, board, hintItems, originalImageDataUrl: originalDataUrl });
        setCurrentProjectId(id);
        setSaveMsg('已保存');
      }
    } catch (e) {
      setSaveMsg('保存失败');
      console.error(e);
    } finally {
      setSaving(false);
      // 2 秒后清除提示
      setTimeout(() => setSaveMsg(null), 2000);
    }
  }, [board, hintItems, currentProjectId, setCurrentProjectId]);

  // ── 快捷键 Ctrl+Z / Ctrl+Y ────────────────────────────────────────────
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // 输入框内不拦截
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        if (canRedo) redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (board) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canUndo, canRedo, undo, redo, board, handleSave]);

  return (
    <header className={`${styles.header} ${focusMode ? styles.headerFocus : ''}`}>
      {/* 专注模式时只显示退出按钮，其余全隐藏 */}
      {focusMode ? (
        <button
          className={styles.focusExitBtn}
          onClick={toggleFocusMode}
          title="退出专注模式"
        >
          <ExitFocusIcon /> 退出专注
        </button>
      ) : (
        <>
          <h1 className={styles.title}>{PAGE_TITLES[currentPage] ?? '拼豆助手'}</h1>

          {board && (
            <>
              {/* 图纸信息标签 */}
              <div className={styles.boardInfo}>
                <span className={styles.infoTag}>{board.cols} × {board.rows} 格</span>
                <span className={styles.infoTag}>{board.colorStats.length} 种颜色</span>
                <span className={styles.infoTag}>{board.cells.length} 颗</span>
              </div>

              {/* 操作按钮区 */}
              <div className={styles.actions}>
                {/* Undo */}
                <button
                  className={styles.iconBtn}
                  disabled={!canUndo}
                  onClick={undo}
                  title={`撤销${past.length > 0 ? `（${past[past.length - 1].label}）` : ''}  Ctrl+Z`}
                >
                  <UndoIcon />
                  {past.length > 0 && <span className={styles.historyCount}>{past.length}</span>}
                </button>

                {/* Redo */}
                <button
                  className={styles.iconBtn}
                  disabled={!canRedo}
                  onClick={redo}
                  title={`重做${future.length > 0 ? `（${future[0].label}）` : ''}  Ctrl+Y`}
                >
                  <RedoIcon />
                  {future.length > 0 && <span className={styles.historyCount}>{future.length}</span>}
                </button>

                <div className={styles.divider} />

                {/* 当前状态标签 */}
                {currentLabel && (
                  <span className={styles.currentLabel} title="当前状态">
                    {currentLabel}
                  </span>
                )}

                {/* 保存按钮 */}
                <button
                  className={`${styles.saveBtn} ${currentProjectId ? styles.saveBtnUpdate : styles.saveBtnNew}`}
                  onClick={handleSave}
                  disabled={saving}
                  title={`${currentProjectId ? '更新保存' : '保存项目'}  Ctrl+S`}
                >
                  {saving ? '保存中…' : saveMsg ? saveMsg : currentProjectId ? '更新保存' : '保存项目'}
                </button>

                <div className={styles.divider} />

                {/* 专注模式按钮 */}
                <button
                  className={styles.iconBtn}
                  onClick={toggleFocusMode}
                  title="进入专注模式（拼豆时隐藏干扰元素）"
                >
                  <FocusIcon />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </header>
  );
};

// ── 图标 SVG ─────────────────────────────────────────────────────────────────

const FocusIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 00-2 2v3" />
    <path d="M21 8V5a2 2 0 00-2-2h-3" />
    <path d="M3 16v3a2 2 0 002 2h3" />
    <path d="M16 21h3a2 2 0 002-2v-3" />
  </svg>
);

const ExitFocusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 01-2 2H3" />
    <path d="M21 8h-3a2 2 0 01-2-2V3" />
    <path d="M3 16h3a2 2 0 012 2v3" />
    <path d="M16 21v-3a2 2 0 012-2h3" />
  </svg>
);

const UndoIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
  </svg>
);

const RedoIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
  </svg>
);
