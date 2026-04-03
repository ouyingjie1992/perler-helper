import React from 'react';
import { useBoardStore } from '../../store/boardStore';
import styles from './Header.module.css';

const PAGE_TITLES: Record<string, string> = {
  'board-helper': '图纸辅助器',
  'photo-to-pixel': '照片转像素图',
  'pixel-to-board': '像素图转图纸',
  'color-palette': '色卡管理',
};

export const Header: React.FC = () => {
  const { currentPage, board } = useBoardStore();

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{PAGE_TITLES[currentPage] ?? '拼豆助手'}</h1>
      {board && (
        <div className={styles.boardInfo}>
          <span className={styles.infoTag}>{board.cols} × {board.rows} 格</span>
          <span className={styles.infoTag}>{board.colorStats.length} 种颜色</span>
          <span className={styles.infoTag}>
            {board.cells.length} 颗
          </span>
        </div>
      )}
    </header>
  );
};
