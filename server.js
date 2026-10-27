"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { fal } = require("@fal-ai/client");
const crypto = require("node:crypto");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 8787);

const FAL_KEY = (process.env.FAL_KEY || "").trim();

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

const VIDEO_DIR = path.join(__dirname, "generated-videos");

const TEXT_MODEL = "fal-ai/wan/v2.7/text-to-video";
const IMAGE_MODEL = "fal-ai/wan/v2.7/image-to-video";

const ALLOWED_DURATIONS = [5, 10, 15];
const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const JOB_RETENTION_MS = 6 * 60 * 60 * 1000;
const MAX_ACTIVE_JOBS = 1;

const FRONTEND_ORIGINS = new Set([
  "https://syedanajaf7259-vyra-video-engine.static.hf.space",
  "https://huggingface.co",
  ...String(process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

const jobs = new Map();
const requestHistory = new Map();

let activeJobs = 0;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      // Permit native clients and non-browser health checks.
      if (!origin) {
        return callback(null, true);
      }

      if (FRONTEND_ORIGINS.has(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("Origin not allowed by VYRA API.")
      );
    },
  })
);

app.use(express.json({ limit: "12mb" }));

if (FAL_KEY && FAL_KEY !== "YOUR_REAL_FAL_API_KEY") {
  fal.config({
    credentials: FAL_KEY,
  });
}

function isConfigured() {
  return Boolean(
    FAL_KEY &&
    FAL_KEY !== "YOUR_REAL_FAL_API_KEY"
  );
}

/*
 * Accept the duration from several common frontend field names.
 *
 * Valid:
 *   5
 *   "5"
 *   "5s"
 *   "5 seconds"
 *   "10 sec"
 *   "15s"
 *
 * If no duration is supplied, default to 5 seconds.
 * Explicit unsupported values are rejected.
 */
function parseDuration(body = {}) {
  const keys = [
    "duration",
    "durationSeconds",
    "duration_seconds",
    "seconds",
    "requestedDuration",
    "requested_duration",
    "videoDuration",
    "video_duration",
    "length",
  ];

  for (const key of keys) {
    const value = body[key];

    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string" && !value.trim()) {
      continue;
    }

    const match = String(value)
      .trim()
      .match(
        /^(5|10|15)(?:\s*(?:s|sec|secs|second|seconds))?$/i
      );

    if (!match) {
      return null;
    }

    const duration = Number(match[1]);

    return ALLOWED_DURATIONS.includes(duration)
      ? duration
      : null;
  }

  return 5;
}

function parseMode(value) {
  return value === "photo" || value === "image"
    ? "photo"
    : "text";
}

function parseAspectRatio(value) {
  const allowed = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  const ratio = String(value || "16:9").trim();

  return allowed.includes(ratio) ? ratio : "16:9";
}

function getImageInput(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Choose a photo before generating a video.");
  }

  const image = value.trim();

  // Publicly accessible HTTPS images are accepted.
  if (/^https:\/\/\S+$/i.test(image)) {
    return image;
  }

  const match = image.match(
    /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) {
    throw new Error(
      "Choose a valid PNG, JPEG, or WebP photo."
    );
  }

  const encoded = match[2].replace(/\s/g, "");

  const estimatedBytes = Math.floor(
    (encoded.length * 3) / 4
  );

  if (!encoded || estimatedBytes > MAX_IMAGE_SIZE) {
    throw new Error("Choose an image smaller than 8 MB.");
  }

  return image;
}

function mapProviderError(error) {
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
    /invalid api key|invalid token|invalid username or password|unauthorized/i.test(
      message
    )
  ) {
    return {
      status: 502,
      error:
        "fal.ai rejected FAL_KEY. Check the key in Render Environment.",
    };
  }

  if (
    status === 403 ||
    /forbidden|permission denied/i.test(message)
  ) {
    return {
      status: 502,
      error:
        "fal.ai denied access. Check your API key permissions and model access.",
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
        "fal.ai reports insufficient credits or balance. Check your account usage and billing.",
    };
  }

  if (
    status === 429 ||
    /rate limit|too many requests/i.test(message)
  ) {
    return {
      status: 429,
      error:
        "The AI provider is rate-limiting requests. Please wait before retrying.",
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 502,
    error: `AI generation failed: ${message.slice(0, 500)}`,
  };
}

function limitRequests(req, res) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;

  const limit = Math.max(
    1,
    Number(process.env.GENERATION_LIMIT_PER_HOUR || 3)
  );

  const ip = String(req.ip || "unknown");

  const recent = (requestHistory.get(ip) || [])
    .filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((windowMs - (now - recent[0])) / 1000)
    );

    res.setHeader("Retry-After", String(retryAfter));

    res.status(429).json({
      error:
        "You've reached the generation limit for this hour.",
    });

    requestHistory.set(ip, recent);
    return false;
  }

  recent.push(now);
  requestHistory.set(ip, recent);

  return true;
}

async function cleanOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;

  for (const [id, job] of jobs.entries()) {
    if (job.createdAt >= cutoff) {
      continue;
    }

    jobs.delete(id);
  }

  // Keep the in-memory request limiter from growing indefinitely.
  for (const [ip, timestamps] of requestHistory.entries()) {
    const recent = timestamps.filter(
      (timestamp) => nowIsRecent(timestamp, cutoff)
    );

    if (recent.length) {
      requestHistory.set(ip, recent);
    } else {
      requestHistory.delete(ip);
    }
  }
}

function nowIsRecent(timestamp, cutoff) {
  return timestamp >= cutoff;
}

function getVideoUrl(result) {
  return (
    result?.data?.video?.url ||
    result?.data?.video_url ||
    result?.video?.url ||
    result?.video_url ||
    null
  );
}

function isTrustedFalVideoUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (
        url.hostname === "fal.media" ||
        url.hostname.endsWith(".fal.media")
      )
    );
  } catch {
    return false;
  }
}

async function generateVideo(job, input) {
  activeJobs += 1;
  job.status = "IN_PROGRESS";
  job.updatedAt = Date.now();

  try {
    const model = input.mode === "photo"
      ? IMAGE_MODEL
      : TEXT_MODEL;

    const prompt = input.style
      ? `${input.prompt}. Visual direction: ${input.style}. Use coherent composition, smooth natural motion, detailed lighting, and cinematic camera movement.`
      : input.prompt;

    const modelInput = {
      prompt,
      duration: input.duration,
      resolution: "720p",
      enable_prompt_expansion: true,
    };

    if (input.mode === "photo") {
      modelInput.image_url = input.imageData;
    } else {
      modelInput.aspect_ratio = input.aspectRatio;
    }

    console.log(
      `[VYRA] Starting ${input.mode}-to-video job ${job.id}; duration=${input.duration}s`
    );

    const result = await fal.subscribe(model, {
      input: modelInput,
      logs: true,

      onQueueUpdate(update) {
        if (update?.status) {
          console.log(
            `[VYRA] Job ${job.id}: ${update.status}`
          );
        }

        for (const entry of update?.logs || []) {
          if (entry?.message) {
            console.log(`[fal.ai] ${entry.message}`);
          }
        }
      },
    });

    const videoUrl = getVideoUrl(result);

    if (!videoUrl || !isTrustedFalVideoUrl(videoUrl)) {
      throw new Error(
        "fal.ai did not return an acceptable HTTPS video URL."
      );
    }

    job.remoteVideoUrl = videoUrl;
    job.status = "COMPLETED";
    job.error = null;
    job.errorStatus = null;
    job.updatedAt = Date.now();

    console.log(`[VYRA] Job ${job.id} completed.`);
  } catch (error) {
    const mapped = mapProviderError(error);

    job.status = "FAILED";
    job.error = mapped.error;
    job.errorStatus = mapped.status;
    job.updatedAt = Date.now();

    // Never log authorization headers or the secret key.
    console.error(
      `[VYRA] Job ${job.id} failed (${mapped.status}): ${mapped.error}`
    );
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "VYRA AI API",
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
    supportedDurations: ALLOWED_DURATIONS,
  });
});

app.post("/api/generate", async (req, res) => {
  await cleanOldJobs();

  if (!isConfigured()) {
    return res.status(503).json({
      error:
        "AI generation is not configured. Add FAL_KEY to Render Environment.",
    });
  }

  const prompt = String(req.body?.prompt || "").trim();
  const mode = parseMode(req.body?.mode);
  const duration = parseDuration(req.body || {});

  const aspectRatio = parseAspectRatio(
    req.body?.aspectRatio ??
    req.body?.aspect_ratio ??
    req.body?.ratio
  );

  const style = String(
    req.body?.style || "Cinematic"
  ).trim().slice(0, 80);

  if (!prompt) {
    return res.status(400).json({
      error: "A prompt is required.",
    });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error:
        `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
    });
  }

  if (duration === null) {
    return res.status(400).json({
      error: "Duration must be 5, 10, or 15 seconds.",
    });
  }

  let imageData = "";

  if (mode === "photo") {
    try {
      imageData = getImageInput(req.body?.imageData);
    } catch (error) {
      return res.status(400).json({
        error: error.message,
      });
    }
  }

  if (activeJobs >= MAX_ACTIVE_JOBS) {
    return res.status(429).json({
      error:
        "Another video is being generated. Please wait.",
    });
  }

  if (!limitRequests(req, res)) {
    return;
  }

  const id = crypto.randomUUID();

  const job = {
    id,
    status: "IN_QUEUE",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    remoteVideoUrl: null,
    error: null,
    errorStatus: null,
  };

  jobs.set(id, job);

  const input = {
    prompt,
    mode,
    duration,
    aspectRatio,
    style,
    imageData,
  };

  // Start the long-running generation without blocking this response.
  generateVideo(job, input).catch((error) => {
    const mapped = mapProviderError(error);

    job.status = "FAILED";
    job.error = mapped.error;
    job.errorStatus = mapped.status;
    job.updatedAt = Date.now();
  });

  return res.status(202).json({
    jobId: id,
    modelId: mode === "photo"
      ? "fal-image-video"
      : "fal-text-video",
    initialStatus: "IN_QUEUE",
  });
});

app.get("/api/generate/:id", (req, res) => {
  const job = jobs.get(String(req.params.id || ""));

  if (!job) {
    return res.status(404).json({
      error:
        "Generation job not found. Please submit a new request.",
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

  const base = PUBLIC_API_URL ||
    `${req.protocol}://${req.get("host")}`;

  return res.json({
    status: "COMPLETED",
    requestId: job.id,
    videoUrl: `${base}/api/videos/${job.id}`,
  });
});

app.get("/api/videos/:id", async (req, res) => {
  const job = jobs.get(String(req.params.id || ""));

  if (!job || job.status !== "COMPLETED" || !job.remoteVideoUrl) {
    return res.status(404).json({
      error:
        "Video not found. It may have expired or the server restarted.",
    });
  }

  // Validate again before redirecting to the provider's video.
  if (!isTrustedFalVideoUrl(job.remoteVideoUrl)) {
    return res.status(502).json({
      error: "The generated video URL is not valid.",
    });
  }

  res.setHeader("Cache-Control", "private, max-age=300");

  // Video playback and download happen directly from the fal.ai
  // video file URL. No persistent disk is required on Render.
  return res.redirect(302, job.remoteVideoUrl);
});

app.use((error, _req, res, _next) => {
  console.error(
    "[VYRA] Server error:",
    error?.message || "Unknown server error"
  );

  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      error:
        "Request too large. Choose an image smaller than 8 MB.",
    });
  }

  if (String(error?.message || "").includes("Origin not allowed")) {
    return res.status(403).json({
      error:
        "This website is not permitted to use the VYRA API.",
    });
  }

  return res.status(500).json({
    error:
      "Unexpected backend error. Check the Render logs.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("VYRA AI BACKEND STARTED");
  console.log(`Port: ${PORT}`);
  console.log("Health: /api/health");
  console.log(`fal.ai key configured: ${isConfigured()}`);
  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);
  console.log("Supported durations: 5, 10, 15 seconds");
});
