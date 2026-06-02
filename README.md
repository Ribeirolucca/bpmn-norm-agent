# BPMN Norm Agent

Agente web para criar BPMN 2.0 a partir de uma descrição em linguagem natural, usando os arquivos normativos locais em `knowledge/` como base de regras e validando o XML gerado com `bpmn-moddle` e checagens estruturais.

## O que ele faz

- Gera XML BPMN 2.0 completo via OpenAI Responses API.
- Permite ditar a descricao do processo por audio no navegador.
- Faz uma entrevista previa com perguntas de esclarecimento antes da geracao.
- Usa os XSDs/CMOFs da pasta `knowledge/` como contexto normativo.
- Exige BPMNDI para que o diagrama seja visível em ferramentas BPMN.
- Valida IDs duplicados, namespaces, `sequenceFlow`, `sourceRef`, `targetRef`, `BPMNShape` e `BPMNEdge`.
- Tenta corrigir automaticamente até 3 vezes quando a validação falha.
- Exibe o diagrama no navegador e permite copiar ou baixar `.bpmn`.
- Permite importar `.bpmn`/`.xml` para visualizacao.
- Inclui controles de zoom, ajustar ao canvas, tela cheia e exportacao para SVG.
- Calcula qualidade visual do BPMN: fluxos voltando para a esquerda, diagonais, linhas longas, gateways sem rotulo e excesso de artefatos.
- Inclui acao `Melhorar visual` para reorganizar um BPMN existente sem refazer entrevista/perguntas.
- Salva automaticamente o rascunho no navegador: descricao, perguntas, respostas e ultimo BPMN.

## Rodar localmente

```bash
npm install
copy .env.example .env
npm run build
npm run start
```

Edite `.env`:

```bash
OPENAI_API_KEY=sua_chave
OPENAI_MODEL=gpt-5.2
PORT=8787
```

Acesse:

```text
http://localhost:8787
```

## Testar sem reescrever o processo

O app salva automaticamente o estado no `localStorage` do navegador. Se voce recarregar a pagina, editar o app ou reiniciar o servidor, a descricao, perguntas, respostas e ultimo diagrama continuam disponiveis.

Para limpar tudo manualmente, use o botao `Limpar rascunho salvo`.

Tambem existe um smoke test automatizado com casos fixos:

```bash
npm run qa:smoke
```

Ele chama a entrevista e a geracao para tres processos de referencia e valida se o BPMN sai sem erros estruturais.

## Publicar com link publico

### Render

1. Crie um novo Web Service.
2. Faça upload deste projeto ou conecte um repositório Git.
3. Configure:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`
4. Em Environment, adicione:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL=gpt-5.2`
   - `PORT=10000` ou deixe o Render injetar a porta.

### Railway

1. Crie um novo projeto a partir deste diretório/repositório.
2. Adicione `OPENAI_API_KEY` nas variáveis.
3. Use `npm run build` no build e `npm run start` no start.

### Vercel

Este projeto foi feito como servidor Express. Para Vercel, use um deploy Node/Serverless adaptado ou prefira Render/Railway para publicar sem alterar estrutura.

## Observacao importante

Nenhum agente garante "perfeição" absoluta apenas por geração de IA. Este projeto reduz o risco usando a norma como contexto, saída controlada, validação BPMN e ciclo de correção. A recomendação operacional é sempre importar o `.bpmn` final na ferramenta BPMN usada pela sua equipe antes de produção.

## Audio

O botao `Falar processo` usa o reconhecimento de voz do navegador (`SpeechRecognition`/`webkitSpeechRecognition`) com idioma `pt-BR`. Em alguns navegadores ele exige HTTPS quando publicado. Se o navegador nao suportar esse recurso, o campo de texto continua funcionando normalmente.
