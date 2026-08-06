const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || "v21.0";

/**
 * Allowed Facebook text_format_preset_id values for text posts.
 * One is chosen at random for every text post.
 * Note: background text posts are typically limited to ~130 characters.
 */
const TEXT_FORMAT_PRESET_IDS = [
  "1881421442117417", // Solid black
  "106018623298955", // Solid purple
  "1903718606535395", // Solid red
  "249307305544279", // Purple → red gradient
  "200521337465306", // "Fire" (background image)
  "1679248482160767", // Blue with white gradient (background image)
  "127541261450947", // Soccer green (background image)
  "143093446467972", // Blue sky (background image)
  "931584293685988", // Blue, green & aqua (background image)
  "303063890126415", // Orange → purple gradient (background image)
];

function pickRandomTextFormatPresetId() {
  const idx = Math.floor(Math.random() * TEXT_FORMAT_PRESET_IDS.length);
  return TEXT_FORMAT_PRESET_IDS[idx];
}

/**
 * Creates a text-only feed post on a Facebook Page.
 * Always attaches a random text_format_preset_id (background style).
 */
async function postTextToFacebook({
  caption,
  pageId,
  accessToken,
  link,
  published = true,
}) {
  if (!pageId) throw new Error("Missing pageId");
  if (!accessToken) throw new Error("Missing accessToken");
  if (!caption && !link) {
    throw new Error("Text post requires a caption (message) and/or link");
  }

  const textFormatPresetId = pickRandomTextFormatPresetId();

  console.log(`Creating text feed post on page ${pageId}...`);
  console.log(`Using text_format_preset_id: ${textFormatPresetId}`);

  const params = {
    message: caption || "",
    published: published !== false,
    access_token: accessToken,
    text_format_preset_id: textFormatPresetId,
  };
  if (link) params.link = link;

  const postRes = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`,
    null,
    { params, timeout: 30000 }
  );

  console.log("Text feed post created:", postRes.data);
  return postRes.data;
}

/**
 * Uploads a photo and creates a published feed post on a Facebook Page.
 *
 * @param {{
 *   filePath?: string|null,
 *   caption?: string,
 *   pageId: string,
 *   accessToken: string,
 *   postType?: "image"|"text",
 *   published?: boolean,
 *   link?: string|null,
 * }} opts
 */
async function postToFacebook({
  filePath,
  caption,
  pageId,
  accessToken,
  postType = "image",
  published = true,
  link = null,
}) {
  if (!pageId) throw new Error("Missing pageId");
  if (!accessToken) throw new Error("Missing accessToken");

  const type = (postType || "image").toLowerCase();

  if (type === "text") {
    return postTextToFacebook({
      caption,
      pageId,
      accessToken,
      link,
      published,
    });
  }

  if (type !== "image") {
    throw new Error(`Unsupported postType "${postType}". Use "image" or "text".`);
  }

  if (!filePath) {
    throw new Error('postType is "image" but no filePath was provided');
  }

  // Step 1: Upload photo as unpublished
  const form = new FormData();
  form.append("source", fs.createReadStream(filePath));
  form.append("published", "false"); // attach via feed next
  form.append("access_token", accessToken);

  console.log(`Uploading unpublished photo to page ${pageId}...`);

  const uploadRes = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`,
    form,
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 120000,
    }
  );

  const photoId = uploadRes.data.id;
  console.log("Photo uploaded. Photo ID:", photoId);

  // Step 2: Create the actual feed post using the photo
  console.log("Creating image feed post...");

  const postRes = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`,
    null,
    {
      params: {
        message: caption || "",
        attached_media: JSON.stringify([{ media_fbid: photoId }]),
        published: published !== false,
        access_token: accessToken,
      },
      timeout: 30000,
    }
  );

  console.log("Feed post created:", postRes.data);
  return postRes.data;
}

module.exports = {
  postToFacebook,
  postTextToFacebook,
  TEXT_FORMAT_PRESET_IDS,
  pickRandomTextFormatPresetId,
};
