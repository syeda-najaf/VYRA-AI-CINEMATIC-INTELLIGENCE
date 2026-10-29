'use strict';

// VYRA AI API: regular video generation + Talking Fruits Comedy.
// Keep secrets in .env locally and Render environment variables in production.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { fal } = require('@fal-ai/client');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const OUTPUT_DIR = process.env.VYRA_STORAGE_DIR || path.join(os.tmpdir(), 'vyra-generated-videos');
const jobs = new Map();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '15mb' }));
app.use('/generated-videos', express.static(OUTPUT_DIR, { maxAge: '1h' }));

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}
function safeError(error) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  return message.slice(0, 900);
}
function ensureConfig() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is missing from the backend environment. Add it to Render Environment Variables.');
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg-static is not installed or unavailable on this platform.'));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-1800)}`)));
  });
}
async function downloadToFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download media (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Downloaded media was empty.');
  await fs.writeFile(destination, buffer);
}
async function elevenLabsSpeech(text, voiceId, outputPath, language = 'Hindi') {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is missing from the backend environment.');
  if (!voiceId) throw new Error('Voice ID is missing. Configure ELEVENLABS_MANGO_VOICE_ID and ELEVENLABS_STRAWBERRY_VOICE_ID in Render.');
  if (!String(text || '').trim()) throw new Error('Speech text cannot be empty.');
  try {
    const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    const options = {
      text: String(text),
      modelId: 'eleven_v4',
      outputFormat: 'mp3_44100_128',
      voiceSettings: { stability: 0.42, similarityBoost: 0.78 }
    };
    if (language === 'Hindi') options.languageCode = 'hi';
    if (language === 'Urdu') options.languageCode = 'ur';
    const stream = await client.textToSpeech.convert(voiceId, options);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('ElevenLabs returned empty audio.');
    await fs.writeFile(outputPath, audio);
  } catch (error) {
    const status = error?.statusCode || error?.status || '';
    console.error('[VYRA] ElevenLabs error:', status, error?.message || error);
    if (String(status) === '401') throw new Error('ElevenLabs rejected the API key (HTTP 401). Create/verify a valid API key and update ELEVENLABS_API_KEY in Render.');
    throw new Error(`ElevenLabs speech generation failed${status ? ` (HTTP ${status})` : ''}: ${safeError(error)}`);
  }
}
async function falVideo(prompt, imageUrl, options = {}) {
  ensureConfig();
  const model = imageUrl ? 'fal-ai/wan/v2.7/image-to-video' : 'fal-ai/wan/v2.7/text-to-video';
  const allowedRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
  const ratio = allowedRatios.includes(options.aspectRatio) ? options.aspectRatio : '16:9';
  const duration = Math.max(2, Math.min(15, Math.round(Number(options.duration) || 5)));
  const resolution = options.resolution === '1080p' ? '1080p' : '720p';
  const input = {
    prompt: String(prompt).slice(0, 5000),
    duration,
    resolution,
    enable_prompt_expansion: true,
    negative_prompt: 'blurry, flicker, distorted anatomy, duplicate objects, unreadable text, low quality'
  };
  if (imageUrl) input.image_url = imageUrl;
  else input.aspect_ratio = ratio;
  try {
    const result = await fal.subscribe(model, { input, logs: false });
    const url = result?.data?.video?.url || result?.video?.url || result?.data?.videos?.[0]?.url;
    if (!url) throw new Error(`Video model ${model} returned no video URL.`);
    return url;
  } catch (error) {
    const status = error?.status || error?.statusCode || error?.response?.status || '';
    const detail = safeError(error);
    if (String(status) === '401' || String(status) === '403' || /forbidden|unauthorized|insufficient credits|billing/i.test(detail)) {
      throw new Error(`fal.ai denied this generation${status ? ` (HTTP ${status})` : ''}. Verify FAL_KEY, model access, account billing and available credits in fal.ai. Provider detail: ${detail}`);
    }
    throw new Error(`fal.ai video generation failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
  }
}
async function createTalkingFruitScene({ scene, voiceId, language, workDir, index }) {
  const audioPath = path.join(workDir, `dialogue-${index}.mp3`);
  const videoPath = path.join(workDir, `scene-${index}.mp4`);
  await elevenLabsSpeech(scene.dialogue, voiceId, audioPath, language);

  // WAN text-to-video does not reliably accept an audio_url input. Generate the scene first,
  // then combine the narration with the video locally to avoid silently dropping the speech.
  const prompt = `${scene.prompt}. Animated anthropomorphic fruit characters, expressive face, visible mouth, cinematic comedy, polished 3D animation, stable character design, no text, no subtitles.`;
  const videoUrl = await falVideo(prompt, null);
  const rawVideo = path.join(workDir, `raw-${index}.mp4`);
  await downloadToFile(videoUrl, rawVideo);
  await runFfmpeg([
    '-y', '-i', rawVideo, '-i', audioPath,
    '-filter_complex', '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24[v]',
    '-map', '[v]', '-map', '1:a:0', '-t', '15', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', videoPath
  ]);
  return videoPath;
}
async function generateTalkingFruits(job, req) {
  ensureConfig();
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('Talking Fruits requires ELEVENLABS_API_KEY.');
  const mangoVoice = process.env.ELEVENLABS_MANGO_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;
  const strawberryVoice = process.env.ELEVENLABS_STRAWBERRY_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;
  if (!mangoVoice || !strawberryVoice) throw new Error('Set ELEVENLABS_MANGO_VOICE_ID and ELEVENLABS_STRAWBERRY_VOICE_ID in the backend environment.');
  const language = ['Hindi', 'Urdu'].includes(job.input.language) ? job.input.language : 'Hindi';
  const scenes = [
    { speaker: 'mango', dialogue: 'Market ka asli king main hoon! Aam ka season aata hai toh sab mere peeche line lagate hain.', prompt: 'A proud golden mango king wearing a tiny royal crown enters a colorful Indian fruit market with dramatic hero lighting.' },
    { speaker: 'strawberry', dialogue: 'King? Please! Main Strawberry Queen hoon. Cute bhi, classy bhi, aur tumse zyada premium bhi!', prompt: 'A confident red strawberry queen with a small sparkling crown poses in a colorful fruit market, playful expression.' },
    { speaker: 'mango', dialogue: 'Premium hone se kya hota hai? Mere bina aam panna, mango shake aur aamras kaun banayega?', prompt: 'The golden mango king gestures dramatically beside mango shake glasses and aamras bowls, funny animated reactions.' },
    { speaker: 'strawberry', dialogue: 'Aur mere bina cake, smoothie aur dessert ki party boring! Chalo, market decide karega. Like karo apne favourite ko!', prompt: 'The strawberry queen and mango king argue playfully, then turn to camera and invite the audience to vote, bright cinematic ending.' }
  ];
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vyra-fruits-'));
  try {
    const clips = [];
    for (let i = 0; i < scenes.length; i++) {
      job.progress = Math.round((i / scenes.length) * 85);
      job.message = `Creating scene ${i + 1} of ${scenes.length}`;
      const scene = scenes[i];
      const clip = await createTalkingFruitScene({
        scene,
        voiceId: scene.speaker === 'mango' ? mangoVoice : strawberryVoice,
        language,
        workDir,
        index: i + 1
      });
      clips.push(clip);
    }
    const listPath = path.join(workDir, 'concat.txt');
    await fs.writeFile(listPath, clips.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outputName = `${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', outputPath]);
    job.videoUrl = `${publicBaseUrl(req)}/generated-videos/${outputName}`;
    job.progress = 100;
    job.status = 'completed';
    job.message = 'Talking Fruits video is ready. Note: this version mixes dialogue audio but does not guarantee frame-accurate lip-sync.';
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
async function processRegularVideo(job, req) {
  const prompt = String(job.input.prompt || '').trim();
  if (!prompt) throw new Error('Please provide a video prompt.');
  const imageUrl = job.input.imageData || job.input.imageUrl || job.input.image_url || null;
  const style = String(job.input.style || '').trim();
  const adDetails = job.input.adMode
    ? ` Commercial video. Brand: ${String(job.input.brandName || '').slice(0, 100)}. Product: ${String(job.input.productName || '').slice(0, 150)}. Call to action: ${String(job.input.callToAction || '').slice(0, 150)}.`
    : '';
  const finalPrompt = `${prompt}${style ? `. Visual style: ${style}.` : ''}${adDetails}`;
  const url = await falVideo(finalPrompt, imageUrl, {
    duration: job.input.duration,
    aspectRatio: job.input.aspectRatio,
    resolution: job.input.resolution || '720p'
  });
  job.videoUrl = url;
  job.progress = 100;
  job.status = 'completed';
  job.message = 'Video generation completed.';
}
function startJob(req, input) {
  const id = crypto.randomUUID();
  const job = { id, status: 'queued', progress: 0, message: 'Queued', createdAt: new Date().toISOString(), input };
  jobs.set(id, job);
  setImmediate(async () => {
    job.status = 'processing';
    try {
      if (input.mode === 'talking-fruits' || input.mode === 'talking_fruits' || input.type === 'talking-fruits') await generateTalkingFruits(job, req);
      else await processRegularVideo(job, req);
    } catch (error) {
      job.status = 'failed';
      job.error = safeError(error);
      job.message = job.error;
      console.error(`[VYRA] Job ${id} failed:`, job.error);
    }
  });
  return job;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'vyra-ai-api',
    mode: process.env.VYRA_MODE || 'production',
    speechConfigured: Boolean(process.env.ELEVENLABS_API_KEY && (process.env.ELEVENLABS_MANGO_VOICE_ID || process.env.ELEVENLABS_VOICE_ID)),
    falConfigured: Boolean(process.env.FAL_KEY),
    ffmpegAvailable: Boolean(ffmpegPath),
    time: new Date().toISOString()
  });
});
app.post('/api/generate', (req, res) => {
  const body = req.body || {};
  const mode = body.mode || body.type || 'text-to-video';
  if (!['talking-fruits', 'talking_fruits'].includes(mode) && !String(body.prompt || '').trim()) {
    return res.status(400).json({ error: 'A prompt is required.' });
  }
  const requestedDuration = Number(body.duration || 5);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 2 || requestedDuration > 15) {
    if (!['talking-fruits', 'talking_fruits'].includes(mode)) {
      return res.status(400).json({ error: 'Choose a clip duration between 2 and 15 seconds.' });
    }
  }
  const job = startJob(req, { ...body, mode });
  res.status(202).json({ jobId: job.id, id: job.id, status: job.status, message: job.message });
});
app.get('/api/generate/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found. Jobs are stored in memory and may disappear after a server restart.' });
  res.json({ jobId: job.id, id: job.id, status: job.status, progress: job.progress, message: job.message, videoUrl: job.videoUrl || null, url: job.videoUrl || null, error: job.error || null, createdAt: job.createdAt });
});
app.get('/api/videos/:id', async (req, res) => {
  const id = path.basename(req.params.id);
  const file = path.join(OUTPUT_DIR, id.endsWith('.mp4') ? id : `${id}.mp4`);
  try { await fs.access(file); return res.sendFile(file); }
  catch { return res.status(404).json({ error: 'Video file not found.' }); }
});
app.get('/', (_req, res) => res.json({ name: 'VYRA AI API', health: '/api/health' }));
app.use((error, _req, res, _next) => {
  console.error('[VYRA] Request error:', error);
  res.status(500).json({ error: safeError(error) });
});

app.listen(PORT, '0.0.0.0', () => console.log(`[VYRA] API listening on port ${PORT}`));
