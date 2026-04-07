import express from 'express';
import cors from 'cors';
import { detectGridRouter } from './routes/detectGrid.js';
import { parseImageRouter } from './routes/parseImage.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// 允许来自 Vite 开发服务器的跨域请求
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

// base64 图片可能达到 20MB，需放大请求体限制
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req: import('express').Request, res: import('express').Response) => res.json({ status: 'ok' }));

app.use('/api/detect-grid', detectGridRouter);
app.use('/api/parse-image', parseImageRouter);

app.listen(PORT, () => {
  console.log(`[perler-server] 启动成功 → http://localhost:${PORT}`);
});
