const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || "v21.0";

/**
 * Uploads a local image file to a Facebook Page as a published photo post.
 */
async function postToFacebook({ filePath, caption }) {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!pageId) throw new Error("Missing FB_PAGE_ID environment variable.");
  if (!accessToken) throw new Error("Missing FB_PAGE_ACCESS_TOKEN environment variable.");

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`;

  const form = new FormData();
  form.append("source", fs.createReadStream(filePath));
  form.append("caption", caption || "");
  form.append("access_token", accessToken);
  form.append("published", "true");

  console.log("Uploading image to Facebook Page...");

  const response = await axios.post(url, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000,
  });

  console.log("Facebook API response:", response.data);
  return response.data;
}

module.exports = { postToFacebook };
