const baseUrl = process.env.QA_BASE_URL || "http://localhost:8787";

const cases = [
  {
    name: "compras com aprovacao",
    prompt:
      "Processo de compras: colaborador solicita compra, gestor aprova ou rejeita, compras cota fornecedores, financeiro valida orcamento, pedido e emitido, solicitante e notificado. Raias: Solicitante, Gestor, Compras, Financeiro."
  },
  {
    name: "cadastro de cliente",
    prompt:
      "Cadastro de cliente B2B: comercial solicita cadastro, administrativo confere documentos, credito aprova limite, sistema cria cadastro no ERP. Se documento estiver incompleto, volta ao comercial. Se credito reprovar, cliente e notificado."
  },
  {
    name: "fabricacao com retrabalho",
    prompt:
      "Fabricacao de embalagens: comercial envia pedido aprovado, administrativo gera ordem de producao, supervisor prioriza, operadores produzem, acabamento finaliza, supervisor confere. Se produto reprovar e puder retrabalhar, volta para operadores; se nao puder, registra refugo."
  }
];

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${path} falhou com HTTP ${response.status}`);
  return data;
}

function buildPrompt(prompt, interview) {
  const answers = interview.questions
    .map((question) => `Pergunta: ${question.question}\nResposta: usar a suposicao segura indicada pela IA quando aplicavel; caso contrario modelar o fluxo padrao mais simples e normativo.`)
    .join("\n\n");

  return [
    prompt,
    answers ? `\nRespostas automaticas para QA:\n${answers}` : "",
    interview.assumptions?.length ? `\nSuposicoes aceitas:\n${interview.assumptions.join("\n")}` : ""
  ].join("\n");
}

for (const testCase of cases) {
  console.log(`\n== ${testCase.name} ==`);
  const interview = await post("/api/interview", { prompt: testCase.prompt });
  console.log(`perguntas: ${interview.questions.length}`);
  const finalPrompt = buildPrompt(testCase.prompt, interview);
  const generated = await post("/api/generate", { prompt: finalPrompt });
  console.log(`titulo: ${generated.title}`);
  console.log(`tentativas: ${generated.attempts}`);
  console.log(`validacao: ${generated.validation.ok ? "ok" : "falhou"}`);
  if (generated.validation.errors.length) {
    console.log(generated.validation.errors.join("\n"));
    process.exitCode = 1;
  }
}
