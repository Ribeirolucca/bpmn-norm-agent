import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import BpmnJS from "bpmn-js/lib/Viewer";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileCheck2,
  Loader2,
  MessagesSquare,
  Mic,
  MicOff,
  Play,
  Send,
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
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [interview, setInterview] = useState<InterviewResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Pronto");
  const [loading, setLoading] = useState(false);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [listening, setListening] = useState(false);
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
      setStatus(data.validation?.ok ? "BPMN validado" : "BPMN gerado com pendencias");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao gerar BPMN.");
      setStatus("Erro");
    } finally {
      setLoading(false);
    }
  }

  async function copyXml() {
    if (!result?.bpmnXml) return;
    await navigator.clipboard.writeText(result.bpmnXml);
    setStatus("XML copiado");
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

        <section className="diagramArea">
          <div className="toolbar">
            <div>
              <span className={result?.validation?.ok ? "pill ok" : "pill"}>{result?.validation?.ok ? "validado" : "aguardando"}</span>
              <strong>{result?.title || "Diagrama BPMN"}</strong>
            </div>
            <span>{result ? `${result.validation.errors.length} erros, ${result.validation.warnings.length} avisos` : "sem XML carregado"}</span>
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
              {result.validation.ok && <li className="good">Parser BPMN e regras locais aprovados.</li>}
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
