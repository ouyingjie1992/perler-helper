import React from 'react';
import { BoardCanvas } from '../board/BoardCanvas';
import { ColorLegend } from '../legend/ColorLegend';
import { useBoardStore } from '../../store/boardStore';
import styles from './BoardView.module.css';

export const BoardView: React.FC = () => {
  const board = useBoardStore((s) => s.board)!;

  return (
    <div className={styles.boardView}>
      {/* 主画布区：position:relative，供底部抽屉 absolute 定位 */}
      <div className={styles.main}>
        <BoardCanvas board={board} />
        <ColorLegend colorStats={board.colorStats} />
      </div>
    </div>
  );
};
