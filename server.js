
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fal } = require("@fal-ai/client");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);

const FAL_KEY = String(
  process.env.FAL_KEY || process.env.HF_TOKEN || ""
).trim();

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
const VIDEO_DIR =
  process.env.VIDEO_DIR || path.join(__dirname, "generated-videos");

const MAX_ACTIVE_JOBS = Math.max(
  1,
  Number(process.env.MAX_ACTIVE_JOBS || 1)
);

const MAX_JOBS_PER_HOUR = Math.max(
  1,
  Number(process.env.GENERATION_LIMIT_PER_HOUR || 2)
);

const TEXT_MODEL =
  process.env.FAL_TEXT_MODEL || "fal-ai/wan/v2.7/text-to-video";

const IMAGE_MODEL =
  process.env.FAL_IMAGE_MODEL || "fal-ai/wan/v2.7/image-to-video";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || true,
  })
);

app.use(express.json({ limit: "16mb" }));

const jobs = new Map();
let activeJobs = 0;

function getClient() {
  if (!FAL_KEY) {
    throw new Error("FAL_KEY_MISSING");
  }

  fal.config({ credentials: FAL_KEY });
  return fal;
}

function publicBase(req) {
  return PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
}

function safeError(error) {
  const raw = String(
    error?.message || error || "Unknown provider error"
  );

  if (raw === "FAL_KEY_MISSING") {
    return {
      status: 503,
      message:
        "VYRA is not configured. Add a valid fal.ai API key as FAL_KEY.",
    };
  }

  if (
    /credit|balance|billing|payment required|quota|exhausted|insufficient funds/i.test(
      raw
    )
  ) {
    return {
      status: 402,
      message:
        "fal.ai reports insufficient credits or quota. Check your fal.ai billing and model access.",
    };
  }

  if (
    /unauthorized|invalid.*key|authentication|forbidden|\b401\b|\b403\b/i.test(
      raw
    )
  ) {
    return {
      status: 502,
      message:
        "fal.ai rejected the API key. Check your backend FAL_KEY.",
    };
  }

  if (/rate.?limit|\b429\b|too many requests/i.test(raw)) {
    return {
      status: 429,
      message:
        "fal.ai is rate-limiting requests. Wait a little and try again.",
    };
  }

  if (
    /model.*not.*found|not supported|unknown model|invalid.*model/i.test(
      raw
    )
  ) {
    return {
      status: 502,
      message:
        "The selected fal.ai model or its input settings are unavailable. Check model access and input requirements.",
    };
  }

  return {
    status: 502,
    message: `Video generation failed: ${raw.slice(0, 420)}`,
  };
}

function imageToBlob(dataUri) {
  const match =
    /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(
      dataUri || ""
    );

  if (!match) {
    throw new Error("Please upload a PNG, JPEG, or WebP image.");
  }

  const subtype =
    match[1].toLowerCase() === "jpg"
      ? "jpeg"
      : match[1].toLowerCase();

  const buffer = Buffer.from(
    match[2].replace(/\s/g, ""),
    "base64"
  );

  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error("Image must be smaller than 8 MB.");
  }

  return new Blob([buffer], {
    type: `image/${subtype}`,
  });
}

async function createVideo(job, input) {
  activeJobs += 1;
  job.status = "IN_PROGRESS";
  job.updatedAt = Date.now();

  try {
    const client = getClient();
    const isPhoto = input.mode === "photo";
    const model = isPhoto ? IMAGE_MODEL : TEXT_MODEL;

    const allowedAspectRatios = [
      "16:9",
      "9:16",
      "1:1",
      "4:3",
      "3:4",
    ];

    const aspectRatio = allowedAspectRatios.includes(
      input.aspectRatio
    )
      ? input.aspectRatio
      : "16:9";

    const allowedDurations = [5, 10, 15];

    const duration = allowedDurations.includes(
      Number(input.duration)
    )
      ? Number(input.duration)
      : 5;

    const modelInput = {
      prompt: input.prompt,
      aspect_ratio: aspectRatio,
      duration: String(duration),
      resolution: "720p",
    };

    if (isPhoto) {
      const imageBlob = imageToBlob(input.imageData);
      modelInput.image_url =
        await client.storage.upload(imageBlob);
    }

    console.log(
      `[VYRA job ${job.id}] Submitting to fal.ai: ${model}`
    );

    const result = await client.subscribe(model, {
      input: modelInput,
      logs: true,

      onQueueUpdate(update) {
        job.updatedAt = Date.now();

        if (update.status === "IN_QUEUE") {
          job.status = "IN_QUEUE";
        } else if (update.status === "IN_PROGRESS") {
          job.status = "IN_PROGRESS";
        }
      },
    });

    const videoUrl =
      result?.data?.video?.url ||
      result?.video?.url;

    if (!videoUrl || typeof videoUrl !== "string") {
      throw new Error(
        "fal.ai finished without returning a video URL."
      );
    }

    const response = await fetch(videoUrl);

    if (!response.ok) {
      throw new Error(
        `Could not download the generated video (HTTP ${response.status}).`
      );
    }

    const contentLength = Number(
      response.headers.get("content-length") || 0
    );

    if (contentLength > 250 * 1024 * 1024) {
      throw new Error(
        "Generated video exceeds the 250 MB limit."
      );
    }

    const videoBuffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (!videoBuffer.length) {
      throw new Error(
        "The provider returned an empty video file."
      );
    }

    if (videoBuffer.length > 250 * 1024 * 1024) {
      throw new Error(
        "Generated video exceeds the 250 MB limit."
      );
    }

    await fs.mkdir(VIDEO_DIR, { recursive: true });

    const filePath = path.join(
      VIDEO_DIR,
      `${job.id}.mp4`
    );

    await fs.writeFile(filePath, videoBuffer);

    job.filePath = filePath;
    job.status = "COMPLETED";
    job.completedAt = Date.now();
    job.error = null;

    console.log(
      `[VYRA job ${job.id}] Video generation completed.`
    );
  } catch (error) {
    const mapped = safeError(error);

    job.status = "FAILED";
    job.error = mapped.message;
    job.errorStatus = mapped.status;

    console.error(
      `[VYRA job ${job.id}]`,
      mapped.message
    );
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
    job.updatedAt = Date.now();
  }
}

const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: MAX_JOBS_PER_HOUR,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    error:
      "The generation allowance for this network has been reached. Please try again later.",
  },
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VYRA AI",
    provider: "fal.ai",
    configured: Boolean(FAL_KEY),

    model: {
      textToVideo: TEXT_MODEL,
      imageToVideo: IMAGE_MODEL,
    },

    generationEnabled: Boolean(FAL_KEY),

    note: FAL_KEY
      ? "fal.ai key is configured; model access and available credits are checked during generation."
      : "Set FAL_KEY in the backend environment. No sample video will be returned.",
  });
});

app.post("/api/prompt/preview", (req, res) => {
  const prompt = String(
    req.body?.prompt || ""
  ).trim();

  if (!prompt) {
    return res.status(400).json({
      error: "Enter a prompt first.",
    });
  }

  const style = String(
    req.body?.styleName || "Cinematic"
  ).slice(0, 60);

  const enhancedPrompt =
    `${prompt.slice(0, 1400)}. ` +
    `Style: ${style}. ` +
    "Cohesive subject, natural motion, deliberate camera movement, " +
    "clear composition, consistent lighting. Avoid flicker, warped " +
    "anatomy, abrupt scene cuts, and unwanted text.";

  return res.json({
    enhancedPrompt: enhancedPrompt.slice(0, 1800),
  });
});

app.post(
  "/api/generate",
  generationLimiter,
  async (req, res) => {
    if (!FAL_KEY) {
      return res.status(503).json({
        error:
          "VYRA's video engine is not configured. Add a valid fal.ai API key as FAL_KEY.",
      });
    }

    const prompt = String(
      req.body?.prompt || ""
    ).trim();

    const mode =
      req.body?.mode === "photo" ? "photo" : "text";

    const imageData =
      typeof req.body?.imageData === "string"
        ? req.body.imageData
        : "";

    if (!prompt) {
      return res.status(400).json({
        error: "Describe the video you want to create.",
      });
    }

    if (prompt.length > 1800) {
      return res.status(400).json({
        error:
          "Prompt is too long. Keep it under 1,800 characters.",
      });
    }

    if (mode === "photo" && !imageData) {
      return res.status(400).json({
        error: "Choose a starting photo first.",
      });
    }

    if (
      mode === "photo" &&
      imageData.length > 11 * 1024 * 1024
    ) {
      return res.status(413).json({
        error:
          "Image payload is too large. Select an image under 8 MB.",
      });
    }

    if (activeJobs >= MAX_ACTIVE_JOBS) {
      return res.status(429).json({
        error:
          "VYRA is generating another video right now. Please wait a moment and try again.",
      });
    }

    try {
      if (mode === "photo") {
        imageToBlob(imageData);
      }
    } catch (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    const id = crypto.randomUUID();

    const job = {
      id,
      status: "IN_QUEUE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      filePath: null,
      error: null,
    };

    jobs.set(id, job);

    createVideo(job, {
      prompt,
      mode,
      imageData,
      aspectRatio: req.body?.aspectRatio,
      duration: req.body?.duration,
    }).catch((error) => {
      const mapped = safeError(error);

      job.status = "FAILED";
      job.error = mapped.message;
      job.errorStatus = mapped.status;
      job.updatedAt = Date.now();
    });

    return res.status(202).json({
      jobId: id,
      modelId:
        mode === "photo"
          ? "fal-image-video"
          : "fal-text-video",
      initialStatus: "IN_QUEUE",
      message:
        "VYRA submitted the generation request to fal.ai.",
    });
  }
);

app.get("/api/generate/:requestId", (req, res) => {
  const job = jobs.get(
    String(req.params.requestId || "")
  );

  if (!job) {
    return res.status(404).json({
      error:
        "This generation job is no longer available. Start a new generation.",
    });
  }

  if (job.status === "FAILED") {
    return res.status(job.errorStatus || 502).json({
      status: "FAILED",
      error:
        job.error || "The AI provider failed this job.",
    });
  }

  if (job.status !== "COMPLETED") {
    return res.json({
      status: job.status,
      queuePosition: activeJobs ? 1 : null,
    });
  }

  return res.json({
    status: "COMPLETED",
    videoUrl:
      `${publicBase(req)}/api/videos/${job.id}`,
    requestId: job.id,
  });
});

app.get("/api/videos/:id", async (req, res) => {
  const job = jobs.get(
    String(req.params.id || "")
  );

  if (
    !job ||
    job.status !== "COMPLETED" ||
    !job.filePath
  ) {
    return res.status(404).json({
      error:
        "Video not found or this server's temporary video storage has been reset.",
    });
  }

  try {
    await fs.access(job.filePath);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Cache-Control",
      "private, max-age=3600"
    );

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
      error:
        "Video file has expired or is unavailable. Generate it again.",
    });
  }
});

// Remove completed/failed jobs and their files after six hours.
setInterval(async () => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;

  for (const [id, job] of jobs.entries()) {
    if (
      job.updatedAt < cutoff &&
      job.status !== "IN_PROGRESS" &&
      job.status !== "IN_QUEUE"
    ) {
      if (job.filePath) {
        await fs
          .rm(job.filePath, { force: true })
          .catch(() => {});
      }

      jobs.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

app.use((err, _req, res, _next) => {
  console.error(
    "Unhandled API error:",
    err?.message || err
  );

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error:
        "Request is too large. Choose a smaller image.",
    });
  }

  return res.status(500).json({
    error:
      "Unexpected server error. Check the backend logs.",
  });
});

app.listen(PORT, () => {
  console.log(
    `\nVYRA AI API listening on port ${PORT}`
  );

  console.log(
    `Health: http://localhost:${PORT}/api/health`
  );

  console.log("Provider: fal.ai");

  console.log(
    `fal.ai key configured: ${Boolean(FAL_KEY)}`
  );

  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);

  console.log(
    "Videos are temporarily stored on this server."
  );
});
