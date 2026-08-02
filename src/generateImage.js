const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Picks a prompt: uses IMAGE_PROMPT env var if set, otherwise rotates
 * through prompts.json based on the day of the year (so it varies daily
 * but is fully deterministic — no state needs to be stored anywhere).
 */
function pickPrompt() {
  if (process.env.IMAGE_PROMPT && process.env.IMAGE_PROMPT.trim()) {
    return process.env.IMAGE_PROMPT.trim();
  }

  const configPath = path.join(__dirname, "..", "prompts.json");
  const { prompts } = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!prompts || prompts.length === 0) {
    throw new Error("prompts.json has no prompts defined and IMAGE_PROMPT is not set.");
  }

  const startOfYear = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 0));
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86400000);
  return prompts[dayOfYear % prompts.length];
}

/**
 * Decides which provider to use.
 * - IMAGE_PROVIDER env var wins if set ("openai" or "gemini").
 * - Otherwise: prefers Gemini if GEMINI_API_KEY is set, else OpenAI if
 *   OPENAI_API_KEY is set.
 * - Errors if neither key is present.
 */
function resolveProvider() {
  const forced = (process.env.IMAGE_PROVIDER || "").trim().toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;
  if (forced) {
    throw new Error(`Unknown IMAGE_PROVIDER "${forced}". Use "openai" or "gemini".`);
  }

  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";

  throw new Error(
    "No image provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY (or both — set IMAGE_PROVIDER to force one)."
  );
}

async function generateWithOpenAI(prompt, outputDir) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1024";

  console.log(`[OpenAI] Generating image with model "${model}"`);

  const response = await axios.post(
    OPENAI_API_URL,
    { model, prompt, size, n: 1 },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  const imageData = response.data?.data?.[0];
  if (!imageData) throw new Error("OpenAI response did not contain image data.");

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `generated-${Date.now()}.png`);

  if (imageData.b64_json) {
    fs.writeFileSync(filePath, Buffer.from(imageData.b64_json, "base64"));
  } else if (imageData.url) {
    const imgResp = await axios.get(imageData.url, { responseType: "arraybuffer" });
    fs.writeFileSync(filePath, Buffer.from(imgResp.data));
  } else {
    throw new Error("OpenAI response contained neither b64_json nor url.");
  }

  return filePath;
}

async function generateWithGemini(prompt, outputDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY environment variable.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  console.log(`[Gemini] Generating image with model "${model}"`);

  const response = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        responseModalities: ["TEXT", "IMAGE"],
        "responseFormat": {
          "image": {
            "aspectRatio": "ASPECT_RATIO_ONE_BY_ONE",
            "imageSize": "IMAGE_SIZE_FIVE_TWELVE"
          }
        }
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
  );

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart) {
    throw new Error("Gemini response did not contain image data.");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "png";

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `generated-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(imagePart.inlineData.data, "base64"));

  return filePath;
}

/**
 * Generates an image and saves it to disk. Auto-selects between OpenAI and
 * Gemini based on which API key(s) are available (see resolveProvider()).
 * Returns the local file path and the prompt used.
 */
async function generateImage({ outputDir = "output" } = {}) {
  const provider = resolveProvider();
  const prompt = pickPrompt();

  console.log(`Provider: ${provider}`);
  console.log(`Prompt: ${prompt}`);

  const filePath =
    provider === "gemini"
      ? await generateWithGemini(prompt, outputDir)
      : await generateWithOpenAI(prompt, outputDir);

  console.log(`Image saved to ${filePath}`);
  return { filePath, prompt, provider };
}

module.exports = { generateImage, pickPrompt, resolveProvider };
