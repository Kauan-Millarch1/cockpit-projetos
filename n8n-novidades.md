# Novidades do n8n — o que mudou depois que esta base foi escrita

Escrito pelo job diário do `novidades.js` a partir do feed oficial de release notes. **Toda
entrada aqui carrega a fonte**: o link do PR e a versão do n8n em que saiu. Onde este arquivo e a
`n8n-gramatica.md` discordarem, **este ganha para a versão que ele cita** — a gramática foi
conferida contra o pacote em uso, e este arquivo é o que mudou depois disso.

Nenhuma entrada aqui foi curada à mão. Se uma delas estiver errada, apague a linha: o `guid` fica
no `novidades.json` e o item não volta.

<!-- BLOCO: novidades -->

- **HTTP Request Node: Add Simplified Custom Auth generic credential** · n8n 2.34 — Nova credencial genérica "Simplified Custom Auth" para o HTTP Request node: define um template JSON com placeholders em headers, query ou body para autenticação customizada, com teste de conexão próprio contra a URL salva no template.  
  <https://github.com/n8n-io/n8n/pull/35068>
- **Cal.com Trigger Node: Fully migrate to API v2** · n8n 2.34 — O Cal.com Trigger ganha uma nova versão que usa a API v2 do Cal.com, com endpoints e autenticação de credencial diferentes da v1; workflows novos devem apontar para essa typeVersion nova, os existentes continuam na versão antiga sem mudança.  
  <https://github.com/n8n-io/n8n/pull/35055>
- **Embeddings AWS Bedrock Node: Add inference profile models and node options** · n8n 2.34 — O node Embeddings AWS Bedrock passa a listar modelos de inference profile no seletor e ganha uma coleção Options com Timeout, Max Retries e Additional Model Request Fields (JSON livre para parâmetros de Titan/Cohere), além de embeddings Cohere.  
  <https://github.com/n8n-io/n8n/pull/34991>

<!-- /BLOCO -->
