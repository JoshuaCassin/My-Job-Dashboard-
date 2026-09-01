# JobDeck

JobDeck is a self-hosted, mobile-first job application dashboard backed by Google Sheets.

## Design

- Google Sheets stays the source of truth.
- One container = one person/workspace.
- Multiple people = multiple instances of the same image with different `.env` files.
- Resume and cover-letter drafts remain separate raw Markdown fields.
- No database, sync engine, AI ranking, or in-app account system in v0.1.

## v0.1 features

- Mobile-first visual job cards.
- Search, filter and priority/rank sorting.
- Quick totals for active, applied, watch and draft-ready jobs.
- Job detail view.
- Safe field-by-field writes back to Google Sheets.
- Separate Resume and Cover Letter Markdown editors.
- One-tap **Copy Markdown** for each.
- Safe Markdown preview.
- Docker and Docker Compose.
- Multi-architecture GitHub build for `linux/amd64` and `linux/arm64`.

## Expected spreadsheet headers

JobDeck maps by header name rather than fixed column letters. It is designed for trackers containing headers such as:

`Company`, `Role`, `Location`, `Fit`, `Applied`, `Status`, `Salary`, `Contact`, `Last update`, `Follow-up`, `Interview`, `Notes`, `Job link`, `Rank`, `Priority`, `Work model`, `Why it ranks here`, `Posting age`, `Full job ad`, `Cover letter draft`, `Resume version draft`, `Content validation`.

Extra columns are fine.

## Google setup

1. Create/select a Google Cloud project.
2. Enable **Google Sheets API**.
3. Create a **service account**.
4. Create a JSON key for it.
5. Copy its `client_email` and `private_key` into your environment file.
6. Share the target Google Sheet with the service-account email as **Editor**.

Never commit the service-account key.

## Configure

```bash
cp .env.example .env
```

Then fill in:

```env
APP_TITLE=My JobDeck
HOST_PORT=3080
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_TAB=Jobs
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

The Sheet ID is the value between `/d/` and `/edit` in a Google Sheets URL.

## Start

```bash
docker compose up -d --build
```

The app binds to localhost by default:

```text
http://127.0.0.1:3080
```

That is intentional: put Cloudflare Tunnel / Access or another authenticated reverse proxy in front of it.

For temporary LAN-only testing, change the Compose port from:

```yaml
127.0.0.1:${HOST_PORT:-3080}:3000
```

to:

```yaml
${HOST_PORT:-3080}:3000
```

## Two people / two subdomains

Use the same code and image with two environment files:

```bash
cp .env.example .env.person1
cp .env.example .env.person2
```

Give them different titles, ports and Google Sheet IDs, then run:

```bash
docker compose --env-file .env.person1 -p person1-jobs up -d --build
docker compose --env-file .env.person2 -p person2-jobs up -d
```

Example routing:

```text
person1-jobs.example.com -> http://localhost:3080
person2-jobs.example.com -> http://localhost:3081
```

## Editable fields

Default write-enabled headers:

- Fit
- Applied
- Status
- Contact
- Last update
- Follow-up
- Interview
- Notes
- Rank
- Priority
- Work model
- Why it ranks here
- Cover letter draft
- Resume version draft
- Content validation

Override with an exact comma-separated list:

```env
EDITABLE_HEADERS=Status,Priority,Fit,Applied,Follow-up,Notes,Cover letter draft,Resume version draft
```

## Reliability choices

JobDeck v0.1 deliberately avoids local caching, optimistic writes, background sync and whole-row replacement. Each save writes only the fields in that action. If a write fails, the UI reports failure rather than pretending the data was saved.

## Health check

```text
GET /api/health
```

Healthy response:

```json
{"ok":true,"jobs":42,"sheetTab":"Jobs"}
```

## Local development

Node 20+:

```bash
npm install
cp .env.example .env
set -a
source .env
set +a
npm run dev
```

## Build

```bash
docker build -t jobdeck:local .
```

The included GitHub Actions workflow builds `linux/amd64` and `linux/arm64` and can push to GitHub Container Registry.

## Security

Recommended deployment:

1. Bind JobDeck to localhost only.
2. Publish it through Cloudflare Tunnel.
3. Protect the hostname with Cloudflare Access.
4. Give the Google service account access only to the required tracker sheet.
5. Keep all secrets outside Git.

## License

MIT.
