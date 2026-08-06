# fb-ai-poster

Generates AI images (OpenAI or Gemini) and posts them to one or more Facebook Pages on a schedule via GitHub Actions — **3× daily** (about 6am / 12pm / 6pm Philippine Time).

## How it works

1. `src/pages.js` loads every page from `prompts.json`, merges that page’s **config**, and matches **page IDs + tokens** from secrets (`FB_PAGE_IDS`, `FB_PAGE_TOKENS`).
2. For each page, `src/generateImage.js` picks today's PH-time slot. If `postType` is `image`, it generates an image with that page’s provider/model settings; if `text`, it skips generation.
3. `src/postToFacebook.js` creates either an image feed post or a text-only feed post.
4. `.github/workflows/daily-image-post.yml` runs the whole job on cron (or manually from the Actions tab).

## Multi-page setup (add a page without touching code)

Per page you need:

1. **An entry in `prompts.json`** under `pages` (`config` + `schedule` only — **no pageId in git**)
2. **Page ID** in the `FB_PAGE_IDS` secret/env
3. **Access token** in the `FB_PAGE_TOKENS` secret/env

### `prompts.json` shape

```json
{
  "defaults": {
    "postType": "image",
    "imageProvider": "auto",
    "published": true
  },
  "pages": {
    "main": {
      "config": {
        "postType": "image",
        "imageProvider": "gemini",
        "imageModel": "gemini-3.1-flash-image",
        "published": true
      },
      "schedule": {
        "monday": [
          { "slot": "6am", "prompt": "...", "caption": "..." },
          { "slot": "12pm", "prompt": "...", "caption": "..." },
          { "slot": "6pm", "prompt": "...", "caption": "..." }
        ]
      }
    },
    "quotes-only": {
      "config": {
        "postType": "text"
      },
      "schedule": {
        "monday": [
          { "slot": "6am", "caption": "Text-only post for this page." }
        ]
      }
    }
  }
}
```

- **Key** (`main`, `quotes-only`, …) is a short name you choose — it must match `FB_PAGE_IDS` and `FB_PAGE_TOKENS`.
- **`pageId` is not stored in `prompts.json`** — put it in the `FB_PAGE_IDS` secret so it never lands in git.
- **`config`** is a per-page checklist of options (see below). Root **`defaults`** apply to every page; page `config` overrides them; a schedule entry may include its own `"config"` for that slot only.
- **`schedule`** is day → slots (`6am` / `12pm` / `6pm`) with `prompt` and/or `caption`.
- Optional: `"enabled": false` on a page to skip it without deleting config.

### Per-page config checklist

Config is **dynamic**: known keys are validated and applied; any extra keys you add are kept (so you can extend later without breaking the file).

| Key | Values | Default | What it does |
|---|---|---|---|
| `postType` | `image` \| `text` | `image` | Image+caption post, or text-only feed post |
| `imageProvider` | `auto` \| `gemini` \| `openai` | `auto` | Which image API (`auto` = Gemini if key set, else OpenAI) |
| `imageModel` | model id string | provider default | e.g. `gemini-3.1-flash-image`, `gpt-image-1` |
| `imageSize` | e.g. `1024x1024` | `1024x1024` | OpenAI image size |
| `geminiAspectRatio` | Gemini enum | `ASPECT_RATIO_ONE_BY_ONE` | Gemini aspect ratio |
| `geminiImageSize` | Gemini enum | `IMAGE_SIZE_FIVE_TWELVE` | Gemini image size |
| `published` | `true` \| `false` | `true` | Publish immediately vs unpublished |
| `link` | URL string | `null` | Optional link on text posts |
| `slots` | `["6am","12pm"]` | all slots | Only run these time slots for this page |

Text posts (`postType: "text"`) automatically get a random Facebook `text_format_preset_id` (colored background). The list lives in code (`src/postToFacebook.js`), not in page config. Keep captions short (~130 chars) for background posts.

**Merge order** (later wins): built-in defaults → root `defaults` → `pages.<key>.config` → schedule entry `config` → env overrides (`IMAGE_PROVIDER`, model env vars).

**Examples**

Image page with OpenAI:

```json
"config": {
  "postType": "image",
  "imageProvider": "openai",
  "imageModel": "gpt-image-1",
  "imageSize": "1024x1024"
}
```

Text-only page:

```json
"config": { "postType": "text" }
```

One slot as text, rest as image (entry-level override):

```json
{
  "slot": "12pm",
  "caption": "Midday text blast only.",
  "config": { "postType": "text" }
}
```

### Secrets: page IDs + tokens (stay out of git)

Two JSON maps — keys must match `prompts.json` → `pages`:

**`FB_PAGE_IDS`** — page key → Facebook Page ID:

```json
{
  "main": "123456789012345",
  "quotes-only": "987654321098765"
}
```

**`FB_PAGE_TOKENS`** — page key → long-lived Page access token:

```json
{
  "main": "EAAxxxx...",
  "quotes-only": "EAAyyyy..."
}
```

**Adding a new page:**

1. Add `pages.your-key` with `config` + `schedule` in `prompts.json` and commit.
2. Update secret `FB_PAGE_IDS` with `"your-key":"page_id"`.
3. Update secret `FB_PAGE_TOKENS` with `"your-key":"token"`.

No workflow or code changes required.

### Legacy single-page env vars

Still supported if you only have one page:

| Secret | Use |
|---|---|
| `FB_PAGE_ID` | Single page ID |
| `FB_PAGE_ACCESS_TOKEN` | Single page token |

Prefer `FB_PAGE_IDS` + `FB_PAGE_TOKENS` for multi-page (and to keep IDs out of the repo).

## Choosing an image provider

You only need **one** API key for pages that use `postType: "image"`:

- Set `GEMINI_API_KEY` → Google Gemini (`gemini-3.1-flash-image` by default)
- Set `OPENAI_API_KEY` → OpenAI (`gpt-image-1` by default)
- Prefer **per-page** `config.imageProvider` / `config.imageModel` so different pages can use different models
- Global env `IMAGE_PROVIDER` still overrides all pages for a manual run

## One-time setup

### 1. Get an image API key

**Gemini:** https://aistudio.google.com/apikey  
**OpenAI:** https://platform.openai.com/api-keys  

### 2. Get a Facebook Page access token (per page)

You need a **long-lived Page access token** for each Page.

1. Create a Meta app at https://developers.facebook.com/apps (type: Business).
2. Add **Facebook Login** and **Pages API**.
3. In [Graph API Explorer](https://developers.facebook.com/tools/explorer/), generate a User token with: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
4. Exchange for a long-lived user token (`grant_type=fb_exchange_token`).
5. Call `GET /me/accounts` — each Page returns a **page id** and **page access token**.

Docs: https://developers.facebook.com/docs/pages/access-tokens

### 3. Configure `prompts.json`

Add each page’s `config` + `schedule` under `pages` (see shape above). The repo ships with one page key: `main`.  
**Do not commit page IDs or tokens** — those go in secrets only.

### 4. Add GitHub Secrets and Variables

**Settings → Secrets and variables → Actions**

**Secrets:**

| Name | Value |
|---|---|
| `FB_PAGE_IDS` | `{"main":"your_page_id"}` (add more keys as you add pages) |
| `FB_PAGE_TOKENS` | `{"main":"EAAyour_page_token"}` |
| `GEMINI_API_KEY` | Gemini key (if using Gemini) |
| `OPENAI_API_KEY` | OpenAI key (if using OpenAI) |
| `FB_PAGE_ID` | *(optional legacy)* single page id |
| `FB_PAGE_ACCESS_TOKEN` | *(optional legacy)* single page token |

**Variables (optional):**

| Name | Default |
|---|---|
| `IMAGE_PROVIDER` | auto (Gemini if both keys set) |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` |
| `OPENAI_IMAGE_SIZE` | `1024x1024` |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` |
| `IMAGE_PROMPT` | *(unset)* uses schedule; if set, same fixed prompt for all pages |
| `PAGES` | *(unset)* all pages; e.g. `main` to run only one |

### 5. Test manually

**Actions → Daily AI Image → Facebook Post → Run workflow.**  
Check logs for each page key and confirm posts on each Page.

## Local testing

```bash
npm install
cp .env.example .env   # fill in real values
npm start
```

Example `.env` multi-page snippet:

```env
GEMINI_API_KEY=...
FB_PAGE_IDS={"main":"123456789","second-page":"987654321"}
FB_PAGE_TOKENS={"main":"EAAxxx","second-page":"EAAyyy"}
```

Ensure `prompts.json` has matching `pages.main` and `pages.second-page` entries (config + schedule only).

Run only one page:

```env
PAGES=main
```

## Customizing posts

- Edit each page’s `schedule` in `prompts.json`.
- Set `IMAGE_PROMPT` to force the same image prompt for a manual run (post message falls back to that prompt text).
- Set `PAGES=key1,key2` to limit which pages run.

## Schedule

Cron in `.github/workflows/daily-image-post.yml`: `0 21,3,9 * * *` (UTC), aimed at ~6am / 12pm / 6pm PH after Actions delay. GitHub may still lag a few minutes under load.

Slot selection uses **Asia/Manila** time inside the app (not the runner’s clock):

| PH hour | Slot |
|---|---|
| 0–8 | `6am` |
| 9–14 | `12pm` |
| 15–23 | `6pm` |
