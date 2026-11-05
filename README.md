# OpenCode Model Router

Gerenciador de fallback por quota e prioridade, com **plugin para OpenCode V2** e **extensão visual para OpenChamber**. Modelos e provedores são descobertos da instalação ativa do OpenCode, sem IDs fixos no código.

> **Estado:** pré-lançamento `0.1.0`, com testes simulados. A troca por `retry` depende do OpenCode V2 e deve ser validada em um OpenCode/OpenChamber real antes de substituir os plugins atuais. Não há garantia de execução ininterrupta quando todos os modelos falham, o servidor encerra ou o limite interno de tentativas é atingido.

## O que funciona

- Uma única cadeia de fallback global ou uma cadeia específica para **cada agente**, incluindo agentes do **Oh My OpenCode Slim**.
- Fallback na **mesma sessão**, usando `ctx.session.switchModel` e o hook nativo `retry`, sem enviar mensagens artificiais `continue`.
- Reconhecimento específico do erro `Claudinio: Budget exceeded ... Resets in Ns`.
- Quotas Codex OAuth via headers `x-codex-*` de respostas existentes (janelas identificadas por duração, sem presumir os nomes `primary`/`secondary` como 5h/semana). Consulta opcional `codex app-server` **somente após 429 Codex reconhecido e sem reset conhecido**. Nunca lê o token OAuth.
- Quotas genéricas 429 e `Retry-After`; 408/5xx transitórios; cooldown por modelo, provedor ou grupo de conta.
- Persistência de cooldowns no storage nativo do plugin; promoção automática do modelo preferido na próxima oportunidade segura após o fim do bloqueio.
- Catálogo de modelos/agentes do OpenCode, ativação, desativação, ordenação drag-and-drop, política de pagamentos e visualização de cooldown no painel OpenChamber.
- Modelo pago por API bloqueado por padrão. Modelos OAuth/assinatura podem ser liberados explicitamente com `subscriptionModels`.
- Respeita escolhas manuais posteriores ao fallback, quando `respectManualSelection` estiver habilitado.
- Não modifica ferramentas, mensagens, hooks de compactação ou prompts do Context Mode.

## Instalação no OpenCode

```bash
git clone https://github.com/zonaro/opencode-model-router.git ~/.config/opencode/plugins/model-router
```

Em seguida, carregue o diretório local em `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["~/.config/opencode/plugins/model-router"]
}
```

O `~` pode não ser expandido na lista de plugins da sua versão: se o carregador recusar o caminho, use **o caminho absoluto** correspondente à sua pasta home. Você também pode usar `file:///caminho/absoluto/model-router` ou publicar o pacote no npm e referenciá-lo pelo nome — GitHub URL não é uma fonte de instalação documentada para `plugins` no OpenCode V2. Use **um único método** para não carregar duas cópias. O plugin roda no **servidor** OpenCode usado pelo OpenChamber; não basta instalá-lo apenas na interface. Reinicie o servidor se necessário.

### Migrando dos plugins anteriores

1. Faça backup da configuração existente.
2. Remova/desative `github:zonaro/opencode-claudinio` e `github:zonaro/opencode-codex-wait` do servidor OpenCode para não duplicar hooks.
3. Instale o Model Router e defina a ordem dos modelos.
4. Teste um 429 simulado e a recuperação. Se algo falhar, volte temporariamente aos plugins anteriores.

Não remova os repositórios antigos nem as configurações de OAuth; o Model Router não faz migração destrutiva.

## Extensão OpenChamber

Funciona nas versões web/desktop do OpenChamber que suportam `@openchamber/sdk` extensions.

1. Abra **Settings → Extensions → Add**.
2. Informe `https://github.com/zonaro/opencode-model-router.git`.
3. Autorize acesso **somente aos três arquivos** `model-router.json`, `model-router-catalog.json` e `model-router-status.json` em `~/.config/opencode/` no servidor correspondente.
4. Abra **Model Router** na barra lateral.
5. Adicione modelos descobertos, defina ordem global e por agente, ative/desative e clique em **Salvar**.

O OpenChamber usa o mesmo caminho do sistema de arquivos do servidor. Se OpenChamber e OpenCode estiverem em **hosts diferentes**, esta edição não alcançará automaticamente o plugin — configure no servidor OpenCode ou sincronize os arquivos de forma explícita. A extensão não acessa credenciais.

A extensão usa o SDK oficial, não precisa de fork do OpenChamber e entrega `panel/main.js` já compilado no repositório. Não é instalada no VS Code nem no aplicativo móvel do OpenChamber neste momento.

## Compatibilidade com Oh My OpenCode Slim e Context Mode

O Oh My OpenCode Slim **já implementa fallback próprio**. Dois hooks que trocam modelo no mesmo retry podem entrar em competição. Para usar o Model Router como gerenciador principal, ajuste **somente o fallback** do Slim, preservando seus agentes, presets e demais recursos:

```jsonc
// Em ~/.config/opencode/oh-my-opencode-slim.jsonc
{
  "fallback": { "enabled": false }
}
```

Mescle essa chave com sua configuração existente; **não substitua o arquivo inteiro**. A alternativa `disabled_hooks: ["foreground-fallback"]` também existe no Slim. O Model Router só lê a identidade do agente para selecionar a cadeia; não reescreve os presets. Se o Slim definir um modelo inicial, ele continua sendo respeitado até que haja uma falha, com `respectManualSelection: true`.

O **Context Mode** usa principalmente hooks de ferramentas e compactação. O Model Router não altera esses hooks; na coexistência, continuam independentes. Se o Context Mode da versão instalada não suportar OpenCode V2, isso exige atualização do próprio Context Mode; nosso plugin não corrige a compatibilidade dele.

O **Auto Model Routing nativo do OpenChamber** classifica novos prompts. Ele pode continuar escolhendo o modelo inicial por categoria; nosso plugin atua no fallback por erro/quotas. Se desejar que a ordem configurada substitua o modelo inicial, desligue `respectManualSelection` — evitando assim que a classificação do OpenChamber volte a escolher outro modelo em cada prompt.

## Configuração

Arquivo: `~/.config/opencode/model-router.json` (JSON, atualizado automaticamente a cada ~10 segundos).

```json
{
  "enabled": true,
  "respectManualSelection": true,
  "allowPaid": false,
  "allowTextOnlyModels": false,
  "models": [
    "openai/SEU_MODELO_CODEX",
    "claudinio/SEU_MODELO_CLAUDINIO",
    "kilo/SEU_MODELO_FREE",
    "openrouter/free"
  ],
  "subscriptionModels": ["openai/SEU_MODELO_CODEX"],
  "disabledModels": [],
  "agents": {
    "explorer": ["kilo/SEU_MODELO_FREE", "openrouter/free"],
    "oracle": ["openai/SEU_MODELO_CODEX", "openrouter/free"]
  },
  "quotaGroups": {},
  "unknownQuotaCooldownSeconds": 900,
  "safetyMarginMs": 5000,
  "maxSwitchesPerTurn": 8,
  "providers": { "codexStatusFallback": "off" }
}
```

**Os IDs acima são exemplos**, não uma configuração pronta para sua conta. Use os IDs descobertos no painel ou em `/models`. `provider/model#variant` é aceito para variantes que existam no catálogo.

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `enabled` | `true` | Liga/desliga o roteador |
| `models` | `[]` | Ordem global; vazia significa não selecionar fallbacks automaticamente |
| `agents.<nome>` | ausente | Sobrescreve a cadeia global para um agente |
| `disabledModels` | `[]` | Ignora os IDs, independentemente do agente |
| `subscriptionModels` | `[]` | Autoriza modelos pagos no catálogo quando o acesso real é por assinatura/OAuth, por decisão explícita do usuário |
| `allowPaid` | `false` | Libera modelos com preço de API (pode gerar cobranças) |
| `allowTextOnlyModels` | `false` | Permite modelos sem tool calling; normalmente inadequados para agentes de programação |
| `respectManualSelection` | `true` | Mantém a escolha manual; a cadeia atua diante de erros. Com `false`, o modelo de maior prioridade é selecionado ao admitir prompts |
| `quotaGroups` | `{}` | Mapeia IDs de modelos a uma quota compartilhada (`"provider/model": "nome-da-conta"`) |
| `unknownQuotaCooldownSeconds` | `900` | Espera conservadora quando não existe reset confiável |
| `safetyMarginMs` | `5000` | Margem após o reset conhecido |
| `maxSwitchesPerTurn` | `8` | Limite de switches por turno (o OpenCode ainda tem um teto interno de tentativas) |
| `providers.codexStatusFallback` | `"off"` | `"app-server"` habilita consulta sob demanda ao Codex CLI autenticado na **mesma conta** |

### Quotas compartilhadas

Codex OAuth, Claudinio, Kilo Free e OpenRouter Free recebem agrupamentos próprios quando reconhecidos. Para outros provedores, configure `quotaGroups` se souber que vários modelos compartilham a mesma conta. Um 429 genérico sem indicação de escopo bloqueia **apenas o modelo**, evitando desabilitar indevidamente outros modelos do mesmo provedor.

Quando um bloqueio expira, o modelo torna-se candidato de novo. Não há polling de geração: a próxima solicitação real valida disponibilidade. O próprio timer do plugin pode promover a preferência para chamadas futuras, mas nunca interrompe uma resposta em streaming para fazê-lo.

## Segurança e limitações

- **Não há garantia de continuidade infinita.** Se todos os modelos estiverem bloqueados, o plugin deixa a decisão de retry para o OpenCode; o limite interno de tentativas pode encerrar o turno.
- **Retomada de turno após reinício ainda não existe**. Os cooldowns sobrevivem, mas o plugin não reenvia mensagens ou ferramentas após reinício para evitar side effects duplicados. Esse mecanismo só deve ser habilitado quando houver suporte do host para checkpoint/idempotência; veja `.agents/roadmap.md`.
- Fallback em streaming/transportes WebSocket depende de os erros chegarem ao hook `retry` do V2; headers WebSocket não são coletados nesta versão.
- Fallback e promoção de subagentes dependem dos eventos e da implementação de retry que o host oferece. Background children, compaction e ferramentas parcialmente concluídas precisam de testes reais de integração.
- `subscriptionModels` é uma declaração de confiança feita pelo usuário. **Não** identifica automaticamente se uma conta OpenAI é OAuth ou API; se você marcar um modelo API pago como assinatura, poderá haver cobrança.
- `codex app-server` consulta a sessão local do Codex CLI, que pode ser diferente do OAuth utilizado no OpenCode. Deixe desligado se não tiver confirmado que ambas são a mesma conta.
- Quotas ausentes ou sem reset conhecido nunca são apresentadas como horários exatos.
- Nenhum token, API key, cookie, prompt ou corpo completo de resposta é gravado em arquivos de estado ou logs.

## Desenvolvimento

```bash
npm install
npm run check
```

Os testes (`node --test`) usam mocks determinísticos e não consomem quotas. O painel é compilado como IIFE com `esbuild`, pois o OpenChamber o carrega em iframe isolado. O arquivo compilado `panel/main.js` deve ser commitado para instalação via URL.

Consulte [AGENTS.md](AGENTS.md), [arquitetura](.agents/architecture.md), [testes](.agents/testing.md) e [roadmap](.agents/roadmap.md).

## Fontes

- [OpenCode V2 — plugins e hooks](https://opencode.ai/v2/docs/build/plugins/server/)
- [OpenChamber — SDK de extensões](https://docs.openchamber.dev/sdk/)
- [OpenChamber — Auto Model Routing](https://docs.openchamber.dev/auto-model-routing/)
- [Oh My OpenCode Slim — configuração de fallback](https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/docs/configuration.md)
- [Context Mode — compatibilidade](https://github.com/mksglu/context-mode)
- [Codex — app-server rate limits](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs)
