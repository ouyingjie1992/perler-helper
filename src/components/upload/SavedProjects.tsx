/**
 * SavedProjects.tsx
 * 显示 IndexedDB 中保存的图纸项目列表。
 * 放在 UploadPanel 下方，供用户加载历史项目继续二次调优。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useBoardStore } from '../../store/boardStore';
import {
  listProjects,
  deleteProject,
  formatProjectTime,
  type SavedProject,
} from '../../utils/projectStorage';
import styles from './SavedProjects.module.css';

export const SavedProjects: React.FC = () => {
  const { setBoard, setHintItems, setCurrentProjectId, clearHistory, commitBoard } = useBoardStore();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await listProjects());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 加载项目
  const handleLoad = (proj: SavedProject) => {
    clearHistory();
    setBoard(proj.board);
    setHintItems(proj.hintItems ?? []);
    setCurrentProjectId(proj.id);
    // 把初始状态作为第一个历史快照
    commitBoard(proj.board, `加载「${proj.name}」`);
  };

  // 删除项目
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确认删除「${name}」？此操作不可恢复。`)) return;
    setDeletingId(id);
    try {
      await deleteProject(id);
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <p className={styles.empty}>加载中…</p>;
  if (projects.length === 0) return null; // 没有历史项目时不显示区块

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>已保存的图纸</h3>
      <ul className={styles.list}>
        {projects.map((proj) => (
          <li key={proj.id} className={styles.item}>
            {/* 缩略图 */}
            <div className={styles.thumb}>
              {proj.thumbnailDataUrl
                ? <img src={proj.thumbnailDataUrl} alt={proj.name} className={styles.thumbImg} />
                : <span className={styles.thumbPlaceholder}>图</span>
              }
            </div>

            {/* 信息 */}
            <div className={styles.info}>
              <span className={styles.name}>{proj.name}</span>
              <span className={styles.meta}>
                {proj.board.cols}×{proj.board.rows} &middot; {proj.board.colorStats.length} 色 &middot; 保存于 {formatProjectTime(proj.updatedAt)}
              </span>
            </div>

            {/* 操作 */}
            <div className={styles.btns}>
              <button
                className={styles.loadBtn}
                onClick={() => handleLoad(proj)}
                title="加载此项目继续调优"
              >
                加载
              </button>
              <button
                className={styles.delBtn}
                disabled={deletingId === proj.id}
                onClick={() => handleDelete(proj.id, proj.name)}
                title="删除此项目"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
