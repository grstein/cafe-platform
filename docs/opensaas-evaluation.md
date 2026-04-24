# Open SaaS — avaliação de funcionalidades

Relatório de triagem do template [wasp-lang/open-saas](https://github.com/wasp-lang/open-saas)
como base potencial para o admin UI de produção do `cafe-platform`.
Foco: o que o Open SaaS entrega pronto e o que vale importar — não
propõe migração completa. Complementa `docs/admin-ui.md` (spec
funcional do admin) e `prototypes/admin-ui.html` (mockup atual).

---

## 1. Como o Open SaaS é montado

- **Wasp framework** — um manifesto `main.wasp` declara entidades,
  rotas, operações (queries/actions), auth, jobs e deploy. A partir
  dele o Wasp gera servidor Node + cliente React.
- **Stack**: React + Vite + Tailwind + shadcn no frontend; Node
  (Express gerado pelo Wasp) no backend; **Prisma** sobre PostgreSQL.
- **Camadas em `template/app/src/`**:
  - `admin/` — layout TailAdmin (dashboards, tabelas, settings, calendar).
  - `auth/` — email/password + verificação + reset + social (Google,
    GitHub, Discord).
  - `payment/` — Stripe, Lemon Squeezy e Polar com webhooks e portal
    do cliente.
  - `analytics/` — integração Plausible/Google + agregados
    `DailyStats` / `PageViewSource`.
  - `file-upload/` — presigned URLs S3 + validação.
  - `landing-page/` — página pública de marketing.
  - `demo-ai-app/` — exemplo de operation/schedule/job usando GPT.
  - `user/` — perfil, conta.
- **Extras**: blog em Astro (`template/blog/`), CLI Wasp
  (`wasp db migrate-dev`, `wasp deploy fly`), emails transacionais
  (SendGrid/Mailgun/SMTP), cookie consent, SEO meta.

---

## 2. Top funcionalidades

| Funcionalidade | Onde mora | Relevância | Veredito |
|---|---|---|---|
| Auth email + social | `src/auth/` | Alta (admin single-user) | **Adotar padrão, não código** |
| Admin dashboard TailAdmin | `src/admin/` | Alta (referência visual) | **Adaptar** |
| File upload S3 presigned | `src/file-upload/` | Média (catálogo, skills) | **Adotar padrão** |
| Analytics agregada | `src/analytics/` + schema | Média (KPIs do dashboard) | **Adaptar conceito** |
| Email transacional | `main.wasp` emailSender | Baixa hoje, alta amanhã | **Adotar quando precisar** |
| Webhooks Stripe/LS/Polar | `src/payment/webhook.ts` | Nenhuma hoje | **Descartar (guardar como template)** |
| Sistema de plano/créditos | `User.subscriptionPlan`, `credits` | Nenhuma (single-tenant) | **Descartar** |
| Landing page + Blog | `landing-page/`, `template/blog/` | Nenhuma (produto não é público) | **Descartar** |
| Contact form | `ContactFormMessage` no schema | Baixa | **Descartar** |
| Cookie consent + SEO | `main.wasp` head + componente | Nenhuma (admin interno) | **Descartar** |
| Demo GPT app | `src/demo-ai-app/` | Nenhuma (agente próprio) | **Descartar** |
| CLI Wasp (deploy) | toolchain Wasp | Nenhuma (usamos Docker Compose) | **Descartar** |

### 2.1 Auth — `src/auth/`

**Entrega**: login/signup/verificação/reset por email, OAuth com
Google, GitHub e Discord, `userSignupFields` customizáveis, hooks de
sessão. Tudo integrado no `main.wasp` via bloco `auth: {}`.

**Encaixe**: `docs/admin-ui.md §4.4` já prevê single-admin com
`ADMIN_PASSWORD_HASH` + bcrypt + cookie. O fluxo do Open SaaS é
sobredimensionado para nosso uso (não há signup público nem múltiplos
usuários no v1). Porém, o **padrão** do Open SaaS — cookie assinado
com `@fastify/secure-session` equivalente, verificação de email via
token, rate-limit em `/login` — serve como referência de boas
práticas.

**Veredito**: **adotar padrão**. Manter Fastify+bcrypt do spec atual;
quando migrar para multi-user (roles `owner`/`operator`/`viewer` no
TODO), olhar o schema de `User` + `email-and-pass/` como guia.

### 2.2 Admin dashboard — `src/admin/`

**Entrega**: layout TailAdmin completo (sidebar, topbar, breadcrumbs,
dark mode), dashboards de analytics/messages/users com charts
(ApexCharts), tabelas paginadas, cards de KPI, settings page,
calendar, ui-elements (alerts, buttons, modals).

**Encaixe**: nosso `prototypes/admin-ui.html` já inspira-se em
padrões TailAdmin. `docs/admin-ui.md §4.3` escolheu **Fastify+EJS+HTMX
sem build-step**, o que é incompatível com React+Vite. Mas o layout,
estrutura de cards, hierarquia de navegação e tratamentos de estado
(loading/empty/error) batem com o que `DESIGN.md` pede.

**Veredito**: **adaptar**. Portar *visual* e *hierarquia de
informação* para nossos templates EJS. Não importar código React.

### 2.3 File upload S3 — `src/file-upload/`

**Entrega**: geração de presigned PUT URL no backend, upload direto
do browser para S3, validação de MIME/tamanho, `s3Utils.ts` com AWS
SDK v3.

**Encaixe**: o admin tem pelo menos dois uploads planejados — campo
`knowledge_file` em produto (escreve em `pi-config/skills/products/`
hoje, mas S3 seria mais saudável) e anexos de pedidos/conversas
futuros. Hoje nosso fluxo é filesystem local.

**Veredito**: **adotar padrão** quando introduzirmos S3. O código é
direto e vale copiar a estrutura `fileUploading.ts` + `validation.ts`
+ rota presigned.

### 2.4 Analytics agregada — `src/analytics/` + schema

**Entrega**: modelos `DailyStats` e `PageViewSource` no Prisma; jobs
que puxam Plausible/Google diariamente; `operations.ts` para o
dashboard ler métricas; script Plausible/GA no `<head>`.

**Encaixe**: `docs/admin-ui.md §7.1` pede KPIs diários (mensagens
in/out, comandos, pedidos, receita). Hoje calculamos tudo on-the-fly
pelo JSONL em `logs/YYYY-MM-DD.jsonl`. Uma tabela de agregados
diários (semelhante a `DailyStats`) reduziria custo de leitura no
dashboard.

**Veredito**: **adaptar conceito**. Criar migração `daily_stats`
quando o volume de JSONL começar a doer. Não há tráfego web público
— Plausible/GA não se aplicam.

### 2.5 Email transacional — `main.wasp` emailSender

**Entrega**: wrapper unificado sobre SendGrid/Mailgun/SMTP/Dummy,
configurado via env. Wasp injeta em `ctx.server.emailSender`.

**Encaixe**: hoje não enviamos email. Mas `docs/admin-ui.md §12`
menciona "notificações de pedido pago" como Phase 3 — webhook-first
para evitar SMTP no container. Se mudar de ideia, o padrão do Open
SaaS é um bom template.

**Veredito**: **adotar quando precisar**.

### 2.6 Pagamentos Stripe/Lemon Squeezy/Polar — `src/payment/`

**Entrega**: checkout, webhook com verificação de assinatura,
sincronização de `subscriptionStatus`, `PricingPage.tsx`,
`CheckoutResultPage.tsx`, portal do cliente.

**Encaixe**: não há cobrança no cafe-platform — cada deploy é do
próprio dono da loja. Zero encaixe.

**Veredito**: **descartar**. Guardar mentalmente como template se um
dia o produto virar SaaS multi-tenant.

### 2.7 Sistema de plano/créditos — `User.credits`, `subscriptionPlan`

**Entrega**: campos em `User` e gates server-side para consumir
créditos por operação (`demo-ai-app` consome 1 crédito por resposta).

**Encaixe**: single-tenant per deployment. Sem assinantes.

**Veredito**: **descartar**.

### 2.8 Landing page + blog Astro — `src/landing-page/`, `template/blog/`

**Entrega**: hero, features, depoimentos, FAQ, pricing; blog Astro
com MDX.

**Encaixe**: o produto não tem superfície pública — o admin fica em
`127.0.0.1:3002` atrás de tunnel. Marketing é do cliente da loja,
fora do repo.

**Veredito**: **descartar**.

### 2.9 Contact form — `ContactFormMessage`

**Entrega**: tabela + página + email de contato.

**Encaixe**: nenhum — admin é interno.

**Veredito**: **descartar**.

### 2.10 Cookie consent + SEO — `main.wasp` head, componente

**Entrega**: banner LGPD/GDPR, script Plausible/GA condicional, meta
tags OpenGraph.

**Encaixe**: admin não é público. Nenhum.

**Veredito**: **descartar**.

### 2.11 Demo GPT app — `src/demo-ai-app/`

**Entrega**: exemplo de query/action/job sobre GPT com schedule.

**Encaixe**: já temos pipeline Pi Agent SDK mais sofisticado.

**Veredito**: **descartar**.

### 2.12 CLI Wasp — `wasp db migrate-dev`, `wasp deploy fly`

**Entrega**: scaffolding + deploy one-command para Fly.io / Railway.

**Encaixe**: deploy do cafe-platform é `docker compose -f
docker-compose.prod.yml up -d`. Mudar para Wasp significa reescrever
todo o `docker-compose.yml`.

**Veredito**: **descartar**.

---

## 3. Fricções estruturais que inviabilizam "fit completo"

1. **ORM**. Open SaaS é **Prisma-first**; `cafe-platform` usa
   `postgres.js` v3 com tagged templates e migrações versionadas em
   `shared/db/migrations.mjs`. Coexistir exigiria `prisma db pull`
   sobre um schema que nós continuamos editando à mão — duas fontes
   de verdade.
2. **Modelo SaaS vs single-tenant**. Open SaaS assume cadastro
   público, plano, billing, créditos. No nosso produto isso vira
   código morto ou gating desnecessário.
3. **Pipeline por RabbitMQ**. Wasp não tem abstração de broker nem
   consumers independentes — nossos 6 consumers (`gateway`,
   `aggregator`, `enricher`, `agent`, `sender`, `analytics`) não
   cabem no modelo de operations/jobs do Wasp sem quebrar o
   isolamento de processos.
4. **Stack do admin já decidida**. `docs/admin-ui.md §4.3` escolheu
   Fastify + EJS + HTMX **sem build-step**, mesmo Docker image dos
   consumers. Open SaaS traz React+Vite+Tailwind com build pipeline e
   toolchain Wasp — o oposto da decisão anterior.
5. **Deploy**. Nosso deploy é Compose; Wasp empurra para Fly/Railway.
   Conviver significa manter dois caminhos.

---

## 4. Recomendação

**Não migrar para Wasp/Open SaaS.** Manter o plano do
`docs/admin-ui.md` (Fastify + EJS + HTMX + Tailwind compilado
one-shot) e, na implementação, **portar padrões específicos** do Open
SaaS onde caibam:

- **Auth**: bcrypt + cookie assinado + rate-limit no login. Se migrar
  para multi-user, olhar `src/auth/email-and-pass/` como guia.
- **Visual do admin**: usar TailAdmin como referência de sidebar /
  cards / tabelas / estados; traduzir para EJS+HTMX.
- **File upload**: quando introduzirmos S3, copiar o padrão de
  `src/file-upload/` (presigned PUT, validação MIME, SDK v3).
- **Analytics agregada**: quando o JSONL doer, criar `daily_stats`
  inspirado em `DailyStats`/`PageViewSource`.
- **Email transacional**: adotar o wrapper mental de emailSender se
  Phase 3 introduzir notificações.

Descartar explicitamente: billing, planos, créditos, landing, blog,
contact form, cookie consent, demo GPT, CLI Wasp.

---

## 5. Próximos passos

1. Seguir `docs/admin-ui.md` como fonte de verdade do admin v1.
2. Quando implementar cada módulo do admin, consultar a seção
   correspondente acima antes de codar, para reaproveitar padrões
   validados do Open SaaS.
3. Revisitar este relatório se o produto um dia virar SaaS
   multi-tenant com cobrança — aí o Open SaaS volta a ser candidato
   natural de base.
