# Novidades do n8n — o que mudou depois que esta base foi escrita

Escrito pelo job diário do `novidades.js` a partir do feed oficial de release notes. **Toda
entrada aqui carrega a fonte**: o link do PR e a versão do n8n em que saiu. Onde este arquivo e a
`n8n-gramatica.md` discordarem, **este ganha para a versão que ele cita** — a gramática foi
conferida contra o pacote em uso, e este arquivo é o que mudou depois disso.

Nenhuma entrada aqui foi curada à mão. Se uma delas estiver errada, apague a linha: o `guid` fica
no `novidades.json` e o item não volta.

<!-- BLOCO: novidades -->

- **Typeform Node: Allow custom OAuth2 scopes** · n8n 2.37 — A credencial OAuth2 do Typeform ganha um toggle Custom Scopes para editar os escopos além dos três padrão do Trigger, e esses escopos custom passam a persistir ao reconectar a conta.  
  <https://github.com/n8n-io/n8n/pull/36486>
- **Microsoft SharePoint Node: Register version 2 and make it the default** · n8n 2.37 — O node Microsoft SharePoint passa a nascer em typeVersion 2 por padrão, usando Graph API com OAuth2 ou Entra service principal e resource locators de site/lista em vez dos parâmetros da v1; workflows existentes em v1 continuam sem mudança.  
  <https://github.com/n8n-io/n8n/pull/36459>
- **Deprecate the "Any workflow" caller policy** · n8n 2.37 — A opção 'This workflow can be called by → Any workflow' fica marcada como obsoleta rumo à remoção no n8n v3; evite escolher esse valor para permissão de chamada em sub-workflows novos.  
  <https://github.com/n8n-io/n8n/pull/36350>
- **Anthropic Chat Model Node: Add prompt caching support** · n8n 2.37 — O node Anthropic Chat Model (v1.6) ganha campos opcionais de prompt caching (ativar + TTL de 5min ou 1h) para reaproveitar system prompt, tools e histórico entre chamadas; vem desativado por padrão e não afeta workflows existentes.  
  <https://github.com/n8n-io/n8n/pull/34482>
- **Confluence Node: Add Page Get Comments operation** · n8n 2.38.1 — O node Confluence ganha, no resource Page, a operação Get Comments (comentários de rodapé), com paginação, Body Format (Storage/Atlas Doc/Plain Text) e Sort By/Direction; dá para trocar chamadas de comentários feitas via HTTP Request por essa operação nativa.  
  <https://github.com/n8n-io/n8n/pull/37073>
- **MongoDB Node: Batch update and find-and-update writes with bulkWrite** · n8n 2.38.1 — O MongoDB node ganha a versão 1.5 para Update e Find And Update, que passa a usar bulkWrite em vez de uma requisição por item; o resultado por item continua igual, mas quem escolher essa versão precisa prever que uma falha no meio da gravação pode deixar o banco em um estado parcial diferente do de antes.  
  <https://github.com/n8n-io/n8n/pull/37035>
- **Databricks Node: Add user-delegated OAuth2 credential (authorization code + PKCE)** · n8n 2.38.1 — A credencial OAuth2 do Databricks ganha um segundo fluxo, login de usuário via authorization code + PKCE, além do client credentials de service principal, com OAuth scopes customizáveis; workflows que precisam de permissão e auditoria por usuário devem preencher esse modo em vez do de service principal.  
  <https://github.com/n8n-io/n8n/pull/37007>
- **Gotify Node: Add Gotify extra notification settings** · n8n 2.38.1 — O node Gotify ganha três campos opcionais nas opções de mensagem — Click URL, Big Image URL e Intent URL (Android) — que só entram no payload quando preenchidos, dando para configurar essas ações de notificação direto no node.  
  <https://github.com/n8n-io/n8n/pull/23915>

- **Add snapshot option to every browser use interaction tool** · n8n 2.36 — As tools de interação do Browser Use (click, type, select, drag, hover, press, scroll, upload, dialog) ganham o parâmetro opcional snapshot para devolver o snapshot de acessibilidade na própria resposta, dispensando uma chamada separada de snapshot depois de cada ação.  
  <https://github.com/n8n-io/n8n/pull/36111>
- **MCP Server Trigger Node: Add server instructions option** · n8n 2.36 — O MCP Server Trigger ganha o campo opcional Instructions, enviado a clientes MCP na resposta de initialize; workflows existentes ficam com o campo vazio e sem mudança de comportamento.  
  <https://github.com/n8n-io/n8n/pull/35945>
- **MiniMax Node: Add M3 and H3 model support** · n8n 2.36 — O node MiniMax ganha o modelo MiniMax-M3 (agora padrão) e o MiniMax-H3 para geração de vídeo via API V2, com parâmetros próprios como duration, resolution e aspect ratio; workflows na API V1 continuam iguais.  
  <https://github.com/n8n-io/n8n/pull/35935>
- **Schedule Trigger Node: Add a per-node missed execution grace period** · n8n 2.36 — O Schedule Trigger (v1.4+) ganha o campo Missed Execution Grace Period (Seconds) por node, que sobrepõe o N8N_SCHEDULER_MISFIRE_GRACE da instância quando preenchido; valor 0 ou inválido mantém o padrão da instância.  
  <https://github.com/n8n-io/n8n/pull/35771>
- **Schedule Trigger Node: Add "If Execution Is Missed" option** · n8n 2.36 — O Schedule Trigger (v1.4, aba Settings) ganha a opção 'If Execution Is Missed' para escolher entre pular ou rodar uma vez a ocorrência perdida com a instância fora do ar; workflows existentes continuam pulando por padrão até essa opção ser escolhida.  
  <https://github.com/n8n-io/n8n/pull/35626>
- **Discord Node: Add member moderation actions** · n8n 2.36 — O resource Member do Discord node ganha as ações Ban, Unban, Kick e Timeout, com reason customizável ou preset e, em Timeout, presets de duração até 28 dias; passa a dar para moderar contas direto no fluxo sem HTTP Request.  
  <https://github.com/n8n-io/n8n/pull/33486>
- **lmChatOpenRouter Node: Add provider routing options** · n8n 2.36 — O node OpenRouter Chat Model ganha, em Options > Provider Routing, os campos order, allowFallbacks, requireParameters, dataCollection, zdr, only, ignore e sort para controlar roteamento entre sub-provedores, fallback e retenção de dados.  
  <https://github.com/n8n-io/n8n/pull/24822>

- **GitHub Node: Add timeout option to Dispatch and Wait for Completion** · n8n 2.35 — O GitHub node ganha a opção Limit Wait Time em Dispatch and Wait for Completion: ao expirar, o node segue com os dados de entrada em vez do payload do callback, então quem ativa essa opção precisa tratar esse caso downstream em vez de assumir que sempre chega o callback.  
  <https://github.com/n8n-io/n8n/pull/35837>
- **Kafka Node: Add compression options to version 2** · n8n 2.35 — A v2 do Kafka node ganha o campo Compression (None, GZIP, Snappy, LZ4, Zstd); se um Kafka Trigger em v1 consumir o mesmo tópico, ele só decodifica GZIP ou None, então workflows mistos precisam escolher a compressão pensando em quem consome.  
  <https://github.com/n8n-io/n8n/pull/35727>
- **Kafka Node: Add version 2 to send messages via the new Kafka library** · n8n 2.35 — O Kafka node ganha a v2 (lib @confluentinc/kafka-javascript em vez de kafkajs), que corrige o Acks 'all replicas' para esperar as réplicas in-sync em vez de só o líder; nodes novos podem escolher essa typeVersion, os existentes ficam na v1 sem mudança.  
  <https://github.com/n8n-io/n8n/pull/35450>
- **Enable enhanced HITL Slack/Telegram** · n8n 2.35 — Nos nodes Slack e Telegram, os parâmetros avançados de HITL (restringir quem responde, registrar quem aprovou, comportamento pós-decisão) ficam sempre visíveis, sem precisar de flag experimental, então já dá para construir com eles direto.  
  <https://github.com/n8n-io/n8n/pull/35411>
- **Slack Node: Use Real-time Search API for message search** · n8n 2.35 — O Slack node (v2.7) troca a Message Search para a Real-time Search API: 'Return All' sai, Limit passa a ter teto de 50, e entram Channel Types, filtros After/Before e Keyword Search Only; é preciso reconectar a credencial do Slack para os novos escopos antes de usar essa versão.  
  <https://github.com/n8n-io/n8n/pull/35291>
- **Salesforce Trigger Node: Add OAuth2 JWT authentication support** · n8n 2.35 — O Salesforce Trigger ganha um dropdown Authentication com OAuth2 JWT além de OAuth2, exigindo a credencial JWT correspondente quando escolhido; workflows existentes continuam em OAuth2 por padrão, sem mudança.  
  <https://github.com/n8n-io/n8n/pull/32257>

- **Allow custom OAuth scopes for Microsoft Azure Monitor, Dynamics, Graph Security and Azure Storage** · n8n 2.33 — As credenciais do Microsoft Azure Monitor, Microsoft Dynamics, Microsoft Graph Security e Azure Storage ganham um toggle Custom Scopes que libera um campo Enabled Scopes para pedir permissões OAuth além das padrão. Sem ativar o toggle, o comportamento e os campos preenchidos hoje continuam iguais.  
  <https://github.com/n8n-io/n8n/pull/34612>
- **Grist Node: Use a single Grist URL field in the credential** · n8n 2.32 — A credencial do Grist passa a usar um único campo Grist URL em vez de Plan Type, Custom Subdomain e Self-Hosted URL, e o teste de credencial agora exige acesso real a pelo menos uma organização, não só autenticação. Credenciais já salvas continuam funcionando sem precisar ser recriadas.  
  <https://github.com/n8n-io/n8n/pull/34190>

- **Brandfetch Node: Use explicit route types and simplify operations** · n8n 2.34 — O Brandfetch node ganha uma versão v2 com seletor de Type e campo Identifier em vez de um endpoint genérico, e operações reorganizadas (logos/símbolos/ícone, cores, dados completos, contexto de marca); workflows novos usam essa typeVersion, os existentes ficam na v1 sem mudança.  
  <https://github.com/n8n-io/n8n/pull/28846>
- **OpenAI Chat Model Node: Add optional extraBody option** · n8n 2.34 — O node OpenAI Chat Model ganha o campo opcional Extra Body para injetar propriedades JSON extras no corpo da requisição, útil para parâmetros específicos de APIs compatíveis como Qwen-Max ou vLLM; JSON inválido ou não-objeto é rejeitado com erro.  
  <https://github.com/n8n-io/n8n/pull/13992>
- **Microsoft Excel (SharePoint) Node: Add node for Excel workbooks in SharePoint document libraries** · n8n 2.33 — O node Microsoft Excel (SharePoint) passa a aparecer no painel de nodes com paridade completa em relação ao Excel do OneDrive, então workflows que hoje contornam isso via OneDrive ou HTTP Request podem usar esse node direto, com credencial OAuth2 ou Entra Service Principal.  
  <https://github.com/n8n-io/n8n/pull/34847>
- **Allow custom OAuth scopes for the remaining Google credentials** · n8n 2.33 — Várias credenciais Google OAuth2 (Gmail, Sheets, Drive, Docs, Contacts, Calendar e outras) ganham um toggle Custom Scopes que libera editar o campo Enabled Scopes, então workflows que precisam de permissão extra do Google podem pedir escopos além dos padrões direto na credencial.  
  <https://github.com/n8n-io/n8n/pull/34631>

- **HTTP Request Node: Add Simplified Custom Auth generic credential** · n8n 2.34 — Nova credencial genérica "Simplified Custom Auth" para o HTTP Request node: define um template JSON com placeholders em headers, query ou body para autenticação customizada, com teste de conexão próprio contra a URL salva no template.  
  <https://github.com/n8n-io/n8n/pull/35068>
- **Cal.com Trigger Node: Fully migrate to API v2** · n8n 2.34 — O Cal.com Trigger ganha uma nova versão que usa a API v2 do Cal.com, com endpoints e autenticação de credencial diferentes da v1; workflows novos devem apontar para essa typeVersion nova, os existentes continuam na versão antiga sem mudança.  
  <https://github.com/n8n-io/n8n/pull/35055>
- **Embeddings AWS Bedrock Node: Add inference profile models and node options** · n8n 2.34 — O node Embeddings AWS Bedrock passa a listar modelos de inference profile no seletor e ganha uma coleção Options com Timeout, Max Retries e Additional Model Request Fields (JSON livre para parâmetros de Titan/Cohere), além de embeddings Cohere.  
  <https://github.com/n8n-io/n8n/pull/34991>

<!-- /BLOCO -->
