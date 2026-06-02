import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import BpmnJS from "bpmn-js/lib/Viewer";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileCheck2,
  FileUp,
  Focus,
  Maximize2,
  Minimize2,
  Wand2,
  Loader2,
  MessagesSquare,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "./styles.css";

type Validation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  visualQuality?: {
    ok: boolean;
    score: number;
    issues: Array<{
      severity: string;
      type: string;
      message: string;
    }>;
  };
};

type GenerateResult = {
  title: string;
  bpmnXml: string;
  checklist: string[];
  notes: string[];
  validation: Validation;
  attempts: number;
  model: string;
};

type InterviewQuestion = {
  id: string;
  question: string;
  reason: string;
};

type InterviewResult = {
  questions: InterviewQuestion[];
  assumptions: string[];
  readyWithoutAnswers: boolean;
  model: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string }; isFinal?: boolean }; length: number } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const defaultPrompt =
  "Modele o processo de solicitacao de compras: colaborador abre pedido, gestor aprova ou rejeita, compras cota fornecedores, financeiro valida orcamento, pedido e emitido e o solicitante e notificado.";
const storageKey = "bpmn-norm-agent-draft-v1";

type SavedDraft = {
  prompt?: string;
  interview?: InterviewResult | null;
  answers?: Record<string, string>;
  result?: GenerateResult | null;
};

function loadDraft(): SavedDraft {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function downloadXml(xml: string, title: string) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title || "bpmn-gerado"}.bpmn`.replace(/[^\w.-]+/g, "-");
  link.click();
  URL.revokeObjectURL(url);
}

function getSpeechRecognition() {
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

function buildFinalPrompt(prompt: string, interview: InterviewResult | null, answers: Record<string, string>) {
  if (!interview?.questions.length) return prompt;
  const answeredQuestions = interview.questions
    .map((question) => {
      const answer = answers[question.id]?.trim();
      if (!answer) return "";
      return `Pergunta: ${question.question}\nResposta: ${answer}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    prompt,
    answeredQuestions ? `\nRespostas da entrevista BPMN:\n${answeredQuestions}` : "",
    interview.assumptions.length ? `\nSuposicoes permitidas se algo continuar indefinido:\n${interview.assumptions.join("\n")}` : ""
  ].join("\n");
}

function App() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<BpmnJS | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef<SavedDraft>(loadDraft());
  const [prompt, setPrompt] = useState(draftRef.current.prompt || defaultPrompt);
  const [result, setResult] = useState<GenerateResult | null>(draftRef.current.result || null);
  const [interview, setInterview] = useState<InterviewResult | null>(draftRef.current.interview || null);
  const [answers, setAnswers] = useState<Record<string, string>>(draftRef.current.answers || {});
  const [status, setStatus] = useState("Pronto");
  const [loading, setLoading] = useState(false);
  const [improving, setImproving] = useState(false);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const canGenerate = Boolean(interview) && !interviewLoading;

  useEffect(() => {
    if (!canvasRef.current) return;
    viewerRef.current = new BpmnJS({ container: canvasRef.current });
    return () => viewerRef.current?.destroy();
  }, []);

  useEffect(() => {
    async function renderDiagram() {
      if (!result?.bpmnXml || !viewerRef.current) return;
      try {
        await viewerRef.current.importXML(result.bpmnXml);
        viewerRef.current.get("canvas").zoom("fit-viewport", "auto");
      } catch (renderError) {
        setError(renderError instanceof Error ? renderError.message : "Falha ao renderizar BPMN.");
      }
    }
    renderDiagram();
  }, [result]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ prompt, interview, answers, result }));
  }, [prompt, interview, answers, result]);

  function toggleListening() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setError("Reconhecimento de voz nao esta disponivel neste navegador.");
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) transcript += event.results[index][0].transcript;
      }
      if (!transcript.trim()) return;
      setPrompt((current) => {
        const base = current.trim();
        return `${base}${base ? " " : ""}${transcript.trim()}`.trim();
      });
    };
    recognition.onerror = (event) => {
      setError(`Falha no audio: ${event.error}`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setStatus("Ouvindo audio...");
  }

  async function askQuestions() {
    setInterviewLoading(true);
    setError("");
    setStatus("Analisando lacunas do processo...");
    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao preparar perguntas.");
      setInterview(data);
      setAnswers({});
      setStatus(data.questions?.length ? "Perguntas prontas para resposta" : "Analise concluida");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao preparar perguntas.");
      setStatus("Erro");
    } finally {
      setInterviewLoading(false);
    }
  }

  async function generate() {
    if (!interview) {
      setStatus("Analise o processo antes de gerar");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("Gerando BPMN e validando contra regras normativas...");
    try {
      const finalPrompt = buildFinalPrompt(prompt, interview, answers);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao gerar BPMN.");
      setResult(data);
      setStatus(data.validation?.ok && data.validation?.visualQuality?.ok ? "BPMN validado e visualmente aprovado" : "BPMN gerado com pendencias");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao gerar BPMN.");
      setStatus("Erro");
    } finally {
      setLoading(false);
    }
  }

  async function improveLayout() {
    if (!result?.bpmnXml) return;
    setImproving(true);
    setError("");
    setStatus("Melhorando layout visual do BPMN...");
    try {
      const response = await fetch("/api/improve-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpmnXml: result.bpmnXml })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao melhorar layout.");
      setResult(data);
      setStatus(data.validation?.visualQuality?.ok ? "Layout visual aprovado" : "Layout melhorado com pendencias");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao melhorar layout.");
      setStatus("Erro");
    } finally {
      setImproving(false);
    }
  }

  async function copyXml() {
    if (!result?.bpmnXml) return;
    await navigator.clipboard.writeText(result.bpmnXml);
    setStatus("XML copiado");
  }

  function fitDiagram() {
    viewerRef.current?.get("canvas").zoom("fit-viewport", "auto");
  }

  function changeZoom(delta: number) {
    const canvas = viewerRef.current?.get("canvas") as { zoom: (value?: number | string, center?: unknown) => number } | undefined;
    if (!canvas) return;
    const current = canvas.zoom();
    canvas.zoom(Math.max(0.2, Math.min(3, current + delta)), "auto");
  }

  async function exportSvg() {
    const viewer = viewerRef.current as BpmnJS & { saveSVG?: () => Promise<{ svg: string }> };
    if (!viewer?.saveSVG) return;
    const { svg } = await viewer.saveSVG();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result?.title || "diagrama-bpmn"}.svg`.replace(/[^\w.-]+/g, "-");
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importBpmnFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setStatus("Carregando BPMN...");
    const bpmnXml = await file.text();
    const response = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bpmnXml })
    });
    const validation = await response.json();
    setResult({
      title: file.name.replace(/\.(bpmn|xml)$/i, ""),
      bpmnXml,
      checklist: ["Arquivo importado para visualizacao.", "Validacao local executada."],
      notes: [],
      validation,
      attempts: 0,
      model: "importado"
    });
    setStatus(validation.ok && validation.visualQuality?.ok ? "BPMN importado e visualmente aprovado" : "BPMN importado com pendencias");
    event.target.value = "";
  }

  function clearDraft() {
    localStorage.removeItem(storageKey);
    setPrompt(defaultPrompt);
    setInterview(null);
    setAnswers({});
    setResult(null);
    setError("");
    setStatus("Rascunho limpo");
  }

  return (
    <main className="app">
      <section className="workspace">
        <aside className="panel">
          <div className="brand">
            <div className="mark"><ShieldCheck size={22} /></div>
            <div>
              <h1>BPMN Norm Agent</h1>
              <p>Fale ou escreva o processo; a IA pergunta o que falta antes de gerar.</p>
            </div>
          </div>

          <label className="field">
            <span>Processo desejado</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>

          <div className="buttonGrid">
            <button onClick={toggleListening} className={listening ? "danger" : ""}>
              {listening ? <MicOff size={17} /> : <Mic size={17} />}
              {listening ? "Parar audio" : "Falar processo"}
            </button>
            <button onClick={askQuestions} disabled={interviewLoading || loading}>
              {interviewLoading ? <Loader2 className="spin" size={17} /> : <MessagesSquare size={17} />}
              Analisar e perguntar
            </button>
          </div>

          <button className="subtle" onClick={clearDraft}>
            <RotateCcw size={16} />
            Limpar rascunho salvo
          </button>

          {interview?.questions.length ? (
            <div className="interview">
              <div className="sectionTitle">
                <MessagesSquare size={16} />
                <strong>Perguntas da IA</strong>
              </div>
              {interview.questions.map((question) => (
                <label className="question" key={question.id}>
                  <span>{question.question}</span>
                  <small>{question.reason}</small>
                  <input
                    value={answers[question.id] || ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          ) : null}

          <button className="primary" onClick={generate} disabled={loading || !canGenerate}>
            {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            Gerar BPMN com respostas
          </button>

          <div className="statusLine">
            {result?.validation?.ok ? <CheckCircle2 size={18} /> : error ? <TriangleAlert size={18} /> : <FileCheck2 size={18} />}
            <span>{status}</span>
          </div>

          {error && <p className="error">{error}</p>}

          {result && (
            <div className="meta">
              <div>
                <span>Titulo</span>
                <strong>{result.title}</strong>
              </div>
              <div>
                <span>Modelo</span>
                <strong>{result.model}</strong>
              </div>
              <div>
                <span>Tentativas</span>
                <strong>{result.attempts}</strong>
              </div>
            </div>
          )}

          {result && (
            <div className="actions">
              <button onClick={copyXml}><Clipboard size={16} /> Copiar XML</button>
              <button onClick={() => downloadXml(result.bpmnXml, result.title)}><Download size={16} /> Baixar .bpmn</button>
            </div>
          )}
        </aside>

        <section className={expanded ? "diagramArea expanded" : "diagramArea"}>
          <div className="toolbar">
            <div>
              <span className={result?.validation?.ok ? "pill ok" : "pill"}>{result?.validation?.ok ? "validado" : "aguardando"}</span>
              <strong>{result?.title || "Diagrama BPMN"}</strong>
            </div>
            <div className="viewerTools">
              <input ref={fileInputRef} className="hiddenInput" type="file" accept=".bpmn,.xml" onChange={importBpmnFile} />
              <button title="Importar BPMN" onClick={() => fileInputRef.current?.click()}><FileUp size={16} /></button>
              <button title="Diminuir zoom" onClick={() => changeZoom(-0.15)} disabled={!result}>-</button>
              <button title="Aumentar zoom" onClick={() => changeZoom(0.15)} disabled={!result}>+</button>
              <button title="Ajustar ao canvas" onClick={fitDiagram} disabled={!result}><Focus size={16} /></button>
              <button title="Exportar SVG" onClick={exportSvg} disabled={!result}><Download size={16} /></button>
              <button title="Melhorar visual" onClick={improveLayout} disabled={!result || improving}>
                {improving ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
              </button>
              <button title={expanded ? "Sair da tela cheia" : "Tela cheia"} onClick={() => setExpanded((current) => !current)}>
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <span>{result ? `${result.validation.errors.length} erros, ${result.validation.warnings.length} avisos, visual ${result.validation.visualQuality?.score ?? "-"}`
                : "sem XML carregado"}</span>
            </div>
          </div>
          <div className="canvas" ref={canvasRef} />
        </section>
      </section>

      {result && (
        <section className="details">
          <div>
            <h2>Checklist</h2>
            <ul>{result.checklist.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <h2>Validacao</h2>
            <ul>
              {result.validation.errors.map((item) => <li className="bad" key={item}>{item}</li>)}
              {result.validation.warnings.map((item) => <li className="warn" key={item}>{item}</li>)}
              {result.validation.visualQuality?.issues.map((issue) => (
                <li className={issue.severity === "high" ? "bad" : "warn"} key={issue.message}>{issue.message}</li>
              ))}
              {result.validation.ok && <li className="good">Parser BPMN e regras locais aprovados.</li>}
              {result.validation.visualQuality?.ok && <li className="good">Qualidade visual aprovada.</li>}
            </ul>
          </div>
          <div className="xmlBox">
            <h2>XML</h2>
            <pre>{result.bpmnXml}</pre>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
