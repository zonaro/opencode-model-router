# Arquitetura e decisões

## Separação

`http.response` observa headers e mensagens de 429. O hook `retry` classifica a falha, registra cooldown persistente, escolhe o próximo modelo elegível na cadeia específica do agente (ou global), chama `session.switchModel` e altera apenas a decisão de retry nativa. A UI usa o SDK do OpenChamber para editar um JSON fora de qualquer projeto.

## Estados

Há dois escopos: `cooldowns` global/durável (por grupo de quota), e `sessions` efêmero (modelo gerenciado, escolha manual, agente e número de switches). Falhas de autenticação/faturamento não são tratadas como 429 transitório. Retentativas do host são limitadas: se nenhuma opção for elegível, o plugin não fabrica um prompt.

## Ordem e capacidades

IDs de modelos vêm de `ctx.model.list`. IDs de agentes vêm de `ctx.agent.list`. A lista global só se aplica se o agente não tiver sua própria cadeia. Modelos desabilitados, não encontrados, sem ferramentas e pagos sem autorização são ignorados. `subscriptionModels` permite declarar explicitamente acesso OAuth/assinatura apesar do custo aparente no catálogo.

## Quotas

Codex: observar `x-codex-primary-*` e `x-codex-secondary-*` e só usar reset de janela **explicitamente esgotada**; `app-server` é opt-in sob demanda. Claudinio: extrair `Resets in Ns`. Generic 429: `Retry-After` ou cooldown conservador; quota compartilhada configurável por modelo/grupo. A recuperação usa timestamps absolutos e margem de segurança.

## Concorrência

Uma sessão pode emitir chamadas de título/compactação/background. As observações de request guardam eventos `primary` quando disponíveis; outras não disparam troca no retry. `switchModel` afeta chamadas posteriores e é usado dentro do `retry` para direcionar a tentativa nativa. Todo replay manual de prompt é proibido até prova de idempotência. No futuro, adicionar bloqueio por sessão para múltiplos retries simultâneos e CAS da troca contra seleção manual.

## Plugins simultâneos

Context Mode usa hooks de ferramentas/compactação; esses hooks não são sobrescritos. O Slim possui fallback concorrente de modelos que **deve ser desativado** enquanto o Model Router gerencia falhas; outros recursos permanecem ativos. Auto Routing do OpenChamber classifica novos prompts, e o Router lida com falhas/quotas. A ordem de registro dos hooks precisa ser validada na instalação real.

## Retomada após reinício

Cooldows persistem no `ctx.storage`, não prompts pendentes. O OpenCode pode encerrar os retries em memória; a API documentada não oferece garantia de checkpoint idempotente de chamadas de ferramentas. Não implementar `setTimeout` com reenvio de mensagem de usuário: isso é inseguro. Investigar futuras APIs de durable inbox/checkpoint e eventos de cancelamento antes de ativar reidratação de turns.

## UI e deployment

Uma distribuição Git serve como plugin OpenCode V2 e extensão OpenChamber. A UI não fala com os provedores: lê catálogo/status escrito pelo plugin e grava `model-router.json` via `host.readFile/writeFile` autorizado. É intencional que a configuração seja gerida pelo **mesmo servidor** do OpenCode. `panel/main.js` é bundle IIFE para iframe do OpenChamber; nenhum CDN é necessário.
