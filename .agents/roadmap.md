# Roadmap

## Implementado no código 0.1.0

- [x] Parser Claudinio e janelas Codex via headers.
- [x] Leitura opcional e limitada do RPC Codex app-server.
- [x] Genérico 429/Retry-After/erros 5xx.
- [x] Cadeias global e por agente, disabled list, OAuth allow-list e bloqueio de API paga.
- [x] Cooldowns persistentes, prioridade e promoção de modelo em momento seguro.
- [x] Catálogo dinâmico de agentes/modelos e painel OpenChamber com ordenação e configuração.
- [x] Testes unitários offline e build IIFE.

## Antes da primeira release estável

- [ ] Testar com OpenCode V2 real e contas autenticadas; observar HTTP, erros streaming e retry nativo.
- [ ] Verificar a ordem dos hooks ao lado de Oh My OpenCode Slim com `fallback.enabled=false`.
- [ ] Verificar Context Mode V2 em sessões longas, compactações e ferramentas.
- [ ] Testar painel no OpenChamber desktop/web: permissões, edição remota, lista completa e mudanças de tema.
- [ ] Garantir compatibilidade com agentes de background, tarefas foreground e variantes.
- [ ] Definir testes de concorrência de retries na mesma sessão e entre sessões.
- [ ] Validar aderência do manifesto SDK nas versões mínimas reais.

## Fases futuras

- [ ] Suporte a integrações de quota mais ricas para Kilo/OpenRouter/OpenCode Zen, sem sondagem de inferência.
- [ ] Adicionar adaptador Claude Code OAuth para janelas 5h/semanal quando o provedor disponibilizar dados confiáveis.
- [ ] Política de contexto mínimo por agente e compactação segura antes de mudar para modelos menores.
- [ ] Retomada durável de turn depois de restart, **somente com checkpoint idempotente e respeito ao cancelamento**.
- [ ] Painel de histórico de switches/quotas sem mensagens ou dados sensíveis.
