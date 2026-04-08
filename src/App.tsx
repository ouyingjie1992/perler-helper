import React from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { UploadPanel } from './components/upload/UploadPanel';
import { BoardView } from './components/layout/BoardView';
import { useBoardStore } from './store/boardStore';
import styles from './App.module.css';

function App() {
  const { board, currentPage, focusMode } = useBoardStore();

  const renderContent = () => {
    switch (currentPage) {
      case 'board-helper':
        return board ? <BoardView /> : <UploadPanel />;
      default:
        return (
          <div className={styles.comingSoon}>
            <div className={styles.comingSoonIcon}>🚧</div>
            <h2>即将推出</h2>
            <p>该功能正在开发中，敬请期待</p>
          </div>
        );
    }
  };

  return (
    <div className={styles.app}>
      {!focusMode && <Sidebar />}
      <div className={styles.content}>
        <Header />
        <main className={styles.main}>
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default App;
