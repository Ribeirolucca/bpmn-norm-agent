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

function childByLocalName(value, wantedName) {
  if (!value || typeof value !== "object") return undefined;
  const entry = Object.entries(value).find(([key]) => localName(key) === wantedName);
  return entry ? entry[1] : undefined;
}

function boundsOf(shape) {
  const bounds = childByLocalName(shape, "Bounds");
  if (!bounds || typeof bounds !== "object") return undefined;
  const x = Number(bounds["@_x"]);
  const y = Number(bounds["@_y"]);
  const width = Number(bounds["@_width"]);
  const height = Number(bounds["@_height"]);
  if ([x, y, width, height].some((number) => Number.isNaN(number))) return undefined;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function waypointsOf(edge) {
  const waypoints = arrayify(childByLocalName(edge, "waypoint"));
  return waypoints
    .map((point) => ({ x: Number(point?.["@_x"]), y: Number(point?.["@_y"]) }))
    .filter((point) => !Number.isNaN(point.x) && !Number.isNaN(point.y));
}

function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

export async function validateBpmnXml(xml) {
  const errors = [];
  const warnings = [];
  const visualIssues = [];

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
  const elementTypesById = new Map();
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
      elementTypesById.set(id, type);
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
  const flowsById = new Map(sequenceFlows.map((flow) => [flow["@_id"], flow]));
  if (!shapes.length) errors.push("BPMNDI ausente: nenhum BPMNShape encontrado.");
  if (sequenceFlows.length && !edges.length) errors.push("BPMNDI incompleto: nenhum BPMNEdge para sequenceFlow.");

  const boundsByElement = new Map();
  for (const shape of shapes) {
    const ref = shape["@_bpmnElement"];
    if (!ref) errors.push(`BPMNShape ${shape["@_id"] || "(sem id)"} sem bpmnElement.`);
    if (ref && !ids.has(ref)) errors.push(`BPMNShape referencia elemento inexistente: ${ref}.`);
    const bounds = boundsOf(shape);
    if (ref && bounds) boundsByElement.set(ref, bounds);
  }

  for (const edge of edges) {
    const ref = edge["@_bpmnElement"];
    if (!ref) errors.push(`BPMNEdge ${edge["@_id"] || "(sem id)"} sem bpmnElement.`);
    if (ref && !flowIds.has(ref)) warnings.push(`BPMNEdge referencia algo que nao e sequenceFlow local: ${ref}.`);
  }

  for (const flow of sequenceFlows) {
    const sourceBounds = boundsByElement.get(flow["@_sourceRef"]);
    const targetBounds = boundsByElement.get(flow["@_targetRef"]);
    if (sourceBounds && targetBounds && targetBounds.cx < sourceBounds.cx - 120) {
      visualIssues.push({
        severity: "high",
        type: "backward-flow",
        message: `Fluxo ${flow["@_id"]} volta muito para a esquerda (${flow["@_sourceRef"]} -> ${flow["@_targetRef"]}).`
      });
    }

    const sourceType = elementTypesById.get(flow["@_sourceRef"]);
    if (sourceType && sourceType.endsWith("Gateway") && !String(flow["@_name"] || "").trim()) {
      visualIssues.push({
        severity: "medium",
        type: "unlabeled-gateway-output",
        message: `Saida de gateway sem rotulo visual: ${flow["@_id"]}. Use Sim/Nao ou nome da condicao.`
      });
    }
  }

  for (const edge of edges) {
    const ref = edge["@_bpmnElement"];
    const points = waypointsOf(edge);
    if (!flowIds.has(ref) || points.length < 2) continue;
    const diagonalSegments = points.slice(1).filter((point, index) => {
      const previous = points[index];
      return Math.abs(point.x - previous.x) > 4 && Math.abs(point.y - previous.y) > 4;
    });
    if (diagonalSegments.length) {
      visualIssues.push({
        severity: "high",
        type: "diagonal-edge",
        message: `BPMNEdge ${edge["@_id"] || ref} tem segmentos diagonais; use conectores ortogonais.`
      });
    }
    const length = pathLength(points);
    if (length > 900) {
      visualIssues.push({
        severity: "medium",
        type: "long-edge",
        message: `BPMNEdge ${edge["@_id"] || ref} e longa demais (${Math.round(length)}px); reposicione as atividades.`
      });
    }
  }

  const dataObjectShapeCount = shapes.filter((shape) => {
    const type = elementTypesById.get(shape["@_bpmnElement"]);
    return type === "dataObjectReference" || type === "dataStoreReference";
  }).length;
  if (dataObjectShapeCount > 4) {
    visualIssues.push({
      severity: "medium",
      type: "too-many-data-artifacts",
      message: `Excesso de artefatos de dados desenhados (${dataObjectShapeCount}); mantenha so os essenciais no diagrama principal.`
    });
  }

  const severeVisualIssues = visualIssues.filter((issue) => issue.severity === "high").length;
  const visualScore = Math.max(0, 100 - severeVisualIssues * 25 - (visualIssues.length - severeVisualIssues) * 8);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    visualQuality: {
      ok: severeVisualIssues === 0 && visualScore >= 80,
      score: visualScore,
      issues: visualIssues
    }
  };
}
