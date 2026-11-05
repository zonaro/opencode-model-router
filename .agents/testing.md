# Testes e matriz de validação

## Automatizados

`npm run check` executa `node --test` e compila `panel/main.js`. Nenhum teste utiliza credenciais, APIs externas ou quota de modelo.

Casos cobertos: Claudinio parser, Codex primary/secondary e reset mais tardio, Retry-After, erro de autenticação, falha 429 genérica, prioridade global/por agente, desabilitados, modelos pagos/OAuth, modelos sem tools, fallback na mesma sessão, retorno ao melhor modelo, seleção manual.

## Testes manuais ainda necessários

1. Instalar em OpenCode V2 isolado e confirmar `setup` sem erros; catálogo/status escritos com permissões restritas.
2. Instalar no OpenChamber via URL Git; permitir três arquivos e verificar painel com tema claro/escuro.
3. Salvar prioridades globais e por agente; verificar reload sem reinício. Testar drag-and-drop, ↑/↓, desligar/ativar, busca e filtro.
4. Simular 429 Claudinio, observar troca, sem duplicar prompt ou tool call. Testar reset após janela e retorno ao modelo preferido.
5. Simular 429 Codex 5h e semanal simultâneos, verificar reset tardio e consulta app-server apenas quando habilitada e necessária.
6. Conferir Kilo, OpenRouter, Zen Free; garantir que no limite da conta o plugin não provoque retries rápidos e cobranças.
7. Executar sessão com Oh My OpenCode Slim (fallback desabilitado) e Context Mode simultaneamente; subagentes de `explore`, `oracle`, `build` e outros devem manter cada cadeia.
8. Iniciar ferramenta longa, trocar de modelo após erro, verificar ausência de efeitos colaterais duplicados.
9. Cancelar sessão durante cooldown; confirmar ausência de reativação indevida.
10. Reiniciar OpenCode; confirmar persistência somente das quotas, sem reinício automático de turns inacabados (limitação conhecida).

### Critério de bloqueio de release estável

Falha de qualquer teste de não duplicação, autorização de custos, compatibilidade com Context Mode/Slim ou preservação de sessão é bloqueadora. Não declarar “produção” apenas porque os testes simulados passaram.
