import OpenAI from "openai";
import { buildSystemPrompt } from "./knowledge.js";
import { validateBpmnXml } from "./validator.js";

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("A resposta do modelo nao contem JSON.");
  return JSON.parse(match[0]);
}

function cleanXml(xml) {
  return String(xml || "")
    .replace(/^```xml/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function generateBpmn({ prompt, model = process.env.OPENAI_MODEL || "gpt-5.2" }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nao configurada. Copie .env.example para .env e informe sua chave.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const system = buildSystemPrompt();
  let feedback = "";
  let lastPayload = null;
  let lastValidation = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await client.responses.create({
      model,
      instructions: system,
      input: [
        {
          role: "user",
          content: `Crie um BPMN 2.0 completo e visual para esta necessidade:\n${prompt}\n\n${feedback}`
        }
      ]
    });

    const payload = extractJson(response.output_text || "");
    payload.bpmnXml = cleanXml(payload.bpmnXml);
    lastPayload = payload;
    lastValidation = await validateBpmnXml(payload.bpmnXml);

    if (lastValidation.ok) {
      return {
        ...payload,
        validation: lastValidation,
        attempts: attempt,
        model
      };
    }

    feedback = `\nA tentativa ${attempt} falhou na validacao. Corrija o XML mantendo o pedido original. Erros: ${lastValidation.errors.join(" | ")}. Avisos: ${lastValidation.warnings.join(" | ")}. Responda somente JSON valido.`;
  }

  return {
    ...lastPayload,
    validation: lastValidation,
    attempts: 3,
    model
  };
}

export async function interviewProcess({ prompt, model = process.env.OPENAI_MODEL || "gpt-5.2" }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nao configurada. Copie .env.example para .env e informe sua chave.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model,
    instructions: `Voce e um analista senior de processos BPMN 2.0. Antes de gerar o diagrama, identifique lacunas que podem causar BPMN errado, ambiguo, incompleto ou fora da notacao BPMN 2.0.

Faca no maximo 6 perguntas objetivas e necessarias. Nao pergunte curiosidades. Priorize o que altera a modelagem: participantes/raias, evento inicial, evento final, decisoes e regras de roteamento, excecoes, dados/documentos, mensagens entre areas, subprocessos, tarefas humanas vs sistema e criterios de sucesso.

Se a descricao ja for suficiente para gerar um BPMN simples correto, retorne poucas perguntas ou nenhuma, mas declare suposicoes explicitas. Se houver ambiguidade relevante, readyWithoutAnswers deve ser false.

Responda somente JSON valido:
{
  "questions": [
    {
      "id": "q1",
      "question": "pergunta curta",
      "reason": "por que isso afeta o BPMN"
    }
  ],
  "assumptions": ["suposicoes seguras caso o usuario nao responda"],
  "readyWithoutAnswers": false
}`,
    input: [
      {
        role: "user",
        content: `Descricao inicial do processo:\n${prompt}`
      }
    ]
  });

  const payload = extractJson(response.output_text || "");
  return {
    questions: Array.isArray(payload.questions) ? payload.questions.slice(0, 6) : [],
    assumptions: Array.isArray(payload.assumptions) ? payload.assumptions : [],
    readyWithoutAnswers: Boolean(payload.readyWithoutAnswers),
    model
  };
}
