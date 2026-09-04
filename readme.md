# Ledger - Double Entry Accounting

Queria colocar em pratica o que sei sobre Ledger para aplicações financeiras, então criei isso aqui, a parte do JS deixei o mais simples possível, as funções para lidar com banco deixei bem simples, o principal era lidar com double-entry. Tudo sem AI, na unha.

Depois de fazer o endpoint POST /send, vou usar esse repo para codar os outros endpoints testando meu agent-orchestrator atualizado, então tudo além de POST /send vai ser código de AI praticamente puro, sem muita intervenção humana, só para testar o que consigo fazer com o agent-orchestrator.

## Desenvolvimento

Bom, adicionei a funcionalidade mais basica de um banking system: enviar dinheiro entre contas, e guiei o agent-orchestrator para refatorar e adicionar novas funcionalidades, como criar contas e encerrar contas, além de lidar com o side effect que encerrar uma conta gera para a transação de enviar dinheiro. Demandas que direcionei ao agent-orchestrator:

```bash
cd ./docs
```

| File                                     | Descrição                                                                 |
|------------------------------------------|---------------------------------------------------------------------------|
| 00001_wiki_account_creation.md           | Endpoint de criação de conta                                              |
| 00002_wiki_account_deactivation.md       | Endpoint de desativação de conta (conta inativa não envia/recebe)        |
| 00003_wiki_folder_structure_refactor.md  | Refatoração em camadas: controllers, usecases, repositories              |
| 00004_wiki_error_handling_refactor.md    | Erros de domínio via classes específicas + error middleware              |
| 00005_wiki_centralized_error_middleware.md | Centralização de erros no middleware (pg codes + deactivate via throw)  |
| 00006_wiki_zod_validation_layer.md       | Camada de validação com Zod (schemas por usecase + ValidationError)      |

## Adicional

Refactor manual de toda a camada de ledger para Go, desncessário escrever outrar funcionalidades (pode ser utilizado o agent-orchestrator para deixar completo).