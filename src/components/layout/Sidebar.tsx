import React from 'react';
import { useBoardStore } from '../../store/boardStore';
import type { ToolPage } from '../../types';
import styles from './Sidebar.module.css';

const NAV_ITEMS: Array<{ page: ToolPage; icon: string; label: string; available: boolean }> = [
  { page: 'board-helper', icon: '⊞', label: '图纸辅助', available: true },
  { page: 'photo-to-pixel', icon: '⊡', label: '照片转像素', available: false },
  { page: 'pixel-to-board', icon: '⊟', label: '像素转图纸', available: false },
  { page: 'color-palette', icon: '⊕', label: '色卡管理', available: false },
];

export const Sidebar: React.FC = () => {
  const { currentPage, setCurrentPage } = useBoardStore();

  return (
    <nav className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>⬡</span>
        <span className={styles.logoText}>拼豆助手</span>
      </div>

      <div className={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            className={`${styles.navItem} ${currentPage === item.page ? styles.active : ''} ${!item.available ? styles.disabled : ''}`}
            onClick={() => item.available && setCurrentPage(item.page)}
            title={!item.available ? '即将推出' : item.label}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
            {!item.available && <span className={styles.soon}>soon</span>}
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.version}>v1.0</span>
      </div>
    </nav>
  );
};
