# LobeHub + Twenty CRM numa VPS de 4 GB

Kit para subir o **LobeHub** (chat com IA) e o **Twenty** (CRM) juntos numa VPS
pequena (HostGator **VPS NVMe 4**: 2 vCPU, 4 GB de RAM, 100 GB NVMe), com HTTPS
automático e backup diário.

## O que tem nesta pasta

| Arquivo                | Para que serve                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| `docker-compose.yml`   | Todos os serviços, com limite de memória para caber em 4 GB          |
| `Caddyfile`            | Proxy que gera e renova os certificados HTTPS sozinho                |
| `.env.example`         | Modelo de configuração (domínios e segredos)                         |
| `lobehub.env.example`  | Configurações extras do LobeHub (chaves de API de IA, busca na web)  |
| `preparar-servidor.sh` | Prepara o Ubuntu: Docker, firewall, swap, atualizações automáticas   |
| `gerar-segredos.sh`    | Gera todas as senhas e chaves do `.env`                              |
| `backup.sh`            | Backup dos dois bancos e dos arquivos, guardado por 7 dias           |

## Como fica no servidor

```
Internet ──► Caddy (HTTPS, portas 80/443)
               ├── chat.suaempresa.com.br     ──► LobeHub ──► Postgres + Redis + RustFS
               ├── arquivos.suaempresa.com.br ──► RustFS (uploads do chat)
               ├── gateway.suaempresa.com.br  ──► LobeHub Gateway
               └── crm.suaempresa.com.br      ──► Twenty ──► Postgres + Redis (+ worker)
```

Só o Caddy fica exposto na internet. Bancos de dados e Redis ficam em redes
internas, sem porta aberta.

---

## Passo a passo

### 1. Contratar a VPS

Na HostGator, escolha **VPS NVMe 4** e, no sistema operacional, a opção
**"SO Simples" → Ubuntu 24.04** (sem cPanel ou outro painel). Anote o **IP** e a
senha de root.

### 2. Criar os subdomínios (DNS)

No painel onde o domínio da empresa é gerenciado (Registro.br, Cloudflare,
HostGator etc.), crie **4 registros do tipo A**, todos apontando para o IP da VPS:

| Nome       | Tipo | Valor        |
| ---------- | ---- | ------------ |
| `chat`     | A    | IP da VPS    |
| `arquivos` | A    | IP da VPS    |
| `gateway`  | A    | IP da VPS    |
| `crm`      | A    | IP da VPS    |

> Se usar Cloudflare, deixe a nuvem **cinza** (somente DNS) nesses registros, pelo
> menos até os certificados serem emitidos.

### 3. Enviar esta pasta para a VPS

Do seu computador, na pasta `docker-compose/` do repositório:

```bash
scp -r kolden-vps root@IP_DA_VPS:/opt/kolden
```

Depois entre na VPS:

```bash
ssh root@IP_DA_VPS
cd /opt/kolden
```

### 4. Preparar o servidor (uma vez só)

```bash
chmod +x *.sh
./preparar-servidor.sh
```

Instala o Docker, liga o firewall (só SSH, HTTP e HTTPS), cria 4 GB de swap,
ativa atualizações automáticas de segurança e proteção contra tentativas de
invasão no SSH.

### 5. Configurar domínios e segredos

```bash
cp .env.example .env
nano .env        # troque os 4 domínios e o ACME_EMAIL
./gerar-segredos.sh
```

**Guarde uma cópia do `.env` num gerenciador de senhas** (Bitwarden, 1Password).
Sem ele, nem os backups conseguem ser restaurados.

Recomendado: em `AUTH_ALLOWED_EMAILS`, liste os e-mails da equipe para que só
eles consigam criar conta no LobeHub.

### 6. Subir tudo

```bash
docker compose up -d
```

Na primeira vez demora alguns minutos (baixar as imagens e preparar os bancos;
o Twenty leva uns 2 minutos para ficar pronto). Para acompanhar:

```bash
docker compose ps
```

Tudo pronto quando aparecer `healthy` nos bancos e no `twenty-server`, e o
`lobe-rustfs-init` como `Exited (0)` (ele só cria a pasta de arquivos e termina).

### 7. Primeiro acesso

- **LobeHub:** `https://chat.suaempresa.com.br` → crie sua conta e, em
  Configurações → Provedores de IA, coloque as chaves de API (OpenAI, Anthropic
  etc.). Para deixar uma chave compartilhada para toda a equipe, use o
  `lobehub.env` (veja `lobehub.env.example`) e rode `docker compose up -d` de novo.
- **Twenty:** `https://crm.suaempresa.com.br` → a primeira pessoa a se cadastrar
  cria o workspace da empresa. Depois disso, convide a equipe por dentro do
  Twenty.

### 8. Agendar o backup diário

```bash
crontab -e
```

Adicione a linha (backup todo dia às 3h):

```
0 3 * * * /opt/kolden/backup.sh >> /var/log/kolden-backup.log 2>&1
```

Os backups ficam em `/opt/kolden/backups/` por 7 dias. **Copie-os também para
fora da VPS** (por exemplo com `rclone` para um bucket Cloudflare R2, que tem
10 GB grátis). Backup que só existe dentro do servidor some junto com ele.

Para testar na hora: `./backup.sh`

---

## Uso de memória (medido)

Medido com a pilha completa rodando, sem uso pesado:

| Serviço          | RAM      |
| ---------------- | -------- |
| Twenty worker    | ~700 MB  |
| Twenty server    | ~600 MB  |
| LobeHub          | ~530 MB  |
| Postgres (x2)    | ~170 MB  |
| Demais           | ~60 MB   |
| **Total**        | **~2 GB**|

Sobram cerca de 2 GB de RAM mais 4 GB de swap. **Hora de fazer upgrade para o
VPS NVMe 8** quando: o `free -h` mostrar o swap sempre em uso, o sistema ficar
lento, ou for entrar um terceiro sistema.

Ver o consumo a qualquer momento:

```bash
docker stats --no-stream
```

## Dia a dia

| Tarefa                       | Comando                                            |
| ---------------------------- | -------------------------------------------------- |
| Ver o status                 | `docker compose ps`                                |
| Ver logs de um serviço       | `docker compose logs -f --tail 100 lobe`           |
| Reiniciar um serviço         | `docker compose restart twenty-server`             |
| Atualizar LobeHub e Twenty   | `./backup.sh && docker compose pull && docker compose up -d` |
| Desligar tudo                | `docker compose down` (os dados ficam guardados)   |

> Nunca rode `docker compose down -v`: o `-v` **apaga os dados**.

Depois que tudo estiver funcionando, é boa prática trocar `latest` por números
de versão fixos no `.env` (`LOBE_TAG`, `TWENTY_TAG`), para uma atualização nunca
acontecer sem você decidir.

## Problemas comuns

- **Site não abre / erro de certificado:** confira se os 4 registros DNS apontam
  para o IP da VPS (`ping chat.suaempresa.com.br`) e veja `docker compose logs caddy`.
- **Upload de arquivo no chat falha:** o domínio `arquivos.` precisa estar no
  DNS e acessível; veja `docker compose logs rustfs`.
- **Twenty reiniciando:** `docker compose logs --tail 50 twenty-worker`. Se
  aparecer `heap out of memory`, é hora do upgrade de plano.
- **Busca na web no LobeHub:** ligue o perfil `busca` (instruções no
  `.env.example`). Usa ~200 MB de RAM a mais.
