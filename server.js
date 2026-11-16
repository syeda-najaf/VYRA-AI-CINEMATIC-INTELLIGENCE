
'use strict';

// VYRA AI API v2
// Modes: text | photo | ad | talking-fruits.
// Providers: fal.ai, Hugging Face, ElevenLabs.
// Generation is disabled by default for safe, zero-cost development.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { fal } = require('@fal-ai/client');
const { createClient } = require('@supabase/supabase-js');
const shared = require('./shared');

const env = (k, d = '') =>
  process.env[k] === undefined ? d : String(process.env[k]).trim();

const PORT = Number(env('PORT', '8787'));
const OUTPUT_DIR =
  env('VYRA_STORAGE_DIR') ||
  path.join(os.tmpdir(), 'vyra-generated-videos');

const JOBS_FILE = path.join(OUTPUT_DIR, 'jobs.json');
const MAX_CONCURRENT = Math.max(1, Number(env('VYRA_MAX_CONCURRENT', '2')));
const RETENTION_DAYS = Number(env('VYRA_RETENTION_DAYS', '7'));

const ACCESS_CODES = env('VYRA_ACCESS_CODES')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CORS_ORIGINS = env('CORS_ORIGINS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const APP_URL = env('PUBLIC_APP_URL').replace(/\/+$/, '');
const ELEVEN_MODEL = env('ELEVENLABS_MODEL_ID', 'eleven_v4');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LIFETIME_VIDEO_TRIALS = 3;

const SUPABASE_URL = env('SUPABASE_URL', env('EXPO_PUBLIC_SUPABASE_URL'));
const SUPABASE_PUBLISHABLE_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
);
const SUPABASE_SECRET_KEY = env('SUPABASE_SECRET_KEY');

const supabaseAuth = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

const supabaseAdmin = SUPABASE_URL && SUPABASE_SECRET_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

// OFF unless explicitly enabled.
const GENERATION_ENABLED =
  env('VYRA_GENERATION_ENABLED', 'false').toLowerCase() === 'true';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

const jobs = new Map();
const queue = [];
let running = 0;

if (GENERATION_ENABLED && env('FAL_KEY')) {
  fal.config({ credentials: env('FAL_KEY') });
}

// ---------------------------------------------------------------- helpers

const safeError = (e) =>
  String((e && e.message) || e || 'Unknown error').slice(0, 900);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const baseUrl = (req) =>
  env('PUBLIC_API_URL').replace(/\/+$/, '') ||
  `${req.protocol}://${req.get('host')}`;

const caps = () => ({
  generation: GENERATION_ENABLED,
  text: GENERATION_ENABLED && Boolean(env('FAL_KEY') || env('HF_TOKEN')),
  photo: GENERATION_ENABLED && Boolean(env('FAL_KEY')),
  ad: GENERATION_ENABLED && Boolean(env('FAL_KEY') || env('HF_TOKEN')),
  talkingFruits:
    GENERATION_ENABLED &&
    Boolean(
      env('FAL_KEY') &&
      env('ELEVENLABS_API_KEY') &&
      (env('ELEVENLABS_MANGO_VOICE_ID') || env('ELEVENLABS_VOICE_ID')) &&
      ffmpegPath
    ),
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg is unavailable on this server.'));
    }

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';

    child.stderr.on('data', (c) => {
      err = (err + c).slice(-4000);
    });

    child.on('error', reject);

    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`FFmpeg exited ${code}: ${err.slice(-800)}`))
    );
  });
}

async function download(url, dest) {
  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Could not download media (HTTP ${r.status}).`);
  }

  const buf = Buffer.from(await r.arrayBuffer());

  if (!buf.length) {
    throw new Error('Downloaded media was empty.');
  }

  await fs.writeFile(dest, buf);
}

// ---------------------------------------------------------------- persistence

let saveTimer = null;

function persistJobs() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      const list = [...jobs.values()].map(({ input, ...rest }) => rest);

      await fs.writeFile(JOBS_FILE, JSON.stringify(list));
    } catch (e) {
      console.error('[VYRA] persist failed:', safeError(e));
    }
  }, 400);
}

async function loadJobs() {
  try {
    const list = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8'));

    for (const j of list) {
      if (j.status === 'queued' || j.status === 'processing') {
        j.status = 'failed';
        j.error =
          'The server restarted while this video was being made. Please try again.';
        j.message = j.error;
        if (j.userId) {
          try { await refundVideoTrial(j.id); } catch (error) {
            console.error('[VYRA] restart trial refund failed:', safeError(error));
          }
        }
      }

      jobs.set(j.id, j);
    }

    console.log(`[VYRA] Restored ${jobs.size} jobs`);
  } catch {
    // First boot.
  }
}

async function cleanup() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;

  try {
    for (const [id, j] of jobs) {
      if (
        new Date(j.createdAt).getTime() < cutoff &&
        !['queued', 'processing'].includes(j.status)
      ) {
        await fs.rm(path.join(OUTPUT_DIR, `${id}.mp4`), { force: true });
        await fs.rm(path.join(OUTPUT_DIR, `${id}.jpg`), { force: true });
        jobs.delete(id);
      }
    }

    persistJobs();
  } catch (e) {
    console.error('[VYRA] cleanup failed:', safeError(e));
  }
}

// ---------------------------------------------------------------- providers

async function uploadImage(dataUri) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  if (!env('FAL_KEY')) {
    throw new Error('Photo to Video is unavailable.');
  }

  const s = String(dataUri || '');
  const comma = s.indexOf(',');
  const head = s.slice(0, comma);

  const mime = (/^data:(image\/(?:jpeg|png|webp));base64$/.exec(head) || [])[1];

  if (!mime) {
    throw new Error('Photo must be a JPG, PNG or WebP image.');
  }

  const buf = Buffer.from(s.slice(comma + 1), 'base64');

  if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
    throw new Error('Photo must be under 8 MB.');
  }

  return fal.storage.upload(new Blob([buf], { type: mime }));
}

async function falVideo(
  prompt,
  { imageUrl, aspectRatio, duration, resolution } = {}
) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  if (!env('FAL_KEY')) {
    throw new Error('This feature needs FAL_KEY on the server.');
  }

  const model = imageUrl
    ? 'fal-ai/wan/v2.7/image-to-video'
    : 'fal-ai/wan/v2.7/text-to-video';

  const ratio = [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4',
  ].includes(aspectRatio)
    ? aspectRatio
    : '16:9';

  const input = {
    prompt: String(prompt).slice(0, 5000),
    duration: Math.max(2, Math.min(15, Math.round(Number(duration) || 5))),
    resolution: resolution === '1080p' ? '1080p' : '720p',
    enable_prompt_expansion: true,
    negative_prompt:
      'blurry, flicker, distorted anatomy, duplicate objects, unreadable text, watermark, low quality',
  };

  if (imageUrl) {
    input.image_url = imageUrl;
  } else {
    input.aspect_ratio = ratio;
  }

  try {
    const r = await fal.subscribe(model, { input, logs: false });

    const url =
      r?.data?.video?.url ||
      r?.video?.url ||
      r?.data?.videos?.[0]?.url;

    if (!url) {
      throw new Error('The provider returned no video URL.');
    }

    return url;
  } catch (e) {
    const m = safeError(e);

    if (/402|balance|credit|exhausted|locked/i.test(m)) {
      throw new Error('Video provider credits are exhausted.');
    }

    throw new Error(`Video generation failed: ${m}`);
  }
}

async function hfVideo(prompt, outPath) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  const token = env('HF_TOKEN');

  if (!token) {
    throw new Error('No video provider is configured.');
  }

  const model = env('HF_VIDEO_MODEL', 'Wan-AI/Wan2.2-TI2V-5B');

  try {
    const { InferenceClient } = await import('@huggingface/inference');
    const client = new InferenceClient(token);

    const result = await client.textToVideo({
      model,
      inputs: prompt.slice(0, 5000),
      parameters: {
        num_frames: 49,
        num_inference_steps: 25,
        guidance_scale: 5,
      },
    });

    const v = result?.video ?? result;
    let buf;

    if (Buffer.isBuffer(v)) {
      buf = v;
    } else if (v instanceof Uint8Array) {
      buf = Buffer.from(v);
    } else if (v && typeof v.arrayBuffer === 'function') {
      buf = Buffer.from(await v.arrayBuffer());
    }

    if (!buf || !buf.length) {
      throw new Error('Provider returned no video bytes.');
    }

    await fs.writeFile(outPath, buf);
  } catch (e) {
    throw new Error(`Hugging Face video generation failed: ${safeError(e)}`);
  }
}

async function speech(text, voiceId, outPath, language) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  if (!env('ELEVENLABS_API_KEY')) {
    throw new Error('Voice generation is unavailable.');
  }

  try {
    const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');

    const client = new ElevenLabsClient({
      apiKey: env('ELEVENLABS_API_KEY'),
    });

    const opts = {
      text: String(text),
      modelId: ELEVEN_MODEL,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0.42,
        similarityBoost: 0.78,
      },
    };

    if (language === 'Hindi') opts.languageCode = 'hi';
    if (language === 'Urdu') opts.languageCode = 'ur';

    const stream = await client.textToSpeech.convert(voiceId, opts);
    const chunks = [];

    for await (const c of stream) {
      chunks.push(Buffer.from(c));
    }

    const audio = Buffer.concat(chunks);

    if (!audio.length) {
      throw new Error('empty audio');
    }

    await fs.writeFile(outPath, audio);
  } catch (e) {
    throw new Error(`Voice generation failed: ${safeError(e)}`);
  }
}

async function makeThumb(videoPath, thumbPath) {
  try {
    await runFfmpeg([
      '-y',
      '-ss',
      '0.6',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      thumbPath,
    ]);

    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- pipelines

async function runStandard(job) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  const i = job.input;
  const finalPrompt = shared.buildPrompt(i);
  const out = path.join(OUTPUT_DIR, `${job.id}.mp4`);

  job.message = 'Directing your scene';
  job.progress = 8;

  if (env('FAL_KEY')) {
    let imageUrl = null;

    if (i.mode === 'photo') {
      job.message = 'Uploading your photo';
      imageUrl = await uploadImage(i.imageData);
    }

    job.message = 'Rendering your video';
    job.progress = 20;

    const url = await falVideo(finalPrompt, {
      imageUrl,
      aspectRatio: i.aspectRatio,
      duration: i.duration,
      resolution: i.resolution,
    });

    job.progress = 85;
    job.message = 'Saving your video';

    await download(url, out);
  } else {
    if (i.mode === 'photo') {
      throw new Error('Photo to Video needs FAL_KEY on the server.');
    }

    job.message = 'Rendering your video';
    job.progress = 20;

    await hfVideo(finalPrompt, out);
  }

  job.prompt = finalPrompt;
}

async function runTalkingFruits(job) {
  if (!GENERATION_ENABLED) {
    throw new Error('Video generation is disabled.');
  }

  const i = job.input;
  const story = shared.STORIES[i.storyKey] || shared.STORIES.market;

  const language = shared.LANGUAGES.includes(i.language)
    ? i.language
    : 'Hindi';

  const mango =
    env('ELEVENLABS_MANGO_VOICE_ID') ||
    env('ELEVENLABS_VOICE_ID');

  const straw =
    env('ELEVENLABS_STRAWBERRY_VOICE_ID') ||
    env('ELEVENLABS_VOICE_ID');

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'vyra-fruits-'));

  try {
    const clips = [];

    for (let n = 0; n < story.scenes.length; n++) {
      const sc = story.scenes[n];

      job.progress =
        Math.round((n / story.scenes.length) * 88) + 4;

      job.message = `Creating scene ${n + 1} of ${story.scenes.length}`;

      const audio = path.join(work, `a${n}.mp3`);
      const raw = path.join(work, `r${n}.mp4`);
      const clip = path.join(work, `c${n}.mp4`);

      await speech(
        sc.dialogue,
        sc.character === 'Mango' ? mango : straw,
        audio,
        language
      );

      const url = await falVideo(
        `${sc.prompt}. Polished 3D cartoon animation, consistent character design, cinematic comedy, no text, no subtitles.`,
        {
          aspectRatio: i.aspectRatio || '9:16',
          duration: 5,
        }
      );

      await download(url, raw);

      await runFfmpeg([
        '-y',
        '-stream_loop',
        '-1',
        '-i',
        raw,
        '-i',
        audio,
        '-vf',
        'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=24',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-t',
        '20',
        '-shortest',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        clip,
      ]);

      clips.push(clip);
    }

    job.message = 'Editing the final story';

    const list = path.join(work, 'list.txt');

    await fs.writeFile(
      list,
      clips
        .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
        .join('\n')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      path.join(OUTPUT_DIR, `${job.id}.mp4`),
    ]);

    job.prompt = story.title;
  } finally {
    await fs.rm(work, {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- queue

async function execute(job) {
  job.status = 'processing';
  job.startedAt = new Date().toISOString();

  persistJobs();

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    if (job.input.mode === 'talking-fruits') {
      await runTalkingFruits(job);
    } else {
      await runStandard(job);
    }

    const mp4 = path.join(OUTPUT_DIR, `${job.id}.mp4`);

    job.hasThumb = await makeThumb(
      mp4,
      path.join(OUTPUT_DIR, `${job.id}.jpg`)
    );

    job.status = 'completed';
    job.progress = 100;
    job.message = 'Your video is ready.';
    job.completedAt = new Date().toISOString();
    try {
      await finalizeVideoTrial(job.id);
    } catch (error) {
      console.error('[VYRA] trial finalization failed:', safeError(error));
    }
  } catch (e) {
    job.status = 'failed';
    job.error = safeError(e);
    job.message = job.error;

    try { await refundVideoTrial(job.id); } catch (error) { console.error('[VYRA] trial refund failed:', safeError(error)); }

    console.error(`[VYRA] job ${job.id} failed:`, job.error);
  } finally {
    delete job.input.imageData;
    persistJobs();
  }
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();

    if (job.status !== 'queued') continue;

    running += 1;

    execute(job).finally(() => {
      running -= 1;
      pump();
    });
  }
}

const queuePosition = (job) =>
  job.status === 'queued' ? queue.indexOf(job) + 1 : 0;

function publicJob(job, req) {
  const base = baseUrl(req);
  const done = job.status === 'completed';

  return {
    jobId: job.id,
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    queuePosition: queuePosition(job),
    error: job.error || null,
    createdAt: job.createdAt,
    mode: job.input?.mode || job.mode || null,
    prompt: job.prompt || job.input?.prompt || null,
    videoUrl: done ? `${base}/generated-videos/${job.id}.mp4` : null,
    url: done ? `${base}/generated-videos/${job.id}.mp4` : null,
    thumbUrl:
      done && job.hasThumb
        ? `${base}/generated-videos/${job.id}.jpg`
        : null,
    shareUrl: done ? `${base}/v/${job.id}` : null,
  };
}

// ---------------------------------------------------------------- middleware

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });

  next();
});

app.use(cors({
  origin: CORS_ORIGINS.length ? CORS_ORIGINS : true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-vyra-code',
    'x-vyra-client',
  ],
}));

app.use(express.json({ limit: '15mb' }));

app.use(
  '/generated-videos',
  express.static(OUTPUT_DIR, {
    maxAge: '1h',
    index: false,
  })
);

app.use(
  express.static(path.join(__dirname, 'landing'), {
    extensions: ['html'],
  })
);

app.use('/app', express.static(path.join(__dirname, 'dist')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down.',
  },
});

const genLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many generation requests. Try again in a few minutes.',
  },
});

app.use('/api', limiter);

async function auth(req, res, next) {
  if (!supabaseAuth || !supabaseAdmin) {
    return res.status(503).json({
      error: 'Account authentication is not configured on the VYRA server.',
      code: 'AUTH_NOT_CONFIGURED',
    });
  }

  const authorization = req.get('authorization') || '';
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!tokenMatch) {
    return res.status(401).json({
      error: 'Please sign in to your VYRA account.',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(tokenMatch[1]);

    if (error || !data?.user?.id) {
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'AUTH_INVALID',
      });
    }

    req.user = data.user;

    if (ACCESS_CODES.length) {
      const code = req.get('x-vyra-code') || '';
      if (!ACCESS_CODES.includes(code)) {
        return res.status(401).json({
          error: 'A valid access code is required.',
          code: 'ACCESS_CODE',
        });
      }
    }

    return next();
  } catch (error) {
    console.error('[VYRA] auth verification failed:', safeError(error));
    return res.status(503).json({
      error: 'Could not verify your account right now. Please try again.',
      code: 'AUTH_UNAVAILABLE',
    });
  }
}

async function getLifetimeQuota(userId) {
  if (!supabaseAdmin) throw new Error('Supabase server credentials are missing.');
  const { data, error } = await supabaseAdmin.rpc('get_video_trial_quota', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

async function refundVideoTrial(jobId) {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin.rpc('refund_video_trial', {
    p_job_id: jobId,
  });
  if (error) throw error;
  return data === true;
}

async function finalizeVideoTrial(jobId) {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin.rpc('finalize_video_trial', {
    p_job_id: jobId,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------- routes

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'vyra-ai-api',
    version: '2.0.0',
    features: caps(),
    ffmpeg: Boolean(ffmpegPath),
    queued: queue.length,
    running,
    time: new Date().toISOString(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    features: caps(),
    generationEnabled: GENERATION_ENABLED,
    accessRequired: ACCESS_CODES.length > 0,
    trialLimit: LIFETIME_VIDEO_TRIALS,
    quotaType: 'lifetime',
    maxDuration: 15,
    appUrl: APP_URL || null,
    maintenance: env('VYRA_MAINTENANCE') === 'true',
  });
});

app.get('/api/quota', auth, async (req, res) => {
  try {
    const quotaData = await getLifetimeQuota(req.user.id);
    res.json({
      limit: LIFETIME_VIDEO_TRIALS,
      used: Number(quotaData?.used || 0),
      remaining: Number(quotaData?.remaining ?? LIFETIME_VIDEO_TRIALS),
      type: 'lifetime',
    });
  } catch (error) {
    console.error('[VYRA] quota lookup failed:', safeError(error));
    res.status(503).json({
      error: 'Your free-trial balance is temporarily unavailable. Please try again.',
      code: 'QUOTA_UNAVAILABLE',
    });
  }
});

app.post('/api/enhance', (req, res) => {
  const b = req.body || {};
  const prompt = String(b.prompt || '').trim();

  if (!prompt) {
    return res.status(400).json({
      error: 'Describe your scene first.',
    });
  }

  const blocked = shared.screenPrompt(prompt);

  if (blocked) {
    return res.status(400).json({ error: blocked });
  }

  res.json({
    variants: shared.directorVariants({
      prompt: prompt.slice(0, 1200),
    }),
  });
});

app.post('/api/generate', auth, genLimiter, async (req, res) => {
  // Master safety lock. This runs before job creation and quota use.
  if (!GENERATION_ENABLED) {
    return res.status(503).json({
      error:
        'Video generation is temporarily disabled in VYRA free development mode.',
      code: 'GENERATION_DISABLED',
    });
  }

  const b = req.body || {};

  const rawMode = String(b.mode || 'text')
    .toLowerCase()
    .replace('_', '-');

  const mode = [
    'text',
    'photo',
    'ad',
    'talking-fruits',
  ].includes(rawMode)
    ? rawMode
    : 'text';

  const c = caps();

  if (env('VYRA_MAINTENANCE') === 'true') {
    return res.status(503).json({
      error:
        'VYRA is briefly offline for maintenance. Please try again soon.',
    });
  }

  if (mode === 'talking-fruits' && !c.talkingFruits) {
    return res.status(503).json({
      error: 'Talking Fruits is not enabled on this server yet.',
    });
  }

  if (mode === 'photo' && !c.photo) {
    return res.status(503).json({
      error: 'Photo to Video is not enabled on this server yet.',
    });
  }

  if ((mode === 'text' || mode === 'ad') && !c.text) {
    return res.status(503).json({
      error: 'No video provider is configured on this server.',
    });
  }

  const input = {
    mode,
    prompt: String(b.prompt || '').trim().slice(0, 1800),
    style: shared.STYLES.includes(b.style) ? b.style : '',
    camera: String(b.camera || 'auto'),
    mood: String(b.mood || 'auto'),
    aspectRatio: ['16:9', '9:16', '1:1'].includes(b.aspectRatio)
      ? b.aspectRatio
      : '16:9',
    duration: Math.round(Number(b.duration) || 5),
    resolution: '720p',
    imageData: mode === 'photo' ? String(b.imageData || '') : null,
    storyKey: shared.STORIES[b.storyKey] ? b.storyKey : 'market',
    language: shared.LANGUAGES.includes(b.language)
      ? b.language
      : 'Hindi',
    ad: mode === 'ad'
      ? {
          template: String(b.ad?.template || 'hero'),
          brandName: String(b.ad?.brandName || ''),
          productName: String(b.ad?.productName || ''),
          callToAction: String(b.ad?.callToAction || ''),
        }
      : null,
  };

  if (mode !== 'talking-fruits') {
    if (!input.prompt) {
      return res.status(400).json({
        error: 'Please describe your scene.',
      });
    }

    if (input.duration < 2 || input.duration > 15) {
      return res.status(400).json({
        error: 'Choose a duration between 2 and 15 seconds.',
      });
    }

    const blocked = shared.screenPrompt(
      `${input.prompt} ${input.ad?.brandName || ''} ${input.ad?.productName || ''} ${input.ad?.callToAction || ''}`
    );

    if (blocked) {
      return res.status(400).json({ error: blocked });
    }
  }

  if (mode === 'photo' && !input.imageData) {
    return res.status(400).json({
      error: 'Please choose a photo first.',
    });
  }

  if (queue.length >= 25) {
    return res.status(503).json({
      error:
        'VYRA is very busy right now. Please try again in a few minutes.',
    });
  }

  const jobId = crypto.randomUUID();
  let reservation;

  try {
    const { data, error } = await supabaseAdmin.rpc('reserve_video_trial', {
      p_user_id: req.user.id,
      p_job_id: jobId,
    });
    if (error) throw error;
    reservation = data;
  } catch (error) {
    console.error('[VYRA] trial reservation failed:', safeError(error));
    return res.status(503).json({
      error: 'Could not reserve your free video trial. Please try again.',
      code: 'TRIAL_RESERVATION_FAILED',
    });
  }

  if (!reservation?.allowed) {
    return res.status(429).json({
      error: 'You have used all 3 lifetime free video trials on this account.',
      code: 'QUOTA',
      limit: LIFETIME_VIDEO_TRIALS,
      used: Number(reservation?.used || LIFETIME_VIDEO_TRIALS),
      remaining: 0,
    });
  }

  const job = {
    id: jobId,
    userId: req.user.id,
    status: 'queued',
    progress: 2,
    message: 'Waiting in line',
    createdAt: new Date().toISOString(),
    input,
  };

  jobs.set(job.id, job);
  queue.push(job);

  persistJobs();
  pump();

  res.status(202).json({
    ...publicJob(job, req),
    remaining: Number(reservation.remaining),
    limit: LIFETIME_VIDEO_TRIALS,
  });
});

app.get('/api/generate/:id', auth, (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job || job.userId !== req.user.id) {
    return res.status(404).json({
      error: 'Job not found. It may have expired or been removed.',
    });
  }

  res.json(publicJob(job, req));
});

app.delete('/api/generate/:id', auth, async (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) return res.json({ ok: true });

  if (job.userId !== req.user.id) {
    return res.status(404).json({
      error: 'Job not found. It may have expired or been removed.',
    });
  }

  if (job.status === 'queued') {
    const i = queue.indexOf(job);

    if (i >= 0) queue.splice(i, 1);

    job.status = 'failed';
    job.error = 'Cancelled.';

    try { await refundVideoTrial(job.id); } catch (error) { console.error('[VYRA] trial refund failed:', safeError(error)); }
  }

  await fs.rm(
    path.join(OUTPUT_DIR, `${job.id}.mp4`),
    { force: true }
  );

  await fs.rm(
    path.join(OUTPUT_DIR, `${job.id}.jpg`),
    { force: true }
  );

  if (job.status !== 'processing') {
    jobs.delete(job.id);
  }

  persistJobs();

  res.json({ ok: true });
});

app.get('/api/videos/:id', async (req, res) => {
  const name = path.basename(req.params.id).replace(/\.mp4$/, '');
  const file = path.join(OUTPUT_DIR, `${name}.mp4`);

  try {
    await fs.access(file);
    res.sendFile(file);
  } catch {
    res.status(404).json({
      error: 'Video not found. It may have expired.',
    });
  }
});

// Public share page.

app.get('/v/:id', (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job || job.status !== 'completed') {
    return res.status(404).send(
      '<h1 style="font-family:sans-serif">This video is no longer available.</h1>'
    );
  }

  const base = baseUrl(req);
  const video = `${base}/generated-videos/${job.id}.mp4`;
  const thumb = job.hasThumb
    ? `${base}/generated-videos/${job.id}.jpg`
    : '';

  const title = esc(
    String(job.prompt || 'Made with VYRA AI').slice(0, 70)
  );

  const cta = APP_URL || base;

  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · VYRA AI</title><meta property="og:type" content="video.other"><meta property="og:title" content="${title}">
<meta property="og:description" content="Created with VYRA AI — Cinematic Intelligence."><meta property="og:video" content="${video}"><meta property="og:video:type" content="video/mp4">
${thumb ? `<meta property="og:image" content="${thumb}"><meta name="twitter:card" content="player"><meta name="twitter:image" content="${thumb}">` : ''}
<style>body{margin:0;background:#050a13;color:#f6f8ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:20px}
video{max-width:min(92vw,520px);max-height:72vh;border-radius:14px;background:#000}a.b{display:inline-block;margin-top:18px;background:#79efff;color:#04101c;font-weight:800;padding:13px 22px;border-radius:9px;text-decoration:none}
small{display:block;margin-top:14px;color:#a5b3c8}</style></head><body><main>
<video src="${video}" ${thumb ? `poster="${thumb}"` : ''} controls playsinline autoplay muted loop></video><br>
<a class="b" href="${esc(cta)}">Create your own with VYRA AI</a><small>AI-generated video</small></main></body></html>`);
});

app.get('/app/*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
);

app.use('/api', (_req, res) =>
  res.status(404).json({ error: 'Unknown API route.' })
);

app.use((error, _req, res, _next) => {
  const status = error.status || 500;

  if (status >= 500) {
    console.error('[VYRA] request error:', safeError(error));
  }

  res.status(status).json({
    error:
      status === 413
        ? 'That upload is too large.'
        : safeError(error),
  });
});

// ---------------------------------------------------------------- boot

(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {});

  await loadJobs();

  setInterval(cleanup, 60 * 60 * 1000).unref();

  app.listen(PORT, '0.0.0.0', () => {
    const c = caps();

    console.log(
      `[VYRA] API v2 on :${PORT} | generation:${GENERATION_ENABLED ? 'ON' : 'OFF'} | text:${c.text} photo:${c.photo} fruits:${c.talkingFruits} | lifetime trials:${LIFETIME_VIDEO_TRIALS} | auth:${supabaseAuth && supabaseAdmin ? 'ready' : 'missing'} | access codes:${ACCESS_CODES.length}`
    );
  });
})();
