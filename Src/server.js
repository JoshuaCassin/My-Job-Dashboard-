import express from "express";
import { google } from "googleapis";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "Jobs";
const APP_TITLE = process.env.APP_TITLE || "JobDeck";
const READ_ONLY = String(process.env.READ_ONLY || "false").toLowerCase() === "true";

const DEFAULT_EDITABLE_HEADERS = [
  "Fit", "Applied", "Status", "Contact", "Last update", "Follow-up",
  "Interview", "Notes", "Rank", "Priority", "Work model",
  "Why it ranks here", "Cover letter draft", "Resume version draft",
  "Content validation"
];

const EDITABLE_HEADERS = new Set(
  (process.env.EDITABLE_HEADERS || DEFAULT_EDITABLE_HEADERS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean)
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getCredentials() {
  const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let privateKey = requireEnv("GOOGLE_PRIVATE_KEY");
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { client_email: clientEmail, private_key: privateKey };
}

function createSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function columnLetter(index) {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function normalizeRow(headers, values, sheetRow) {
  const row = { _sheetRow: sheetRow };
  headers.forEach((header, index) => {
    if (header) row[header] = values[index] ?? "";
  });
  return row;
}

async function readJobs() {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is not configured.");
  const sheets = createSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_TAB.replaceAll("'", "''")}'!A:ZZ`
  });
  const values = response.data.values || [];
  if (!values.length) return { headers: [], jobs: [] };
  const headers = values[0].map((v) => String(v ?? "").trim());
  const jobs = values.slice(1)
    .map((row, index) => normalizeRow(headers, row, index + 2))
    .filter((row) => Object.entries(row).some(([key, value]) => key !== "_sheetRow" && String(value).trim() !== ""));
  return { headers, jobs };
}

async function updateJob(sheetRow, updates, expected = {}) {
  if (READ_ONLY) throw new Error("This JobDeck instance is read-only.");
  if (!Number.isInteger(sheetRow) || sheetRow < 2) throw new Error("Invalid sheet row.");
  const { headers, jobs } = await readJobs();
  const current = jobs.find((job) => job._sheetRow === sheetRow);
  if (!current) throw new Error("The spreadsheet row no longer exists. Refresh before saving.");
  if (expected.Company && String(current.Company || "") !== String(expected.Company)) {
    throw new Error("This row changed in the spreadsheet. Refresh before saving so JobDeck does not edit the wrong job.");
  }
  if (expected.Role && String(current.Role || "") !== String(expected.Role)) {
    throw new Error("This row changed in the spreadsheet. Refresh before saving so JobDeck does not edit the wrong job.");
  }
  const entries = Object.entries(updates || {}).filter(([header]) => EDITABLE_HEADERS.has(header));
  if (!entries.length) throw new Error("No editable fields were supplied.");
  const data = entries.map(([header, value]) => {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error(`Column "${header}" was not found in the sheet.`);
    return {
      range: `'${SHEET_TAB.replaceAll("'", "''")}'!${columnLetter(index)}${sheetRow}`,
      values: [[value ?? ""]]
    };
  });
  const sheets = createSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "RAW", data }
  });
  return { updated: entries.map(([header]) => header) };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));

app.get("/api/config", (_req, res) => {
  res.json({ title: APP_TITLE, sheetTab: SHEET_TAB, readOnly: READ_ONLY, editableHeaders: [...EDITABLE_HEADERS] });
});

app.get("/api/health", async (_req, res) => {
  try {
    const { jobs } = await readJobs();
    res.json({ ok: true, jobs: jobs.length, sheetTab: SHEET_TAB });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/jobs", async (_req, res) => {
  try {
    const data = await readJobs();
    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/jobs/:sheetRow", async (req, res) => {
  try {
    const result = await updateJob(Number(req.params.sheetRow), req.body?.updates, req.body?.expected);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/render-markdown", (req, res) => {
  const markdown = String(req.body?.markdown || "");
  const rawHtml = marked.parse(markdown, { gfm: true, breaks: false });
  const html = sanitizeHtml(rawHtml, {
    allowedTags: ["p", "br", "strong", "em", "del", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "code", "pre", "hr", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
    allowedSchemes: ["http", "https", "mailto"]
  });
  res.json({ html });
});

app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`${APP_TITLE} listening on port ${PORT}`));
