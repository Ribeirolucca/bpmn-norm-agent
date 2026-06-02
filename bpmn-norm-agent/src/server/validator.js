import { BpmnModdle } from "bpmn-moddle";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  ignoreDeclaration: false,
  preserveOrder: false
});

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function localName(name) {
  return String(name || "").split(":").pop();
}

function walk(value, visitor, parentKey = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("@_")) continue;
    if (Array.isArray(child)) {
      child.forEach((item) => {
        visitor(key, item, parentKey);
        walk(item, visitor, key);
      });
    } else if (child && typeof child === "object") {
      visitor(key, child, parentKey);
      walk(child, visitor, key);
    }
  }
}

export async function validateBpmnXml(xml) {
  const errors = [];
  const warnings = [];

  if (!xml || typeof xml !== "string") {
    return { ok: false, errors: ["bpmnXml vazio ou ausente."], warnings };
  }

  if (!xml.includes("<bpmn:definitions") && !xml.includes("<definitions")) {
    errors.push("O XML deve iniciar em bpmn:definitions/definitions.");
  }

  try {
    const moddle = new BpmnModdle();
    await moddle.fromXML(xml);
  } catch (error) {
    errors.push(`Parser BPMN falhou: ${error.message}`);
  }

  let doc;
  try {
    doc = parser.parse(xml);
  } catch (error) {
    errors.push(`XML invalido: ${error.message}`);
    return { ok: false, errors, warnings };
  }

  const definitionsKey = Object.keys(doc).find((key) => localName(key) === "definitions");
  const definitions = definitionsKey ? doc[definitionsKey] : undefined;
  if (!definitions) {
    errors.push("Elemento definitions nao encontrado.");
    return { ok: false, errors, warnings };
  }

  const requiredNamespaces = ["xmlns:bpmn", "xmlns:bpmndi", "xmlns:dc", "xmlns:di"];
  for (const ns of requiredNamespaces) {
    if (!definitions[`@_${ns}`]) errors.push(`Namespace obrigatorio ausente: ${ns}.`);
  }

  const ids = new Set();
  const nodeIds = new Set();
  const sequenceFlows = [];
  const shapes = [];
  const edges = [];
  const flowNodeNames = new Set([
    "startEvent",
    "endEvent",
    "intermediateCatchEvent",
    "intermediateThrowEvent",
    "boundaryEvent",
    "task",
    "userTask",
    "serviceTask",
    "manualTask",
    "businessRuleTask",
    "scriptTask",
    "sendTask",
    "receiveTask",
    "exclusiveGateway",
    "parallelGateway",
    "inclusiveGateway",
    "eventBasedGateway",
    "subProcess",
    "callActivity"
  ]);

  walk(definitions, (key, value) => {
    if (!value || typeof value !== "object") return;
    const type = localName(key);
    const id = value["@_id"];
    if (id) {
      if (ids.has(id)) errors.push(`ID duplicado: ${id}.`);
      ids.add(id);
    }
    if (flowNodeNames.has(type) && id) nodeIds.add(id);
    if (type === "sequenceFlow") sequenceFlows.push(value);
    if (type === "BPMNShape") shapes.push(value);
    if (type === "BPMNEdge") edges.push(value);
  });

  const processes = Object.entries(definitions)
    .filter(([key]) => localName(key) === "process")
    .flatMap(([, value]) => arrayify(value));
  if (!processes.length) errors.push("Nenhum bpmn:process encontrado.");

  const hasStart = [...nodeIds].some((id) => /start/i.test(id)) || xml.includes("startEvent");
  const hasEnd = [...nodeIds].some((id) => /end/i.test(id)) || xml.includes("endEvent");
  if (!hasStart) warnings.push("Nenhum startEvent encontrado.");
  if (!hasEnd) warnings.push("Nenhum endEvent encontrado.");

  for (const flow of sequenceFlows) {
    if (!flow["@_sourceRef"] || !flow["@_targetRef"]) {
      errors.push(`SequenceFlow ${flow["@_id"] || "(sem id)"} sem sourceRef ou targetRef.`);
      continue;
    }
    if (!nodeIds.has(flow["@_sourceRef"])) errors.push(`sourceRef inexistente: ${flow["@_sourceRef"]}.`);
    if (!nodeIds.has(flow["@_targetRef"])) errors.push(`targetRef inexistente: ${flow["@_targetRef"]}.`);
  }

  const flowIds = new Set(sequenceFlows.map((flow) => flow["@_id"]).filter(Boolean));
  if (!shapes.length) errors.push("BPMNDI ausente: nenhum BPMNShape encontrado.");
  if (sequenceFlows.length && !edges.length) errors.push("BPMNDI incompleto: nenhum BPMNEdge para sequenceFlow.");

  for (const shape of shapes) {
    const ref = shape["@_bpmnElement"];
    if (!ref) errors.push(`BPMNShape ${shape["@_id"] || "(sem id)"} sem bpmnElement.`);
    if (ref && !ids.has(ref)) errors.push(`BPMNShape referencia elemento inexistente: ${ref}.`);
  }

  for (const edge of edges) {
    const ref = edge["@_bpmnElement"];
    if (!ref) errors.push(`BPMNEdge ${edge["@_id"] || "(sem id)"} sem bpmnElement.`);
    if (ref && !flowIds.has(ref)) warnings.push(`BPMNEdge referencia algo que nao e sequenceFlow local: ${ref}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
