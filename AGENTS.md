# AGENTS.md — OpenCode Model Router

## Propósito

Um único gerenciador de quotas/fallback, extensível a qualquer modelo do catálogo OpenCode V2, com painel OpenChamber e prioridade por agente.

## Regras obrigatórias

1. Preserve a sessão e a solicitação original. Nunca envie `continue`, reenvie ferramentas ou faça replay automático de prompts para compensar falhas sem uma prova forte de idempotência do host.
2. Nunca capture, copie, persista ou registre tokens OAuth, cookies, API keys, prompts, corpos completos de erro nem headers alheios a quotas.
3. Captura de quotas é passiva; no caso Codex, consulta RPC `account/rateLimits/read` só após 429 identificado sem reset e com opt-in explícito. Não execute `codex exec /status`.
4. Fallbacks pagos são proibidos por padrão. `subscriptionModels` deve ser uma exceção opt-in, e a interface deve avisar que preço no catálogo não identifica OAuth com segurança.
5. Cooldowns globais devem distinguir modelo, provedor e conta. Não marque um provedor inteiro por um 429 genérico quando não houver evidência de quota compartilhada.
6. Não altere hooks de ferramentas, contexto, compactação ou prompts: respeite Context Mode e outros plugins. Para Oh My OpenCode Slim, documente a necessidade de desligar apenas seu `foreground-fallback`/`fallback.enabled`.
7. Trate modelos/variantes/agentes como dados dinâmicos do OpenCode; nunca invente um ID nem presuma a duração de uma janela chamada `primary` ou `secondary`.
8. Use JavaScript ESM sem framework de runtime; a UI deve ser distribuída como IIFE compatível com o SDK oficial OpenChamber.
9. Preserve opções desconhecidas de configuração durante edições pela UI sempre que possível, para não apagar futuras extensões do esquema.
10. Antes de qualquer alteração execute a revisão de hooks oficiais do OpenCode V2; após mudanças rode `npm run check`. Testes nunca devem gastar quotas em CI.
11. Mantenha `README.md`, `AGENTS.md` e `.agents/` atualizados com decisões, riscos e procedimentos de rollback.
12. Não prometa recuperação após reinício enquanto não existir checkpoint durável, controle de cancelamento e idempotência de efeitos colaterais.

## Módulos

- `src/limits.js`: parsers puros de erros, headers e cooldowns.
- `src/status.js`: consulta opcional ao Codex app-server.
- `src/config.js`: schema permissivo normalizado, arquivo de configuração e estado do catálogo.
- `src/router.js`: máquina de estados e escolha por agente.
- `src/index.js`: hooks do OpenCode V2, eventos e timers.
- `panel/source.js`, `panel/index.html`, `panel/style.css`: UI da extensão.
- `panel/main.js`: bundle IIFE versionado.
- `test/`: simulações determinísticas e testes de integração por mock.

## Critérios de aceite

- Um 429 Claudinio com `Resets in 3126s` bloqueia o provedor por aproximadamente 3131s.
- Codex respeita a janela esgotada de reset **mais tardio** e troca de modelo quando há fallback elegível.
- O plugin nunca cria prompts sozinho nem provoca cobranças por sondagem de disponibilidade.
- O fallback pode ser diferente por agente, e um modelo desabilitado não é selecionado em cadeia alguma.
- A recuperação não interrompe streaming; uma troca manual cancela a promoção automática quando habilitado.
- A UI escreve configuração no servidor e o plugin a recarrega sem reinicializar a sessão.
- `npm run check` passa e o bundle contém todas as dependências de UI.

## Escopo ainda não concluído

Retomada automática de turns após reinício do host e validação fim a fim com instâncias reais de OpenCode/OpenChamber/Oh My OpenCode Slim/Context Mode. Ver `.agents/roadmap.md`; não ocultar essas limitações.
