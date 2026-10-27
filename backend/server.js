"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { fal } = require("@fal-ai/client");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const app = express();
const PORT = Number(process.env.PORT || 8787);

const FAL_KEY = (process.env.FAL_KEY || "").trim();
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const VIDEO_DIR = path.join(__dirname, "generated-videos");

const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_ACTIVE_JOBS = 1;
const JOB_RETENTION_MS = 6 * 60 * 60 * 1000;

const TEXT_MODEL = "fal-ai/wan/v2.7/text-to-video";
const IMAGE_MODEL = "fal-ai/wan/v2.7/image-to-video";

const jobs = new Map();
const requestHistory = new Map();

let activeJobs = 0;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || FRONTEND_ORIGIN.length === 0) {
        return callback(null, true);
      }

      if (FRONTEND_ORIGIN.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS."));
    },
  })
);

app.use(express.json({ limit: "12mb" }));

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

function isConfigured() {
  return Boolean(
    FAL_KEY &&
    FAL_KEY !== "YOUR_REAL_FAL_API_KEY"
  );
}

function parseDuration(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(5|10|15)(?:\s*(?:s|sec|secs|second|seconds))?$/i);

  return match ? Number(match[1]) : null;
}

function parseAspectRatio(value) {
  const allowed = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  const ratio = String(value || "16:9");

  return allowed.includes(ratio) ? ratio : "16:9";
}

function parseMode(value) {
  return value === "photo" || value === "image" ? "photo" : "text";
}

function getImageInput(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Choose a photo before generating a video.");
  }

  const image = value.trim();

  if (/^https:\/\/\S+$/i.test(image)) {
    const url = new URL(image);

    if (url.username || url.password) {
      throw new Error("Image URLs containing credentials are not supported.");
    }

    return image;
  }

  const match = image.match(
    /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) {
    throw new Error(
      "Invalid photo. Select a JPG, PNG, or WebP image again."
    );
  }

  const encoded = match[2].replace(/\s/g, "");
  const estimatedBytes = Math.floor((encoded.length * 3) / 4);

  if (!encoded || estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error("Choose an image smaller than 8 MB.");
  }

  return `data:image/${match[1].toLowerCase()};base64,${encoded}`;
}

function normalizeError(error) {
  const message = String(
    error?.body?.detail ||
    error?.body?.error ||
    error?.message ||
    error ||
    "Unknown provider error"
  );

  const status = Number(
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    0
  );

  if (
    status === 401 ||
    /invalid api key|invalid token|unauthorized/i.test(message)
  ) {
    return {
      status: 502,
      error:
        "fal.ai rejected FAL_KEY. Check the key in Render Environment and replace it if necessary.",
    };
  }

  if (status === 403 || /forbidden|permission denied/i.test(message)) {
    return {
      status: 502,
      error:
        "fal.ai denied access. Check API key permissions and access to the selected model.",
    };
  }

  if (
    status === 402 ||
    /insufficient credits|out of credits|low balance|payment required|billing|insufficient balance/i.test(
      message
    )
  ) {
    return {
      status: 402,
      error:
        "fal.ai reports insufficient credits or balance. Check your provider billing.",
    };
  }

  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    return {
      status: 429,
      error: "The provider is rate-limiting requests. Please try again later.",
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 502,
    error: `AI video generation failed: ${message.slice(0, 500)}`,
  };
}

function safeLogError(error) {
  const mapped = normalizeError(error);

  // Never log the API key or authorization headers.
  console.error("[VYRA] Provider error:", mapped.error);

  return mapped;
}

function rateLimitGeneration(req, res) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const configuredLimit = Number(
    process.env.GENERATION_LIMIT_PER_HOUR || 3
  );
  const limit = Number.isFinite(configuredLimit)
    ? Math.max(1, configuredLimit)
    : 3;

  const key = String(req.ip || "unknown");
  const timestamps = (requestHistory.get(key) || []).filter(
    (time) => now - time < windowMs
  );

  if (timestamps.length >= limit) {
    requestHistory.set(key, timestamps);

    res.setHeader(
      "Retry-After",
      String(Math.ceil((windowMs - (now - timestamps[0])) / 1000))
    );

    res.status(429).json({
      error: "You've reached the generation limit for this hour. Try later.",
    });

    return false;
  }

  timestamps.push(now);
  requestHistory.set(key, timestamps);

  return true;
}

async function removeOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;

  for (const [id, job] of jobs.entries()) {
    if (job.createdAt >= cutoff || job.status === "IN_PROGRESS") {
      continue;
    }

    jobs.delete(id);

    if (job.filePath) {
      await fsp.unlink(job.filePath).catch(() => {});
    }
  }

  for (const [key, timestamps] of requestHistory.entries()) {
    const recent = timestamps.filter(
      (time) => Date.now() - time < 60 * 60 * 1000
    );

    if (recent.length) {
      requestHistory.set(key, recent);
    } else {
      requestHistory.delete(key);
    }
  }
}

async function saveProviderVideo(videoUrl, destination) {
  let url;

  try {
    url = new URL(videoUrl);
  } catch {
    throw new Error("The provider returned an invalid video URL.");
  }

  const allowedHost =
    url.hostname === "fal.media" ||
    url.hostname.endsWith(".fal.media");

  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "The provider returned an unexpected video host. The file was not downloaded."
    );
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(180000),
    redirect: "error",
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download the generated video (HTTP ${response.status}).`
    );
  }

  const contentLength = Number(
    response.headers.get("content-length") || 0
  );

  if (contentLength > MAX_VIDEO_BYTES) {
    throw new Error("The generated video exceeds the 250 MB limit.");
  }

  let downloadedBytes = 0;

  const sizeGuard = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;

      if (downloadedBytes > MAX_VIDEO_BYTES) {
        callback(new Error("The generated video exceeds the 250 MB limit."));
        return;
      }

      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      sizeGuard,
      fs.createWriteStream(destination)
    );
  } catch (error) {
    await fsp.unlink(destination).catch(() => {});
    throw error;
  }

  if (downloadedBytes === 0) {
    await fsp.unlink(destination).catch(() => {});
    throw new Error("The AI provider returned an empty video.");
  }
}

async function runGeneration(job, input) {
  activeJobs += 1;

  job.status = "IN_PROGRESS";
  job.updatedAt = Date.now();

  try {
    const modelId = input.mode === "photo" ? IMAGE_MODEL : TEXT_MODEL;

    const modelInput = {
      prompt: input.prompt,
      duration: String(input.duration),
      resolution: "720p",
      enable_prompt_expansion: true,
    };

    if (input.style) {
      modelInput.prompt =
        `${input.prompt}. Visual direction: ${input.style}. ` +
        "Use coherent composition, smooth natural movement, detailed lighting, and cinematic motion.";
    }

    if (input.mode === "photo") {
      modelInput.image_url = input.imageData;
    } else {
      modelInput.aspect_ratio = input.aspectRatio;
    }

    console.log(
      `[VYRA] Starting job ${job.id}: ${input.mode}, ${input.duration}s`
    );

    const result = await fal.subscribe(modelId, {
      input: modelInput,
      logs: true,

      onQueueUpdate(update) {
        if (update?.status) {
          console.log(`[FAL] Job ${job.id}: ${update.status}`);
        }

        if (Array.isArray(update?.logs)) {
          for (const entry of update.logs) {
            if (entry?.message) {
              console.log(`[FAL] ${entry.message}`);
            }
          }
        }
      },
    });

    const videoUrl =
      result?.data?.video?.url ||
      result?.data?.video_url ||
      result?.video?.url ||
      result?.video_url;

    if (!videoUrl) {
      throw new Error(
        "The provider completed the request without returning a video URL."
      );
    }

    await fsp.mkdir(VIDEO_DIR, { recursive: true });

    const filePath = path.join(VIDEO_DIR, `${job.id}.mp4`);

    await saveProviderVideo(videoUrl, filePath);

    job.filePath = filePath;
    job.status = "COMPLETED";
    job.error = null;
    job.errorStatus = null;
    job.updatedAt = Date.now();

    console.log(`[VYRA] Job ${job.id} completed.`);
  } catch (error) {
    const mapped = safeLogError(error);

    job.status = "FAILED";
    job.error = mapped.error;
    job.errorStatus = mapped.status;
    job.updatedAt = Date.now();
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

app.get("/", (_req, res) => {
  res.json({
    name: "VYRA AI API",
    ok: true,
    health: "/api/health",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VYRA AI API",
    provider: "fal.ai",
    configured: isConfigured(),
    generationEnabled: isConfigured(),
    textModel: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
    supportedDurations: [5, 10, 15],
    activeJobs,
  });
});

app.post("/api/generate", async (req, res) => {
  await removeOldJobs();

  if (!isConfigured()) {
    return res.status(503).json({
      error:
        "AI generation is not configured. Add a valid FAL_KEY to Render Environment.",
    });
  }

  const prompt = String(req.body?.prompt || "").trim();
  const mode = parseMode(req.body?.mode);

  const style = String(
    req.body?.style || req.body?.styleName || "Cinematic"
  )
    .trim()
    .slice(0, 80);

  const duration = parseDuration(
    req.body?.duration ??
    req.body?.durationSeconds ??
    req.body?.duration_seconds ??
    req.body?.seconds ??
    req.body?.requestedDuration
  );

  const aspectRatio = parseAspectRatio(
    req.body?.aspectRatio ??
    req.body?.aspect_ratio ??
    req.body?.ratio
  );

  let imageData = "";

  if (mode === "photo") {
    try {
      imageData = getImageInput(req.body?.imageData);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  if (!prompt) {
    return res.status(400).json({ error: "A prompt is required." });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
    });
  }

  if (!duration) {
    return res.status(400).json({
      error: "Duration must be 5, 10, or 15 seconds.",
    });
  }

  if (activeJobs >= MAX_ACTIVE_JOBS) {
    return res.status(429).json({
      error: "Another video is being generated. Please wait.",
    });
  }

  if (!rateLimitGeneration(req, res)) {
    return;
  }

  const jobId = crypto.randomUUID();

  const job = {
    id: jobId,
    status: "IN_QUEUE",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    filePath: null,
    error: null,
    errorStatus: null,
  };

  jobs.set(jobId, job);

  const input = {
    prompt,
    mode,
    style,
    duration,
    aspectRatio,
    imageData,
  };

  // runGeneration increments activeJobs synchronously before its first await.
  void runGeneration(job, input);

  return res.status(202).json({
    jobId,
    modelId: mode === "photo" ? IMAGE_MODEL : TEXT_MODEL,
    initialStatus: "IN_QUEUE",
  });
});

app.get("/api/generate/:id", (req, res) => {
  const job = jobs.get(String(req.params.id || ""));

  if (!job) {
    return res.status(404).json({
      error: "Generation job not found. Please generate another video.",
    });
  }

  if (job.status === "FAILED") {
    return res.status(job.errorStatus || 502).json({
      status: "FAILED",
      error: job.error,
    });
  }

  if (job.status !== "COMPLETED") {
    return res.json({
      status: job.status,
    });
  }

  const base = PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;

  return res.json({
    status: "COMPLETED",
    requestId: job.id,
    videoUrl: `${base}/api/videos/${job.id}`,
  });
});

app.get("/api/videos/:id", async (req, res) => {
  const job = jobs.get(String(req.params.id || ""));

  if (!job || job.status !== "COMPLETED" || !job.filePath) {
    return res.status(404).json({
      error:
        "Video not found. The job may have expired or the server restarted.",
    });
  }

  try {
    await fsp.access(job.filePath);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (req.query.download === "1") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="vyra-${job.id}.mp4"`
      );
    } else {
      res.setHeader(
        "Content-Disposition",
        'inline; filename="vyra-video.mp4"'
      );
    }

    return res.sendFile(job.filePath);
  } catch {
    return res.status(404).json({
      error: "The generated video file is no longer available.",
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error("[VYRA] Server error:", error?.message || error);

  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request too large. Choose a smaller image.",
    });
  }

  if (String(error?.message || "").includes("Origin not allowed")) {
    return res.status(403).json({
      error: "This website is not permitted to use the VYRA API.",
    });
  }

  return res.status(500).json({
    error: "Unexpected backend error. Check the Render logs.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("VYRA AI BACKEND STARTED");
  console.log(`Port: ${PORT}`);
  console.log("Health: /api/health");
  console.log(`fal.ai key configured: ${isConfigured()}`);
  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);
});