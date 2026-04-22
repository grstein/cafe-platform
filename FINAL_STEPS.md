# Etapas finais — migração para GitHub + GHCR

Este arquivo documenta os últimos passos que exigem acesso do usuário
(credenciais GitHub, SSH na VPS). O refactor de código, a separação dos
repositórios e a auditoria de dados sensíveis **já foram concluídos**.
Este arquivo pode ser removido após a migração ser concluída.

## Status atual

- ✅ `cafe-platform` (este repo): código refatorado para single-tenant via
  `TENANT_ID`, dados sensíveis removidos, examples/ genéricos criados,
  workflows CI/Publish prontos, testes verdes (163/163), imagem builda
  via `podman build`.
- ✅ `../cafe-dos-altos-pilot` (repo privado): criado em
  `/home/stein/Projects/cafe-dos-altos-pilot` com tenant, pi-config,
  docker-compose.prod.yml, workflow de deploy, scripts e runbook.
  Primeiro commit já feito. **Ainda não foi empurrado para o GitHub.**

## 1. Criar o repositório público no GitHub para a plataforma

```bash
cd /home/stein/Projects/cafe-platform

# Remover o histórico atual (garantia extra — o plano aprovado pediu fresh repo)
rm -rf .git
git init -b main
git add .
git commit -m "Initial commit: cafe-platform engine (public)"

# Criar o repo vazio no GitHub (público) — via gh CLI:
gh repo create cafe-platform --public --source=. --remote=origin --push

# Ou manualmente:
# 1. https://github.com/new → nome: cafe-platform, público, sem README
# 2. git remote add origin git@github.com:<seu-usuario>/cafe-platform.git
# 3. git push -u origin main
```

Depois de push:
- O workflow `.github/workflows/ci.yml` roda os testes.
- O workflow `.github/workflows/publish.yml` constrói a imagem e publica
  em `ghcr.io/<seu-usuario>/cafe-platform:<sha>` e `:latest`.
- Verifique em *Actions* que ambos ficaram verdes.
- Em *Settings → Packages*, torne `cafe-platform` (container) público se
  quiser que VPS puxe sem login (recomendado — imagem é engine pura,
  sem dados do tenant).

## 2. Criar o repositório privado para o piloto

```bash
cd /home/stein/Projects/cafe-dos-altos-pilot

# Criar repo privado no GitHub via gh CLI:
gh repo create cafe-dos-altos-pilot --private --source=. --remote=origin --push

# Ou manualmente:
# 1. https://github.com/new → nome: cafe-dos-altos-pilot, privado, sem README
# 2. git remote add origin git@github.com:<seu-usuario>/cafe-dos-altos-pilot.git
# 3. git push -u origin main
```

## 3. Configurar secrets no repo piloto

Em *GitHub → cafe-dos-altos-pilot → Settings → Secrets and variables → Actions*:

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP da VPS |
| `VPS_USER` | `root` (ou usuário com acesso a `/opt`) |
| `VPS_SSH_PRIVATE_KEY` | chave privada PEM autorizada no VPS (gerar nova — usar `ssh-keygen -t ed25519 -f ~/.ssh/deploy_pilot`, adicionar `.pub` ao `~/.ssh/authorized_keys` do VPS) |
| `VPS_SSH_PORT` | opcional, default 22 |
| `VPS_DEPLOY_PATH` | `/opt/cafe-dos-altos` |

Se a imagem GHCR ficar privada, adicionar também:
| Secret | Valor |
|---|---|
| `GHCR_USER` | seu usuário GitHub |
| `GHCR_TOKEN` | PAT com escopo `read:packages` |

## 4. Configurar deploy key no repo piloto para o VPS

```bash
# Na VPS:
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_pilot -N ''
cat ~/.ssh/id_ed25519_pilot.pub
# Copie a saída
```

Em *GitHub → cafe-dos-altos-pilot → Settings → Deploy keys → Add deploy key*:
- Title: `vps`
- Key: conteúdo do `.pub`
- Allow write access: **não** (só-leitura basta).

Configurar SSH da VPS para usar essa chave ao clonar:

```bash
# Na VPS, ~/.ssh/config:
Host github.com-pilot
  HostName github.com
  IdentityFile ~/.ssh/id_ed25519_pilot
  IdentitiesOnly yes
```

Usar URL `git@github.com-pilot:<owner>/cafe-dos-altos-pilot.git` ao clonar.

## 5. Setup inicial da VPS

```bash
ssh root@<VPS>
cd /opt
git clone git@github.com-pilot:<owner>/cafe-dos-altos-pilot.git cafe-dos-altos
cd cafe-dos-altos
cp .env.example .env && chmod 600 .env
nano .env   # preencher RABBITMQ_PASSWORD, OPENROUTER_API_KEY, PIX_KEY/NAME/CITY, BOT_PHONE
./scripts/bootstrap-vps.sh
```

Se a VPS já tiver dados da v8 (SQLite + Baileys auth) em
`/opt/cafe-dos-altos/v8/`, rode a migração para named volumes:

```bash
./scripts/migrate-volumes.sh
```

## 6. Pareamento WhatsApp

Do seu laptop:
```bash
ssh -L 3001:127.0.0.1:3001 root@<VPS>
# Abrir http://localhost:3001/qr e escanear com o app
```

Após parear, o auth state persiste no volume `cafe_data` e sobrevive a
deploys subsequentes.

## 7. Seed inicial do catálogo (uma vez)

```bash
ssh root@<VPS>
cd /opt/cafe-dos-altos
docker compose -f docker-compose.prod.yml exec gateway node setup/seed-products.mjs
```

## 8. Validação end-to-end

```bash
# Na VPS:
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep platform_

# Testar pipeline sem WhatsApp:
docker compose -f docker-compose.prod.yml exec gateway \
  node setup/send-test-message.mjs "/ajuda"
docker compose -f docker-compose.prod.yml logs -f --tail 20 gateway agent sender
```

## 9. Arquivar o ambiente anterior

Quando o novo stack estiver validado e o pareamento do Baileys ok:

```bash
# Renomear o diretório local antigo como backup (ainda no seu laptop):
mv /home/stein/Projects/cafe-platform /home/stein/Projects/cafe-platform-backup-$(date +%F)
# (opcional) arquivar o antigo diretório v8 na VPS:
ssh root@<VPS> "mv /opt/cafe-dos-altos/v8 /opt/cafe-dos-altos/v8.archived-$(date +%F)"
```

## 10. Remover este arquivo

Uma vez que tudo estiver no ar e o deploy estiver sendo feito via push
para `main`, remova `FINAL_STEPS.md` com um commit final:

```bash
rm FINAL_STEPS.md
git commit -am "chore: drop migration runbook"
git push
```

---

## Troubleshooting

- **CI falha no publish.yml**: confirme que a Settings → Actions →
  General → Workflow permissions está em "Read and write permissions"
  (para permitir push em GHCR) e que *Allow GitHub Actions to create and
  approve pull requests* está desativado (não usamos).
- **podman rootless + bind-mount permissions**: se testar localmente e
  containers não escreverem em `./data`, rode
  `podman unshare chown -R 1000:1000 data logs`.
- **Baileys não recebe mensagens após deploy**: verifique
  `docker logs platform_whatsapp_bridge` — se aparecer "Stream Errored",
  é LID mismatch; pareamento WhatsApp precisa ser refeito. O auth state
  em `cafe_data:/cafe-dos-altos/auth/` pode ter sido corrompido.
- **Imagem GHCR privada e VPS não consegue pull**: faça login no GHCR
  na VPS via `docker login ghcr.io -u <user> -p <PAT>` (PAT com
  `read:packages`).
