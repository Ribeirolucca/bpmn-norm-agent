import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBpmn, interviewProcess } from "./openaiAgent.js";
import { validateBpmnXml } from "./validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) });
});

app.post("/api/generate", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (prompt.length < 12) {
      res.status(400).json({ error: "Descreva o processo com pelo menos 12 caracteres." });
      return;
    }
    const result = await generateBpmn({ prompt });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/interview", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (prompt.length < 12) {
      res.status(400).json({ error: "Descreva o processo com pelo menos 12 caracteres." });
      return;
    }
    const result = await interviewProcess({ prompt });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/validate", async (req, res) => {
  try {
    res.json(await validateBpmnXml(req.body?.bpmnXml));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const dist = path.resolve(__dirname, "../../dist");
app.use(express.static(dist));
app.use((_req, res, next) => {
  const index = path.join(dist, "index.html");
  res.sendFile(index, (error) => {
    if (error) next();
  });
});

app.listen(port, () => {
  console.log(`BPMN Norm Agent API em http://localhost:${port}`);
});
