const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const HF_TOKEN = process.env.HF_TOKEN || "";
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

// Change these values through backend environment variables if needed.
const TEXT_MODEL =
  process.env.HF_TEXT_MODEL || "Wan-AI/Wan2.2-TI2V-5B";

const IMAGE_MODEL =
  process.env.HF_IMAGE_MODEL || "Lightricks/LTX-Video";

const PROVIDER = process.env.HF_PROVIDER || "fal-ai";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || true,
  })
);

app.use(express.json({ limit: "16mb" }));

// Job state is stored in memory. A production multi-instance deployment
// should use persistent job storage and object storage for completed videos.
const jobs = new Map();
let activeJobs = 0;
let clientPromise;

function getClient() {
  if (!HF_TOKEN) {
    throw new Error("HF_TOKEN_MISSING");
  }

  if (!clientPromise) {
    clientPromise = import("@huggingface/inference").then(
      ({ InferenceClient }) => new InferenceClient(HF_TOKEN)
    );
  }

  return clientPromise;
}

function publicBase(req) {
  return PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
}

function safeError(error) {
  const raw = String(
    error?.message || error || "Unknown provider error"
  );

  if (raw === "HF_TOKEN_MISSING") {
    return {
      status: 503,
      message:
        "Real video generation is not configured. Add a Hugging Face token with Inference Providers permission to the backend HF_TOKEN secret. VYRA will not substitute a sample clip.",
    };
  }

  if (
    /credit|balance|billing|payment required|quota|exhausted/i.test(raw)
  ) {
    return {
      status: 402,
      message:
        "The hosted AI provider reports that available credits or quota are insufficient. VYRA will not charge a card automatically or return a fake video. Check the provider's available credits.",
    };
  }

  if (
    /unauthorized|invalid.*token|authentication|forbidden|401|403/i.test(
      raw
    )
  ) {
    return {
      status: 502,
      message:
        "The provider rejected the token or its permissions. Check that HF_TOKEN is valid and has Inference Providers permission.",
    };
  }

  if (/rate.?limit|429|too many requests/i.test(raw)) {
    return {
      status: 429,
      message:
        "The AI provider is busy or rate-limiting requests. Wait and try again.",
    };
  }

  if (
    /model.*not.*found|not supported|no provider|provider.*not/i.test(raw)
  ) {
    return {
      status: 502,
      message:
        "The selected model is not currently available through the configured provider. Check the model/provider mapping or try again later.",
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

  const ext =
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
    type: `image/${ext}`,
  });
}

async function createVideo(job, input) {
  activeJobs += 1;
  job.status = "IN_PROGRESS";
  job.updatedAt = Date.now();

  try {
    const client = await getClient();
    let videoBlob;

    if (input.mode === "photo") {
      const image = imageToBlob(input.imageData);

      videoBlob = await client.imageTextToVideo({
        image,
        prompt: input.prompt,
        model: IMAGE_MODEL,
        provider: PROVIDER,
      });
    } else {
      videoBlob = await client.textToVideo({
        inputs: input.prompt,
        model: TEXT_MODEL,
        provider: PROVIDER,
      });
    }

    if (!videoBlob || typeof videoBlob.arrayBuffer !== "function") {
      throw new Error("The provider returned no video bytes.");
    }

    const videoBuffer = Buffer.from(
      await videoBlob.arrayBuffer()
    );

    if (!videoBuffer.length) {
      throw new Error("The provider returned an empty video file.");
    }

    if (videoBuffer.length > 250 * 1024 * 1024) {
      throw new Error("Generated video exceeds the 250 MB limit.");
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
  } catch (error) {
    const mapped = safeError(error);

    job.status = "FAILED";
    job.error = mapped.message;
    job.errorStatus = mapped.status;

    console.error(`[VYRA job ${job.id}]`, mapped.message);
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
    provider: "Hugging Face Inference Providers",
    configured: Boolean(HF_TOKEN),
    model: {
      textToVideo: TEXT_MODEL,
      imageToVideo: IMAGE_MODEL,
      provider: PROVIDER,
    },
    generationEnabled: Boolean(HF_TOKEN),
    note: HF_TOKEN
      ? "Token configured; provider credits and model availability are checked at request time."
      : "Set HF_TOKEN in the backend environment. No sample video will be returned.",
  });
});

app.post("/api/prompt/preview", (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();

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
    if (!HF_TOKEN) {
      return res.status(503).json({
        error:
          "VYRA's AI engine is not configured. Add a Hugging Face token to the backend HF_TOKEN secret. You do not need a fal.ai key for this code, but actual video generation requires provider access and available credits.",
      });
    }

    const prompt = String(req.body?.prompt || "").trim();

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
        error: "Prompt is too long. Keep it under 1,800 characters.",
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
    }).catch((error) => {
      job.status = "FAILED";
      job.error = safeError(error).message;
      job.updatedAt = Date.now();
    });

    return res.status(202).json({
      jobId: id,
      modelId: mode === "photo" ? "hf-image-video" : "hf-text-video",
      initialStatus: "IN_QUEUE",
      message:
        "VYRA submitted the real generation request to the hosted video model.",
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
      error: job.error || "The AI provider failed this job.",
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
    videoUrl: `${publicBase(req)}/api/videos/${job.id}`,
    requestId: job.id,
  });
});

app.get("/api/videos/:id", async (req, res) => {
  const job = jobs.get(
    String(req.params.id || "")
  );

  if (!job || job.status !== "COMPLETED" || !job.filePath) {
    return res.status(404).json({
      error:
        "Video not found or this server's temporary video storage has been reset.",
    });
  }

  try {
    await fs.access(job.filePath);

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
      error:
        "Video file has expired or is unavailable. Generate it again.",
    });
  }
});

// Remove job records and output files older than six hours.
setInterval(async () => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;

  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff && job.status !== "IN_PROGRESS") {
      if (job.filePath) {
        await fs.rm(job.filePath, { force: true }).catch(() => {});
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
      error: "Request is too large. Choose a smaller image.",
    });
  }

  return res.status(500).json({
    error: "Unexpected server error. Check the backend logs.",
  });
});

app.listen(PORT, () => {
  console.log(`\nVYRA AI API listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(
    `Provider: Hugging Face Inference Providers (${PROVIDER})`
  );
  console.log(`Token configured: ${Boolean(HF_TOKEN)}`);
  console.log(
    "Videos are temporary on this server; use object storage for durable production storage."
  );
});