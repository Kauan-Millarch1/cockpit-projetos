# Entrega — o que falta no login do Cockpit, e só quem tem autorização faz

**Para:** André
**De:** Kauan (escrito em 25/08/2026)
**Projeto Supabase:** `Cockpit` — `<SEU-PROJECT-REF>`
**Projeto Google Cloud:** `Cockpit` — cliente OAuth `980575373646-3dk6rtfcqbfdeg543ccsdglo070u3h8d`

O login está **funcionando** — banco, rotas, tela, cargos e aprovação estão prontos e
medidos. O que falta são três coisas que dependem de autorização que o Kauan não tem:
**SMTP**, **DNS** e **publicar o app no Google**.

Nenhuma delas exige tocar em código. Depois que você fizer, nada precisa ser
reimplantado — o cockpit lê tudo isso do Supabase e do Google em tempo de execução.

---

## 0. Antes de começar: o que JÁ está feito

Para você não refazer nem desconfiar:

| feito | onde |
|---|---|
| 5 migrations aplicadas (perfis, convites, organizações, cargos, presença) | `supabase/migrations/` |
| RLS ligada nas 3 tabelas, `get_advisors` de segurança **limpo** | Supabase |
| Provider Google **ligado**, Client ID e Secret colados | Supabase → Auth → Providers |
| Redirect URLs `http://localhost:4317/**` e `http://127.0.0.1:4317/**` | Supabase → Auth → URL Configuration |
| URI de redirecionamento `https://<SEU-PROJECT-REF>.supabase.co/auth/v1/callback` | Google Cloud → Clientes |
| Escopos `openid`, `userinfo.email`, `userinfo.profile` (todos **não sensíveis**) | Google Cloud → Acesso a dados |
| Domínio autorizado `<SEU-PROJECT-REF>.supabase.co` | Google Cloud → Branding |

**Não apague nada disso.** Em particular, o URI de redirecionamento do cliente OAuth:
sem ele o login com Google para de funcionar imediatamente e o erro
(`redirect_uri_mismatch`) não diz o que falta.

---

## 1. SMTP — este é o bloqueio de verdade

### O problema, medido

O Supabase tem um servidor de e-mail embutido que a documentação dele chama de
**apenas para teste**. Ele foi medido no ar em 25/08/2026:

```
POST /auth/v1/otp
→ 429 {"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}
```

São poucos e-mails por hora e **o teto é do projeto inteiro, não por pessoa**. Na
prática: duas pessoas se cadastram na mesma hora e a terceira não recebe link nenhum.

Isso não é um detalhe de conforto. **O token que chega no e-mail É a credencial do
Cockpit** — não existe senha. Sem e-mail saindo, ninguém entra a não ser pelo Google.

### O que fazer

Qualquer SMTP serve. A recomendação é **Resend** por ser o mais rápido de ligar
(3.000 e-mails/mês grátis, sem cartão), mas Amazon SES, Postmark ou o relay do Google
Workspace funcionam igual — o Supabase só quer host, porta, usuário e senha.

**1.1** Crie a conta e gere uma **API key**.

**1.2** Supabase → **Authentication → Emails → SMTP Settings** → ligue *Enable Custom
SMTP*:

```
Host:          smtp.resend.com
Port:          465
Username:      resend
Password:      <a API key>
Sender email:  nao-responda@ecommercepuro.com.br
Sender name:   Cockpit
```

**1.3** Supabase → **Authentication → Rate Limits** → suba *"Rate limit for sending
emails"*. Com SMTP próprio esse número deixa de precisar ser o de teste. Sugestão de
partida: 30 por hora — é folgado para o uso previsto e ainda barra um laço maluco.

### O que NÃO fazer

- Não use uma conta pessoal de Gmail como remetente. Além do limite baixo, o e-mail
  chega como pessoa física num fluxo de acesso a sistema, o que é o formato exato de
  um phishing.
- Não deixe o remetente com o domínio de teste do provedor em produção. Funciona, mas
  a pessoa recebe um convite de acesso vindo de um domínio que não é o da empresa.

---

## 2. DNS — para o remetente ser `@ecommercepuro.com.br`

Sem isto o e-mail sai, mas de um domínio que não é seu, e uma parte dele cai no spam.

O provedor de SMTP mostra os registros exatos depois que você adiciona o domínio.
São três, e o nome de cada um vem dele — **não invente os valores**:

- **SPF** (`TXT` na raiz) — diz que aquele servidor pode mandar e-mail em nome do
  domínio. Se já existe um SPF, **acrescente ao existente**, não crie um segundo:
  dois registros SPF invalidam os dois.
- **DKIM** (`TXT` num subdomínio tipo `resend._domainkey`) — a assinatura.
- **DMARC** (`TXT` em `_dmarc`), se ainda não houver — a política. Comece em
  `p=none` para observar antes de rejeitar.

Depois de propagar, o painel do provedor mostra o domínio como verificado. Só aí
mude o *Sender email* no Supabase.

---

## 3. Google — publicar o app

### O estado hoje, medido

O app OAuth está em **"Testando"**. Nesse status, **só quem estiver na lista
"Usuários de teste" consegue logar com Google** — teto de 100, cadastrada à mão no
Google Cloud. Hoje só o Kauan está lá.

Consequência: uma pessoa de fora que clique em *Continuar com Google* é barrada
**pelo Google**, antes de chegar em qualquer tela nossa. Ela não vê "aguardando
aprovação"; ela vê "Acesso bloqueado".

### O que falta para publicar

O botão *Publicar app* está desabilitado porque faltam dois links reais em
**Google Cloud → Branding → Domínio do app**:

- **Página inicial do aplicativo**
- **Link da Política de Privacidade**

As duas precisam existir de verdade e responder — **o Google clica**. Depois de
preenchê-las, adicione `ecommercepuro.com.br` como segundo **domínio autorizado**,
senão o Google recusa os links.

Feito isso: **Público-alvo → Publicar app**. Com apenas escopos não sensíveis (que é
o caso), **não vai para fila de verificação** — publica na hora.

### O que NÃO fazer

- **Não suba logotipo.** O próprio painel avisa: subir logo manda o app para
  verificação de marca, que é fila de semanas. Sem logo, sem fila.
- **Não adicione escopo nenhum além dos três que já estão lá.** Qualquer escopo
  sensível (Gmail, Drive, Calendar) joga o app na verificação e trava tudo.

---

## 4. Uma escolha que é sua, e não é bloqueio

O token pode chegar de duas formas, e o Supabase faz as duas pelo mesmo endpoint —
muda só o **template do e-mail** (Authentication → Emails):

- **Link para clicar** — é o que está no ar hoje (`{{ .ConfirmationURL }}`).
- **Código de 6 dígitos para digitar** (`{{ .Token }}`) na tela que já está aberta.

O código evita o pulo para o cliente de e-mail e de volta, e evita o caso em que o
link abre num navegador diferente daquele onde a pessoa digitou o endereço. Se você
preferir código, avise — é uma mudança pequena no cockpit, e o template é sua parte.

---

## 5. Como conferir que funcionou

Depois do SMTP, sem tocar em código:

1. Abra `http://localhost:4317/conta` numa janela anônima.
2. Digite um e-mail que **não** seja o do Kauan e peça o link.
3. A tela tem que virar **"Link enviado"** — não um aviso vermelho.
4. O e-mail chega com o remetente que você configurou.
5. Clicando no link, a pessoa entra e cai em **"Aguardando aprovação"**.
6. O Kauan vê o pedido na aba **Conta**, em `[ 02 ] Quem está esperando`, e aprova
   escolhendo cargo e organização.

Se o passo 3 continuar mostrando *"o serviço de e-mail embutido do Supabase bateu no
teto da hora"*, o SMTP próprio não está ativo — a mensagem nomeia exatamente esse
caso e não aparece por outro motivo.

Depois do Google publicado, repita com *Continuar com Google* usando uma conta que
**não** esteja na lista de teste. Ela tem que chegar na tela de espera, e não em
"Acesso bloqueado".

---

## 6. O que este login NÃO é, e vale você saber

O Cockpit roda na máquina de cada pessoa. **Este login diz quem a pessoa é; ele não
tranca a máquina** — quem tem o computador alcança o painel por fora do navegador, e
o guarda do cockpit permite isso de propósito para não travar automação local.

Onde a aprovação vira tranca de verdade é na porta hospedada, que ainda não existe.
A tela diz isso ao usuário, em vez de esconder. Se alguém te apresentar isto como
"controle de acesso ao sistema", a frase correta é: **controle de quem usa o painel
pela porta da frente**.
