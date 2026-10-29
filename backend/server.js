'use strict';

// Standalone regular-video API. Render currently starts the ROOT ../server.js instead.
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { fal } = require('@fal-ai/client');

const app = express();
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 8788);
const jobs = new Map();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' }));
if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

function failMessage(error) { return String(error?.message || error || 'Unknown error').slice(0, 800); }
async function generate(input) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured.');
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('A prompt is required.');
  const imageUrl = input.imageUrl || input.image_url || null;
  const model = imageUrl ? 'fal-ai/wan/v2.7/image-to-video' : 'fal-ai/wan/v2.7/text-to-video';
  const result = await fal.subscribe(model, { input: imageUrl ? { prompt, image_url: imageUrl, duration: '5' } : { prompt, duration: '5' }, logs: false });
  const videoUrl = result?.data?.video?.url || result?.video?.url || result?.data?.videos?.[0]?.url;
  if (!videoUrl) throw new Error(`The model ${model} did not return a video URL.`);
  return videoUrl;
}
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'vyra-ai-standalone-backend', falConfigured: Boolean(process.env.FAL_KEY) }));
app.post('/api/generate', (req, res) => {
  const id = crypto.randomUUID();
  const job = { id, status: 'queued', progress: 0, createdAt: new Date().toISOString() };
  jobs.set(id, job);
  setImmediate(async () => {
    job.status = 'processing';
    try { job.videoUrl = await generate(req.body || {}); job.status = 'completed'; job.progress = 100; }
    catch (error) { job.status = 'failed'; job.error = failMessage(error); }
  });
  res.status(202).json({ jobId: id, id, status: job.status });
});
app.get('/api/generate/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found. In-memory jobs are cleared when the server restarts.' });
  res.json({ ...job, url: job.videoUrl || null, videoUrl: job.videoUrl || null });
});
app.get('/', (_req, res) => res.json({ name: 'VYRA AI standalone backend', health: '/api/health' }));
app.listen(PORT, '0.0.0.0', () => console.log(`[VYRA backend] Listening on ${PORT}`));
