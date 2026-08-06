const fs = require("fs");
const path = require("path");
const { resolvePageConfig, normalizeConfig, configForEntry } = require("./pageConfig");

const PROMPTS_PATH = path.join(__dirname, "..", "prompts.json");
const PLACEHOLDER_PAGE_ID = "REPLACE_WITH_YOUR_PAGE_ID";

/**
 * Returns a usable page id, or null if missing/placeholder.
 */
function normalizePageId(value) {
  const id = value != null ? String(value).trim() : "";
  if (!id || id === PLACEHOLDER_PAGE_ID) return null;
  return id;
}

/**
 * Parse a JSON object env var like {"main":"value"}.
 * @param {string} name
 * @param {string|undefined} raw
 */
function parseJsonMap(name, raw) {
  if (!raw || !String(raw).trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${name} must be valid JSON mapping page keys to values (e.g. {"main":"..."}). ${err.message}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object like {"main":"..."}`);
  }
  return parsed;
}

/**
 * Loads page access tokens.
 *
 * Preferred (multi-page): FB_PAGE_TOKENS JSON object mapping page key → token
 *   e.g. {"main":"EAAxxx","other":"EAAyyy"}
 *
 * Legacy (single page): FB_PAGE_ACCESS_TOKEN plain string
 */
function loadTokens() {
  const map = parseJsonMap("FB_PAGE_TOKENS", process.env.FB_PAGE_TOKENS);
  if (map) return map;

  const legacy = process.env.FB_PAGE_ACCESS_TOKEN && process.env.FB_PAGE_ACCESS_TOKEN.trim();
  if (legacy) {
    return { __legacy__: legacy };
  }

  return {};
}

/**
 * Loads page IDs (keep out of git — use secrets/env).
 *
 * Preferred (multi-page): FB_PAGE_IDS JSON object mapping page key → page id
 *   e.g. {"main":"123456789","other":"987654321"}
 *
 * Legacy (single page): FB_PAGE_ID plain string
 *
 * Optional fallback: pageId field in prompts.json (not recommended if you want
 * to keep ids out of the repo).
 */
function loadPageIds() {
  const map = parseJsonMap("FB_PAGE_IDS", process.env.FB_PAGE_IDS);
  if (map) return map;

  const legacy = process.env.FB_PAGE_ID && process.env.FB_PAGE_ID.trim();
  if (legacy) {
    return { __legacy__: legacy };
  }

  return {};
}

/**
 * Resolve pageId for a page key.
 * Priority: FB_PAGE_IDS[key] → prompts.json pageId → single-page legacy FB_PAGE_ID
 */
function resolvePageId(key, pageFromFile, pageIds, enabledCount) {
  const fromEnv = normalizePageId(pageIds[key]);
  if (fromEnv) return fromEnv;

  const fromFile = normalizePageId(pageFromFile && pageFromFile.pageId);
  if (fromFile) return fromFile;

  // Single-page convenience: FB_PAGE_ID / __legacy__ works for the only page
  if (enabledCount === 1) {
    const legacy = normalizePageId(pageIds.__legacy__ || process.env.FB_PAGE_ID);
    if (legacy) return legacy;
  }

  return null;
}

/**
 * Reads prompts.json and returns the list of pages to post to.
 *
 * Multi-page shape (pageId optional in file — prefer FB_PAGE_IDS secret):
 * {
 *   "defaults": { "postType": "image", ... },
 *   "pages": {
 *     "main": {
 *       "config": { "postType": "image", "imageModel": "..." },
 *       "schedule": { "monday": [...] }
 *     }
 *   }
 * }
 *
 * Optional filter: PAGES=main,other (comma-separated keys) to run a subset.
 */
function loadPages() {
  const file = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8"));
  const tokens = loadTokens();
  const pageIds = loadPageIds();
  const legacyToken = tokens.__legacy__ || null;

  // Root-level defaults applied to every page (optional)
  let fileDefaults = {};
  if (file.defaults && typeof file.defaults === "object") {
    fileDefaults = normalizeConfig(file.defaults, "defaults");
  }

  let pages;

  if (file.pages && typeof file.pages === "object") {
    const entries = Object.entries(file.pages);
    // Count enabled first so single-page legacy FB_PAGE_ID can apply
    const enabledCount = entries.filter(
      ([, page]) => page && typeof page === "object" && page.enabled !== false
    ).length;

    pages = entries.map(([key, page]) => {
      if (!page || typeof page !== "object") {
        throw new Error(`prompts.json pages.${key} must be an object with config/schedule.`);
      }

      // Resolve page-level config now; entry-level config is merged later per slot.
      const config = resolvePageConfig({ key, config: page.config }, fileDefaults);

      return {
        key,
        pageId: resolvePageId(key, page, pageIds, enabledCount),
        accessToken: tokens[key] || null,
        schedule: page.schedule || null,
        enabled: page.enabled !== false,
        rawConfig: page.config || {},
        fileDefaults,
        config,
      };
    });
  } else if (file.schedule) {
    const config = resolvePageConfig({ key: "default", config: file.config }, fileDefaults);
    pages = [
      {
        key: "default",
        pageId: resolvePageId("default", file, pageIds, 1),
        accessToken: tokens.default || legacyToken,
        schedule: file.schedule,
        enabled: true,
        rawConfig: file.config || {},
        fileDefaults,
        config,
      },
    ];
  } else {
    throw new Error(
      'prompts.json must define either "pages" (multi-page) or a root "schedule" (legacy single page).'
    );
  }

  // Single-page convenience: fall back to legacy FB_PAGE_ACCESS_TOKEN
  const enabled = pages.filter((p) => p.enabled);
  if (enabled.length === 1) {
    if (!enabled[0].accessToken && legacyToken) {
      enabled[0].accessToken = legacyToken;
    }
    if (!enabled[0].pageId) {
      enabled[0].pageId = normalizePageId(pageIds.__legacy__ || process.env.FB_PAGE_ID);
    }
  }

  // Optional subset filter for manual runs: PAGES=main,other
  const filterRaw = process.env.PAGES && process.env.PAGES.trim();
  if (filterRaw) {
    const wanted = new Set(
      filterRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    pages = pages.filter((p) => wanted.has(p.key));
    if (pages.length === 0) {
      throw new Error(
        `PAGES=${filterRaw} matched no pages. Available keys: ${Object.keys(file.pages || { default: 1 }).join(", ")}`
      );
    }
  }

  pages = pages.filter((p) => p.enabled);

  if (pages.length === 0) {
    throw new Error("No enabled pages found in prompts.json.");
  }

  for (const page of pages) {
    if (!page.pageId) {
      throw new Error(
        `Page "${page.key}" is missing pageId. Set FB_PAGE_IDS={"${page.key}":"your_page_id"} (recommended) or legacy FB_PAGE_ID for a single page.`
      );
    }
    if (!page.accessToken) {
      throw new Error(
        `Page "${page.key}" has no access token. Add it to the FB_PAGE_TOKENS secret/env as {"${page.key}":"EAA..."}.`
      );
    }
    if (!page.schedule && !(process.env.IMAGE_PROMPT && process.env.IMAGE_PROMPT.trim())) {
      throw new Error(
        `Page "${page.key}" has no schedule in prompts.json and IMAGE_PROMPT is not set.`
      );
    }
  }

  return pages;
}

module.exports = { loadPages, loadTokens, loadPageIds, configForEntry, PROMPTS_PATH };
