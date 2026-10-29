
'use strict';

// VYRA AI API
// Regular text-to-video uses HF_TOKEN.
// Talking Fruits still requires FAL_KEY and ELEVENLABS_API_KEY.
// Never put API keys in your frontend or commit them to GitHub.

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
const OUTPUT_DIR =
  process.env.VYRA_STORAGE_DIR ||
  path.join(os.tmpdir(), 'vyra-generated-videos');

const jobs = new Map();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '15mb' }));
app.use(
  '/generated-videos',
  express.static(OUTPUT_DIR, { maxAge: '1h' })
);

if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_API_URL || '')
    .trim()
    .replace(/\/$/, '');

  if (configured) return configured;

  return `${req.protocol}://${req.get('host')}`;
}

function safeError(error) {
  const message =
    error && error.message
      ? error.message
      : String(error || 'Unknown error');

  return message.slice(0, 900);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(
        new Error('FFmpeg is unavailable on this server.')
      );
    }

    const child = spawn(ffmpegPath, args, {
      windowsHide: true
    });

    let stderr = '';

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}: ${stderr.slice(-1500)}`
          )
        );
      }
    });
  });
}

async function downloadToFile(url, destination) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Could not download media. HTTP ${response.status}.`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) {
    throw new Error('Downloaded media was empty.');
  }

  await fs.writeFile(destination, buffer);
}

function ensureFalConfig() {
  if (!process.env.FAL_KEY) {
    throw new Error(
      'This feature requires FAL_KEY in your backend environment.'
    );
  }
}

// --------------------------------------------------
// HUGGING FACE TEXT-TO-VIDEO
// --------------------------------------------------

async function huggingFaceVideo(prompt, options = {}) {
  const token = process.env.HF_TOKEN;

  if (!token) {
    throw new Error(
      'HF_TOKEN is missing. Add it to Render Environment Variables.'
    );
  }

  const model =
    process.env.HF_VIDEO_MODEL ||
    'Wan-AI/Wan2.2-TI2V-5B';

  try {
    const { InferenceClient } =
      await import('@huggingface/inference');

    const client = new InferenceClient(token);

    console.log('[VYRA] Starting Hugging Face video generation.');
    console.log('[VYRA] Model:', model);

    const result = await client.textToVideo({
      model,
      inputs: String(prompt).slice(0, 5000),
      parameters: {
        num_frames: 49,
        num_inference_steps: 25,
        guidance_scale: 5
      }
    });

    // The SDK returns a TextToVideoOutput object.
    // Handle its video field and common binary output forms.
    const video = result?.video ?? result;

    let buffer;

    if (Buffer.isBuffer(video)) {
      buffer = video;
    } else if (video instanceof Uint8Array) {
      buffer = Buffer.from(video);
    } else if (video && typeof video.arrayBuffer === 'function') {
      buffer = Buffer.from(await video.arrayBuffer());
    } else if (video?.data) {
      const data = video.data;

      if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
        buffer = Buffer.from(data);
      } else if (typeof data === 'string') {
        buffer = Buffer.from(data, 'base64');
      }
    }

    if (!buffer || !buffer.length) {
      throw new Error(
        'The provider returned no usable video bytes. Check the selected model and provider output.'
      );
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const filename = `${crypto.randomUUID()}.mp4`;
    const filepath = path.join(OUTPUT_DIR, filename);

    await fs.writeFile(filepath, buffer);

    console.log('[VYRA] Video saved:', filename);

    return filename;
  } catch (error) {
    const detail = safeError(error);

    console.error('[VYRA] Hugging Face error:', detail);

    if (/401|unauthorized|invalid token/i.test(detail)) {
      throw new Error(
        'Hugging Face rejected HF_TOKEN. Check the token and its Inference Providers permissions in Render.'
      );
    }

    if (/402|payment|billing|credit|quota|429/i.test(detail)) {
      throw new Error(
        `The selected video provider reported a usage, rate, or billing limit. Check the provider limits before retrying. Details: ${detail}`
      );
    }

    throw new Error(
      `Hugging Face video generation failed: ${detail}`
    );
  }
}

// --------------------------------------------------
// FAL.AI VIDEO PROVIDER
// Used by Talking Fruits scenes.
// --------------------------------------------------

async function falVideo(prompt, imageUrl = null, options = {}) {
  ensureFalConfig();

  const model = imageUrl
    ? 'fal-ai/wan/v2.7/image-to-video'
    : 'fal-ai/wan/v2.7/text-to-video';

  const allowedRatios = [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4'
  ];

  const ratio = allowedRatios.includes(options.aspectRatio)
    ? options.aspectRatio
    : '16:9';

  const duration = Math.max(
    2,
    Math.min(15, Math.round(Number(options.duration) || 5))
  );

  const input = {
    prompt: String(prompt).slice(0, 5000),
    duration,
    resolution: options.resolution === '1080p'
      ? '1080p'
      : '720p',
    enable_prompt_expansion: true,
    negative_prompt:
      'blurry, flicker, distorted anatomy, duplicate objects, unreadable text, low quality'
  };

  if (imageUrl) {
    input.image_url = imageUrl;
  } else {
    input.aspect_ratio = ratio;
  }

  try {
    const result = await fal.subscribe(model, {
      input,
      logs: false
    });

    const url =
      result?.data?.video?.url ||
      result?.video?.url ||
      result?.data?.videos?.[0]?.url;

    if (!url) {
      throw new Error('The provider returned no video URL.');
    }

    return url;
  } catch (error) {
    throw new Error(
      `fal.ai video generation failed: ${safeError(error)}`
    );
  }
}

// --------------------------------------------------
// ELEVENLABS SPEECH
// --------------------------------------------------

async function elevenLabsSpeech(
  text,
  voiceId,
  outputPath,
  language = 'Hindi'
) {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error(
      'Talking Fruits requires ELEVENLABS_API_KEY.'
    );
  }

  if (!voiceId) {
    throw new Error(
      'A voice ID is missing. Configure ELEVENLABS_MANGO_VOICE_ID and ELEVENLABS_STRAWBERRY_VOICE_ID.'
    );
  }

  try {
    const { ElevenLabsClient } =
      await import('@elevenlabs/elevenlabs-js');

    const client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY
    });

    const options = {
      text: String(text),
      modelId: 'eleven_v4',
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0.42,
        similarityBoost: 0.78
      }
    };

    if (language === 'Hindi') options.languageCode = 'hi';
    if (language === 'Urdu') options.languageCode = 'ur';

    const stream = await client.textToSpeech.convert(
      voiceId,
      options
    );

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const audio = Buffer.concat(chunks);

    if (!audio.length) {
      throw new Error('The speech provider returned empty audio.');
    }

    await fs.writeFile(outputPath, audio);
  } catch (error) {
    throw new Error(
      `ElevenLabs speech generation failed: ${safeError(error)}`
    );
  }
}

// --------------------------------------------------
// TALKING FRUITS
// Requires FAL_KEY and ElevenLabs credentials.
// --------------------------------------------------

async function createTalkingFruitScene({
  scene,
  voiceId,
  language,
  workDir,
  index
}) {
  const audioPath = path.join(
    workDir,
    `dialogue-${index}.mp3`
  );

  const videoPath = path.join(
    workDir,
    `scene-${index}.mp4`
  );

  const rawVideo = path.join(
    workDir,
    `raw-${index}.mp4`
  );

  await elevenLabsSpeech(
    scene.dialogue,
    voiceId,
    audioPath,
    language
  );

  const prompt =
    `${scene.prompt}. Animated anthropomorphic fruit characters, expressive faces, visible mouths, cinematic comedy, polished 3D animation, consistent character design, no text, no subtitles.`;

  const videoUrl = await falVideo(prompt);

  await downloadToFile(videoUrl, rawVideo);

  await runFfmpeg([
    '-y',
    '-i', rawVideo,
    '-i', audioPath,
    '-filter_complex',
    '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24[v]',
    '-map', '[v]',
    '-map', '1:a:0',
    '-t', '15',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    videoPath
  ]);

  return videoPath;
}

async function generateTalkingFruits(job, req) {
  ensureFalConfig();

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error(
      'Talking Fruits requires ELEVENLABS_API_KEY.'
    );
  }

  const mangoVoice =
    process.env.ELEVENLABS_MANGO_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID;

  const strawberryVoice =
    process.env.ELEVENLABS_STRAWBERRY_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID;

  if (!mangoVoice || !strawberryVoice) {
    throw new Error(
      'Configure the Talking Fruits voice IDs in Render.'
    );
  }

  const language = ['Hindi', 'Urdu'].includes(job.input.language)
    ? job.input.language
    : 'Hindi';

  const scenes = [
    {
      speaker: 'mango',
      dialogue:
        'Market ka asli king main hoon! Aam ka season aata hai toh sab mere peeche line lagate hain.',
      prompt:
        'A proud golden mango king wearing a tiny royal crown enters a colorful Indian fruit market with dramatic hero lighting'
    },
    {
      speaker: 'strawberry',
      dialogue:
        'King? Please! Main Strawberry Queen hoon. Cute bhi, classy bhi, aur tumse zyada premium bhi!',
      prompt:
        'A confident red strawberry queen with a sparkling crown poses in a colorful fruit market'
    },
    {
      speaker: 'mango',
      dialogue:
        'Premium hone se kya hota hai? Mere bina aam panna, mango shake aur aamras kaun banayega?',
      prompt:
        'A golden mango king gestures dramatically beside mango shakes and aamras bowls, funny animated reactions'
    },
    {
      speaker: 'strawberry',
      dialogue:
        'Aur mere bina cake, smoothie aur dessert ki party boring! Apne favourite ko vote karo!',
      prompt:
        'A strawberry queen and mango king argue playfully, then turn to camera and invite the audience to vote'
    }
  ];

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'vyra-fruits-')
  );

  try {
    const clips = [];

    for (let i = 0; i < scenes.length; i++) {
      job.progress = Math.round((i / scenes.length) * 85);
      job.message = `Creating Talking Fruits scene ${i + 1} of ${scenes.length}`;

      const scene = scenes[i];

      const clip = await createTalkingFruitScene({
        scene,
        voiceId: scene.speaker === 'mango'
          ? mangoVoice
          : strawberryVoice,
        language,
        workDir,
        index: i + 1
      });

      clips.push(clip);
    }

    const listPath = path.join(workDir, 'concat.txt');

    await fs.writeFile(
      listPath,
      clips
        .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
        .join('\n')
    );

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const outputName = `${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);

    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath
    ]);

    job.videoUrl =
      `${publicBaseUrl(req)}/generated-videos/${outputName}`;

    job.progress = 100;
    job.status = 'completed';
    job.message =
      'Talking Fruits video is ready. Dialogue audio is mixed with the scenes; frame-accurate lip-sync is not guaranteed.';
  } finally {
    await fs.rm(workDir, {
      recursive: true,
      force: true
    }).catch(() => {});
  }
}

// --------------------------------------------------
// REGULAR VIDEO GENERATION
// Uses Hugging Face, not FAL_KEY.
// Text-to-video only in this version.
// --------------------------------------------------

async function processRegularVideo(job, req) {
  const prompt = String(job.input.prompt || '').trim();

  if (!prompt) {
    throw new Error('Please provide a video prompt.');
  }

  const imageUrl =
    job.input.imageData ||
    job.input.imageUrl ||
    job.input.image_url ||
    null;

  if (imageUrl) {
    throw new Error(
      'Photo-to-video is not enabled in this text-to-video version. Please use text-to-video.'
    );
  }

  const style = String(job.input.style || '').trim();

  const adDetails = job.input.adMode
    ? ` Commercial video. Brand: ${String(job.input.brandName || '').slice(0, 100)}. Product: ${String(job.input.productName || '').slice(0, 150)}. Call to action: ${String(job.input.callToAction || '').slice(0, 150)}.`
    : '';

  const finalPrompt =
    `${prompt}${style ? `. Visual style: ${style}.` : ''}${adDetails}`;

  job.progress = 10;
  job.message = 'Sending prompt to Hugging Face video provider';

  const outputName = await huggingFaceVideo(finalPrompt, {
    duration: job.input.duration,
    aspectRatio: job.input.aspectRatio
  });

  job.videoUrl =
    `${publicBaseUrl(req)}/generated-videos/${encodeURIComponent(outputName)}`;

  job.progress = 100;
  job.status = 'completed';
  job.message = 'Video generation completed.';
}

// --------------------------------------------------
// JOB MANAGEMENT
// --------------------------------------------------

function startJob(req, input) {
  const id = crypto.randomUUID();

  const job = {
    id,
    status: 'queued',
    progress: 0,
    message: 'Queued',
    createdAt: new Date().toISOString(),
    input
  };

  jobs.set(id, job);

  setImmediate(async () => {
    job.status = 'processing';

    try {
      const mode = String(
        input.mode || input.type || ''
      ).toLowerCase();

      if (
        mode === 'talking-fruits' ||
        mode === 'talking_fruits'
      ) {
        await generateTalkingFruits(job, req);
      } else {
        await processRegularVideo(job, req);
      }
    } catch (error) {
      job.status = 'failed';
      job.error = safeError(error);
      job.message = job.error;

      console.error(
        `[VYRA] Job ${id} failed:`,
        job.error
      );
    }
  });

  return job;
}

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'vyra-ai-api',
    mode: process.env.VYRA_MODE || 'production',
    huggingFaceConfigured: Boolean(process.env.HF_TOKEN),
    falConfigured: Boolean(process.env.FAL_KEY),
    speechConfigured: Boolean(
      process.env.ELEVENLABS_API_KEY &&
      (
        process.env.ELEVENLABS_MANGO_VOICE_ID ||
        process.env.ELEVENLABS_VOICE_ID
      )
    ),
    ffmpegAvailable: Boolean(ffmpegPath),
    time: new Date().toISOString()
  });
});

// --------------------------------------------------
// CREATE VIDEO JOB
// --------------------------------------------------

app.post('/api/generate', (req, res) => {
  const body = req.body || {};

  const mode = String(
    body.mode || body.type || 'text-to-video'
  ).toLowerCase();

  const isTalkingFruits = [
    'talking-fruits',
    'talking_fruits'
  ].includes(mode);

  if (!isTalkingFruits && !String(body.prompt || '').trim()) {
    return res.status(400).json({
      error: 'A prompt is required.'
    });
  }

  const requestedDuration = Number(body.duration || 5);

  if (
    !isTalkingFruits &&
    (
      !Number.isFinite(requestedDuration) ||
      requestedDuration < 2 ||
      requestedDuration > 15
    )
  ) {
    return res.status(400).json({
      error: 'Choose a clip duration between 2 and 15 seconds.'
    });
  }

  if (isTalkingFruits && !process.env.FAL_KEY) {
    return res.status(503).json({
      error: 'Talking Fruits requires FAL_KEY in Render.'
    });
  }

  if (
    isTalkingFruits &&
    !process.env.ELEVENLABS_API_KEY
  ) {
    return res.status(503).json({
      error: 'Talking Fruits requires ELEVENLABS_API_KEY in Render.'
    });
  }

  if (!isTalkingFruits && !process.env.HF_TOKEN) {
    return res.status(503).json({
      error: 'HF_TOKEN is missing from Render Environment Variables.'
    });
  }

  const job = startJob(req, {
    ...body,
    mode
  });

  return res.status(202).json({
    jobId: job.id,
    id: job.id,
    status: job.status,
    message: job.message
  });
});

// --------------------------------------------------
// CHECK JOB STATUS
// --------------------------------------------------

app.get('/api/generate/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found. Jobs are kept in server memory and may disappear after a restart.'
    });
  }

  return res.json({
    jobId: job.id,
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    videoUrl: job.videoUrl || null,
    url: job.videoUrl || null,
    error: job.error || null,
    createdAt: job.createdAt
  });
});

// --------------------------------------------------
// SERVE A GENERATED VIDEO BY ID
// --------------------------------------------------

app.get('/api/videos/:id', async (req, res) => {
  const id = path.basename(req.params.id);
  const filename = id.endsWith('.mp4') ? id : `${id}.mp4`;
  const filepath = path.join(OUTPUT_DIR, filename);

  try {
    await fs.access(filepath);
    return res.sendFile(filepath);
  } catch {
    return res.status(404).json({
      error: 'Video file not found. The server may have restarted or the file may have expired.'
    });
  }
});

// --------------------------------------------------
// ROOT
// --------------------------------------------------

app.get('/', (_req, res) => {
  res.json({
    name: 'VYRA AI API',
    status: 'online',
    health: '/api/health',
    generate: 'POST /api/generate',
    jobStatus: 'GET /api/generate/:jobId'
  });
});

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((error, _req, res, _next) => {
  console.error('[VYRA] Request error:', safeError(error));

  res.status(error.status || 500).json({
    error: safeError(error)
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[VYRA] API listening on port ${PORT}`);
  console.log(`[VYRA] Hugging Face configured: ${Boolean(process.env.HF_TOKEN)}`);
  console.log(`[VYRA] FAL configured: ${Boolean(process.env.FAL_KEY)}`);
  console.log(`[VYRA] FFmpeg available: ${Boolean(ffmpegPath)}`);
});
