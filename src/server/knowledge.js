import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../knowledge");

const files = {
  bpmn20: "BPMN20.xsd",
  semantic: "Semantic.xsd",
  bpmndi: "BPMNDI.xsd",
  di: "DI.xsd",
  dc: "DC.xsd",
  bpmnCmof: "BPMN20.cmof.txt",
  bpmndiCmof: "BPMNDI.cmof.txt"
};

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function collect(pattern, source, limit = 120) {
  return [...source.matchAll(pattern)].map((match) => match[1]).slice(0, limit);
}

export function loadBpmnKnowledge() {
  const semantic = read(files.semantic);
  const bpmndi = read(files.bpmndi);
  const bpmn20 = read(files.bpmn20);
  const bpmnCmof = read(files.bpmnCmof);

  const elements = collect(/<xsd:element[^>]+name="([^"]+)"/g, semantic, 160);
  const complexTypes = collect(/<xsd:complexType[^>]+name="([^"]+)"/g, semantic, 160);
  const diElements = collect(/<xsd:element[^>]+name="([^"]+)"/g, bpmndi, 80);
  const imports = collect(/schemaLocation="([^"]+)"/g, bpmn20, 20);

  return {
    sourceFiles: Object.values(files),
    normSummary: [
      "Use XML BPMN 2.0 rooted at bpmn:definitions.",
      "Declare at least bpmn, bpmndi, dc, di, xsi namespaces.",
      "Every FlowNode must have a unique id and must be contained by exactly one process or subProcess.",
      "SequenceFlow sourceRef and targetRef must point to existing flow nodes in the same process scope.",
      "Use BPMNDI for a visible diagram: bpmndi:BPMNDiagram, BPMNPlane, BPMNShape, BPMNEdge, dc:Bounds and di:waypoint.",
      "Layout must be presentation-grade: use A3/A2 horizontal scale, left-to-right flow, lanes sized to fit labels, orthogonal BPMNEdge waypoints, enough spacing between nodes, and avoid long diagonal crossings.",
      "Never reuse old X positions for later phases. A later business phase may move to another lane, but it must keep advancing to the right instead of jumping back to the left.",
      "Place the final inspection and final approval visually after production/acabamento, not back near the beginning of the diagram.",
      "All outgoing sequence flows from gateways must have visible names such as Sim, Nao, Maquina, Acabamento, Aprovado or Reprovado.",
      "Do not overdraw data artifacts. In the main diagram, prefer one DataStore for the main system and at most 1-3 critical DataObjects.",
      "Connect the main DataStore only to key system-touching tasks; avoid a spider web of dotted associations.",
      "Separate exceptions visually above or below the main path. Keep the main path central and readable.",
      "For large processes, group related work in subprocesses and keep each lane visually scanable instead of compressing every task into a narrow row.",
      "BPMNShape bpmnElement must reference an existing BPMN element.",
      "BPMNEdge bpmnElement must reference an existing sequenceFlow or messageFlow.",
      "Use startEvent and endEvent unless the user explicitly asks for an event subprocess, choreography, or collaboration-only model.",
      "Use exclusiveGateway for mutually exclusive alternatives, parallelGateway for AND-split/join, inclusiveGateway only when multiple optional branches can be active.",
      "Use laneSet/lane when roles are relevant, and participant/collaboration only when multiple pools or organizations are relevant.",
      "Avoid informal element names; prefer BPMN standard element names and attributes from the schema.",
      "The output must be importable by BPMN tools, with semantic elements and diagram interchange kept in sync."
    ],
    schemaImports: imports,
    semanticElements: elements,
    semanticTypes: complexTypes,
    diagramElements: diElements,
    schemaExcerpt: semantic.slice(0, 12000),
    cmofExcerpt: bpmnCmof.slice(0, 12000)
  };
}

export function buildSystemPrompt() {
  const knowledge = loadBpmnKnowledge();
  return `Voce e um especialista em BPMN 2.0. Gere BPMN XML estritamente conforme os arquivos normativos locais: ${knowledge.sourceFiles.join(", ")}.

Regras obrigatorias:
${knowledge.normSummary.map((item) => `- ${item}`).join("\n")}

Elementos semanticos reconhecidos no Semantic.xsd, amostra: ${knowledge.semanticElements.join(", ")}.
Tipos semanticos reconhecidos no Semantic.xsd, amostra: ${knowledge.semanticTypes.join(", ")}.
Elementos BPMNDI reconhecidos no BPMNDI.xsd, amostra: ${knowledge.diagramElements.join(", ")}.
Imports do BPMN20.xsd: ${knowledge.schemaImports.join(", ")}.

Voce deve responder somente JSON valido:
{
  "title": "nome curto do diagrama",
  "bpmnXml": "XML BPMN 2.0 completo, com DI visivel",
  "checklist": ["checagens normativas realizadas"],
  "notes": ["observacoes curtas, sem desculpas"]
}

Regras visuais de rejeicao:
- Se uma sequenceFlow normal voltar muito para a esquerda, reorganize o layout.
- Se uma BPMNEdge tiver diagonal longa, troque por waypoints ortogonais.
- Se houver gateways sem nomes nas saidas, adicione nomes visiveis nas sequenceFlows.
- Se houver mais de 4 artefatos de dados visuais, remova os nao essenciais do desenho principal.
- Se o resultado parecer um layout automatico comprimido, gere um diagrama mais largo em vez de tentar caber na tela.

Nunca use markdown. Nunca omita BPMNDI. Nunca invente elementos fora dos namespaces BPMN 2.0.`;
}
