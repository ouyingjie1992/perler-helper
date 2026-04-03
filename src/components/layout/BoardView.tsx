import React from 'react';
import { BoardCanvas } from '../board/BoardCanvas';
import { ColorLegend } from '../legend/ColorLegend';
import { useBoardStore } from '../../store/boardStore';
import styles from './BoardView.module.css';

export const BoardView: React.FC = () => {
  const board = useBoardStore((s) => s.board)!;

  return (
    <div className={styles.boardView}>
      <div className={styles.main}>
        <BoardCanvas board={board} />
      </div>
      <ColorLegend colorStats={board.colorStats} />
    </div>
  );
};
