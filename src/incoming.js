const fs = require("fs");
const path = require("path");

const INCOMING_DIR = path.join(__dirname, "..", "incoming");
const PH_TIMEZONE = "Asia/Manila";

/**
 * Pages that pull captions from incoming/<pageKey>.json instead of prompts.json.
 */
const INCOMING_PAGE_KEYS = new Set(["bbm", "sarah", "dds", "phnews", "dnl"]);

function usesIncomingContent(pageKey, pageConfig = {}) {
  if (pageConfig && pageConfig.contentSource === "incoming") return true;
  if (pageConfig && pageConfig.contentSource === "schedule") return false;
  return INCOMING_PAGE_KEYS.has(pageKey);
}

function getPhilippineDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
    weekday: "long",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;

  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    weekday: get("weekday").toLowerCase(),
  };
}

/**
 * Map PH hour to incoming period label used in keys like 2026-09-06-morning.
 * Morning covers the current ~11:30 AM PH daily run as well.
 */
function resolveIncomingPeriod(hour) {
  if (hour < 15) return "morning";
  return "evening";
}

function incomingFilePath(pageKey) {
  return path.join(INCOMING_DIR, `${pageKey}.json`);
}

/**
 * Normalize one post object from incoming JSON.
 */
function normalizeIncomingPost(raw, sourceKey) {
  if (!raw || typeof raw !== "object") return null;
  const caption = raw.caption != null ? String(raw.caption).trim() : "";
  if (!caption) return null;

  const mediaType = String(raw.media_type || raw.mediaType || "text")
    .trim()
    .toLowerCase();

  return {
    sourceKey,
    caption,
    mediaType,
    mediaUrl: raw.media_url || raw.mediaUrl || null,
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    raw,
  };
}

/**
 * Load incoming/<pageKey>.json and pick the best post for "now" in PH time.
 *
 * Supported shapes:
 * 1) { "2026-09-06-morning": { caption, media_type, ... }, ... }
 * 2) { caption, media_type, ... }  // single post file
 */
function loadIncomingPost(pageKey, date = new Date()) {
  const filePath = incomingFilePath(pageKey);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Page "${pageKey}" expects incoming content at ${filePath}, but the file is missing.`
    );
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { dateStr, hour } = getPhilippineDateParts(date);
  const period = resolveIncomingPeriod(hour);

  // Flat single-post file
  if (data && typeof data === "object" && data.caption && !Object.keys(data).some((k) => /^\d{4}-\d{2}-\d{2}-/.test(k))) {
    const post = normalizeIncomingPost(data, path.basename(filePath));
    if (!post) {
      throw new Error(`Incoming file for "${pageKey}" has no caption.`);
    }
    console.log(`[${pageKey}] Incoming (flat file) → ${post.sourceKey}`);
    return post;
  }

  const keys = Object.keys(data || {});
  if (keys.length === 0) {
    throw new Error(`Incoming file for "${pageKey}" is empty: ${filePath}`);
  }

  const preferred = [
    `${dateStr}-${period}`,
    `${dateStr}-morning`,
    `${dateStr}-evening`,
    `${dateStr}-midday`,
    `${dateStr}-noon`,
  ];

  for (const key of preferred) {
    if (data[key]) {
      const post = normalizeIncomingPost(data[key], key);
      if (post) {
        console.log(`[${pageKey}] Incoming → ${key}`);
        return post;
      }
    }
  }

  // Fallback: newest key for this period, then newest key overall
  const sorted = keys
    .filter((k) => /^\d{4}-\d{2}-\d{2}-/.test(k))
    .sort()
    .reverse();

  const periodMatch = sorted.find((k) => k.endsWith(`-${period}`));
  const fallbackKey = periodMatch || sorted[0] || keys[0];
  const post = normalizeIncomingPost(data[fallbackKey], fallbackKey);
  if (!post) {
    throw new Error(
      `Page "${pageKey}": no usable caption in ${filePath}. Tried today=${dateStr}-${period}. Keys: ${keys.join(", ")}`
    );
  }

  console.log(
    `[${pageKey}] Incoming fallback → ${fallbackKey} (no exact ${dateStr}-${period})`
  );
  return post;
}

module.exports = {
  INCOMING_DIR,
  INCOMING_PAGE_KEYS,
  usesIncomingContent,
  loadIncomingPost,
  getPhilippineDateParts,
  resolveIncomingPeriod,
};
