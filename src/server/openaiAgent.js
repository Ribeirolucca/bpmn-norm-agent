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

    if (lastValidation.ok && lastValidation.visualQuality?.ok) {
      return {
        ...payload,
        validation: lastValidation,
        attempts: attempt,
        model
      };
    }

    const visualFeedback = lastValidation.visualQuality?.issues?.map((issue) => issue.message).join(" | ") || "";
    feedback = `\nA tentativa ${attempt} precisa de correcao mantendo o pedido original.
Erros estruturais: ${lastValidation.errors.join(" | ") || "nenhum"}.
Avisos: ${lastValidation.warnings.join(" | ") || "nenhum"}.
Problemas visuais: ${visualFeedback || "nenhum"}.
Se os problemas visuais incluirem fluxo voltando para a esquerda, diagonais, linha longa, gateway sem rotulo ou excesso de artefatos de dados, reorganize o BPMNDI em A3/A2 horizontal, com fluxo principal sempre avancando para a direita. Responda somente JSON valido.`;
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

export async function improveBpmnLayout({ bpmnXml, model = process.env.OPENAI_MODEL || "gpt-5.2" }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nao configurada. Copie .env.example para .env e informe sua chave.");
  }

  const originalValidation = await validateBpmnXml(bpmnXml);
  const visualIssues = originalValidation.visualQuality?.issues?.map((issue) => issue.message).join(" | ") || "nao calculado";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let feedback = "";
  let lastPayload = null;
  let lastValidation = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await client.responses.create({
      model,
      instructions: `${buildSystemPrompt()}

Tarefa especial: melhorar layout visual de um BPMN existente.
Preserve a logica de negocio, os nomes das atividades principais e as raias. Voce pode remover artefatos visuais redundantes, reduzir objetos de dados desenhados e simplificar gateways redundantes somente quando isso nao mudar a logica.

Obrigatorio:
- Reorganizar em A3/A2 horizontal.
- Fluxo principal sempre avancando da esquerda para a direita.
- Conferencia final deve ficar apos producao/acabamento, visualmente no final.
- Evitar retornos longos para a esquerda.
- Usar conectores ortogonais, sem diagonais longas.
- Nomear visualmente as saidas dos gateways.
- Reduzir teia de Data Associations.
- Responder somente JSON valido.`,
      input: [
        {
          role: "user",
          content: `Melhore o layout deste BPMN. Problemas detectados: ${visualIssues}.\n\nXML atual:\n${bpmnXml}\n\n${feedback}`
        }
      ]
    });

    const payload = extractJson(response.output_text || "");
    payload.bpmnXml = cleanXml(payload.bpmnXml);
    lastPayload = payload;
    lastValidation = await validateBpmnXml(payload.bpmnXml);

    if (lastValidation.ok && lastValidation.visualQuality?.ok) {
      return {
        ...payload,
        validation: lastValidation,
        attempts: attempt,
        model
      };
    }

    const visualFeedback = lastValidation.visualQuality?.issues?.map((issue) => issue.message).join(" | ") || "";
    feedback = `\nA tentativa ${attempt} ainda precisa melhorar. Erros: ${lastValidation.errors.join(" | ") || "nenhum"}. Problemas visuais: ${visualFeedback || "nenhum"}. Corrija sem explicar, somente JSON.`;
  }

  return {
    ...lastPayload,
    validation: lastValidation,
    attempts: 3,
    model
  };
}
