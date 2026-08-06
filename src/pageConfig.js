/**
 * Per-page (and optional per-slot) config.
 *
 * Config is a free-form object: known keys are validated and applied;
 * unknown keys are kept so you can extend config without code changes
 * (and wire them up later).
 *
 * Merge order (later wins):
 *   built-in defaults → prompts.json "defaults" → page.config → entry.config → env overrides
 */

const POST_TYPES = new Set(["image", "text"]);
const IMAGE_PROVIDERS = new Set(["auto", "gemini", "openai"]);

/** Built-in defaults — the full checklist of supported options. */
const BUILTIN_DEFAULTS = {
  // Posting
  postType: "image", // "image" | "text"
  published: true, // false = create as unpublished draft (when API allows)
  link: null, // optional URL for text posts

  // Image generation (ignored when postType is "text")
  imageProvider: "auto", // "auto" | "gemini" | "openai"
  imageModel: null, // null = provider default (env or hard-coded)
  imageSize: null, // OpenAI size, e.g. "1024x1024"; null = env/default
  geminiAspectRatio: "ASPECT_RATIO_ONE_BY_ONE",
  geminiImageSize: "IMAGE_SIZE_FIVE_TWELVE",

  // Scheduling (optional refinements)
  // If set to a non-empty array, only these slots run for this page, e.g. ["6am","6pm"]
  slots: null,
};

/**
 * Shallow-merge plain objects; later sources override earlier ones.
 * `undefined` / missing keys do not wipe previous values; explicit `null` does.
 */
function mergeConfigs(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value === undefined) continue;
      out[key] = value;
    }
  }
  return out;
}

/**
 * Normalize + validate known keys. Unknown keys pass through unchanged.
 * @param {object} raw
 * @param {string} label - for error messages (page key / entry)
 */
function normalizeConfig(raw, label = "config") {
  const cfg = { ...raw };

  if (cfg.postType != null) {
    const t = String(cfg.postType).trim().toLowerCase();
    if (!POST_TYPES.has(t)) {
      throw new Error(
        `${label}: invalid postType "${cfg.postType}". Use "image" or "text".`
      );
    }
    cfg.postType = t;
  }

  if (cfg.imageProvider != null) {
    const p = String(cfg.imageProvider).trim().toLowerCase();
    if (!IMAGE_PROVIDERS.has(p)) {
      throw new Error(
        `${label}: invalid imageProvider "${cfg.imageProvider}". Use "auto", "gemini", or "openai".`
      );
    }
    cfg.imageProvider = p;
  }

  if (cfg.imageModel != null && cfg.imageModel !== "") {
    cfg.imageModel = String(cfg.imageModel).trim();
  } else if (cfg.imageModel === "") {
    cfg.imageModel = null;
  }

  if (cfg.imageSize != null && cfg.imageSize !== "") {
    cfg.imageSize = String(cfg.imageSize).trim();
  } else if (cfg.imageSize === "") {
    cfg.imageSize = null;
  }

  if (cfg.published != null) {
    cfg.published = Boolean(cfg.published);
  }

  if (cfg.link != null && cfg.link !== "") {
    cfg.link = String(cfg.link).trim();
  } else if (cfg.link === "") {
    cfg.link = null;
  }

  if (cfg.slots != null) {
    if (!Array.isArray(cfg.slots)) {
      throw new Error(`${label}: slots must be an array of slot names, e.g. ["6am","12pm"].`);
    }
    cfg.slots = cfg.slots.map((s) => String(s).trim()).filter(Boolean);
    if (cfg.slots.length === 0) cfg.slots = null;
  }

  if (cfg.geminiAspectRatio != null) {
    cfg.geminiAspectRatio = String(cfg.geminiAspectRatio).trim();
  }
  if (cfg.geminiImageSize != null) {
    cfg.geminiImageSize = String(cfg.geminiImageSize).trim();
  }

  return cfg;
}

/**
 * Env vars that can override resolved config (useful for manual workflow runs).
 * Only set vars are applied.
 */
function envConfigOverrides() {
  const o = {};
  if (process.env.IMAGE_PROVIDER && process.env.IMAGE_PROVIDER.trim()) {
    o.imageProvider = process.env.IMAGE_PROVIDER.trim().toLowerCase();
  }
  if (process.env.OPENAI_IMAGE_MODEL && process.env.OPENAI_IMAGE_MODEL.trim()) {
    // Only applies when provider resolves to openai; stored as generic model override
    // if imageProvider is openai, else ignored unless page uses openai.
    o._envOpenAiModel = process.env.OPENAI_IMAGE_MODEL.trim();
  }
  if (process.env.GEMINI_IMAGE_MODEL && process.env.GEMINI_IMAGE_MODEL.trim()) {
    o._envGeminiModel = process.env.GEMINI_IMAGE_MODEL.trim();
  }
  if (process.env.OPENAI_IMAGE_SIZE && process.env.OPENAI_IMAGE_SIZE.trim()) {
    o._envOpenAiSize = process.env.OPENAI_IMAGE_SIZE.trim();
  }
  return o;
}

/**
 * Resolve final config for a page, optionally merged with a schedule entry's config.
 *
 * @param {{ key?: string, config?: object }} page
 * @param {object} [fileDefaults] - root "defaults" from prompts.json
 * @param {{ config?: object }|null} [entry] - schedule entry for this slot
 */
function resolvePageConfig(page = {}, fileDefaults = {}, entry = null) {
  const label = page.key ? `pages.${page.key}.config` : "config";
  const env = envConfigOverrides();

  const merged = mergeConfigs(
    BUILTIN_DEFAULTS,
    fileDefaults,
    page.config,
    entry && entry.config,
    // Map env provider only; model/size applied after provider is known
    env.imageProvider ? { imageProvider: env.imageProvider } : null
  );

  const cfg = normalizeConfig(merged, label);

  // Apply env model/size as soft defaults when page didn't set imageModel/imageSize
  if (!cfg.imageModel) {
    if (cfg.imageProvider === "openai" && env._envOpenAiModel) {
      cfg.imageModel = env._envOpenAiModel;
    } else if (cfg.imageProvider === "gemini" && env._envGeminiModel) {
      cfg.imageModel = env._envGeminiModel;
    } else if (cfg.imageProvider === "auto") {
      // Stash both so generateImage can pick after resolveProvider
      cfg._envOpenAiModel = env._envOpenAiModel || null;
      cfg._envGeminiModel = env._envGeminiModel || null;
    }
  }
  if (!cfg.imageSize && env._envOpenAiSize) {
    cfg.imageSize = env._envOpenAiSize;
  }

  return cfg;
}

/**
 * Resolve config for a loaded page object + optional schedule entry.
 * Uses page.rawConfig + page.fileDefaults when present (from loadPages).
 */
function configForEntry(page, entry) {
  return resolvePageConfig(
    { key: page.key, config: page.rawConfig != null ? page.rawConfig : page.config },
    page.fileDefaults || {},
    entry
  );
}

/**
 * Human-readable checklist of known config keys (for docs / logging).
 */
function describeConfigChecklist() {
  return { ...BUILTIN_DEFAULTS };
}

module.exports = {
  BUILTIN_DEFAULTS,
  POST_TYPES,
  IMAGE_PROVIDERS,
  mergeConfigs,
  normalizeConfig,
  resolvePageConfig,
  configForEntry,
  describeConfigChecklist,
};
