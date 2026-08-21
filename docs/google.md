# Google: conexão e sincronização

Referência de como o Note-Chan fala com o Google — o que já está construído e
o que está desenhado mas ainda não existe.

> **Leia isto primeiro.** As seções 1 e 2 descrevem código que **existe e roda
> hoje**. A seção 3 é **projeto**: foi desenhada em discussão, as decisões
> estão fechadas, mas nada dela foi implementado. Não confunda as duas ao
> planejar trabalho.

---

## 1. Conexão com a conta (`GoogleAuth.js`)

### Fluxo

Login OAuth 2.0 no formato "app instalado", com PKCE. Não existe segredo
guardado no cliente que valha alguma coisa sozinho, e nenhum navegador
embutido participa — a autorização acontece no navegador do próprio usuário.

1. O app gera `code_verifier` (32 bytes aleatórios) e `code_challenge`
   (SHA-256 do verifier, método `S256`), mais um `state` de 16 bytes.
2. Sobe um servidor HTTP **efêmero** em `127.0.0.1`, porta `0` — quem escolhe
   a porta é o sistema operacional. O `redirect_uri` vira
   `http://127.0.0.1:<porta>`.
3. Abre `accounts.google.com/o/oauth2/v2/auth` no navegador do sistema, com
   `access_type=offline` e `prompt=consent` (é o que garante que venha um
   `refresh_token`).
4. O redirect volta no servidor local. O `state` é conferido; se não bater, ou
   se vier `error`, a operação é recusada.
5. O `code` é trocado por tokens em `oauth2.googleapis.com/token`.
6. O e-mail da conta é lido em `oauth2/v3/userinfo`, só para mostrar "conectado
   como fulano" na interface.
7. O servidor local fecha. Tempo máximo de espera: **5 minutos**.

### Escopos

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/userinfo.email
```

### Guarda dos tokens

| Token | Onde fica | Vida |
|---|---|---|
| `refresh_token` | `userData/google-auth.enc`, cifrado com `safeStorage` do Electron (cofre de credenciais do Windows) | Longa |
| `access_token` | **Só em memória**, nunca em disco | ~1h, renovado sob demanda |

A renovação acontece quando faltam menos de 60 segundos para expirar. Se o
Google responder **400 ou 401** na renovação, o token foi revogado (o usuário
removeu o acesso pela conta dele, por exemplo) — o app desconecta na hora em
vez de insistir.

Desconectar revoga o token em `oauth2.googleapis.com/revoke` e apaga o arquivo.
Falha na revogação é registrada e ignorada: o que importa é que o lado local
não guarde mais nada.

### Configuração

As credenciais ficam em `src/js/GoogleAuthConfig.js`, que é **gitignored**.
Um clone novo precisa criar o arquivo a partir de `GoogleAuthConfig.example.js`
(ver README → Sincronização com o Google Agenda). Sem ele, a funcionalidade
aparece como "Não configurado" e o resto do app funciona normalmente.

### Limitação conhecida: token de 7 dias

Enquanto o projeto estiver como **"Testing"** no Google Cloud Console, o Google
expira o `refresh_token` em cerca de uma semana, e é preciso reconectar.
Publicar o app remove esse limite, mas escopos de Calendar e Drive costumam
exigir verificação. Vale reconferir a política atual antes de contar com isso.

---

## 2. Sincronização com o Google Agenda (`GoogleCalendarSync.js`)

Sincroniza eventos e aniversariantes com o calendário **principal** (`primary`)
do usuário — decisão explícita, em vez de criar um calendário dedicado.

### Como o app reconhece o que é dele

Cada item criado pelo Note-Chan carrega uma marcação invisível no lado do
Google:

```
extendedProperties.private.noteChanId          → evento
extendedProperties.private.noteChanBirthdayId  → aniversariante
```

É isso que permite atualizar e excluir só o que é nosso, sem tocar nos outros
compromissos da agenda.

### Ordem de uma sincronização

```
1. adoptLegacyItems      adota o estado atual como "já sincronizado" em item
                         gravado por versão anterior (sem googleSyncedAt),
                         para não subir a agenda inteira de uma vez
2. processPendingDeletes  exclui no Google o que foi excluído aqui
3. pushLocalChanges       PATCH do que mudou localmente
4. listGoogleEvents       lê o que está lá
5. applyGoogleEventsToLocal  aplica no lado local
6. pushNewLocalItems      POST do que ainda não existe no Google
```

Subir **antes** de ler é o que faz uma edição local chegar ao Google. Como a
leitura vem depois, o Google continua vencendo em conflito de verdade — item
alterado dos dois lados desde a última sincronização volta com o valor de lá.

"Alterado localmente" é `updatedAt > googleSyncedAt`. Os dois carimbos saem
iguais quando algo é aplicado a partir do Google, justamente para o que
acabou de descer não parecer edição local.

### O que sobe

**Evento:**

| Campo local | Vira no Google |
|---|---|
| `title` | `summary` |
| `link` | `description` |
| `date` + `startTime`/`endTime` | `start`/`end` com `dateTime` e `timeZone` local |
| `date` (sem horário) | `start`/`end` com `date` (dia inteiro) |
| `recurrence` | `RRULE:FREQ=DAILY\|WEEKLY\|MONTHLY\|YEARLY` |

**Aniversariante:** `summary` = "Aniversário de <nome>", evento de dia inteiro
na data de nascimento, com `RRULE:FREQ=YEARLY`.

### O que NUNCA sai daqui

São conceitos que só existem no Note-Chan e não têm equivalente no Calendar:

- `completedDates` — o "marcar como feito"
- `items` — o checklist do evento
- `tagIds` — as tags
- `category` do aniversariante (família/amigo/trabalho)

**Isso tem consequência direta na seção 3.** Guarde essa lista.

### Evento que já existia na agenda

Evento sem a nossa marcação, criado direto no Google, é importado como evento
comum e recebe `foreign: true`. Ao editá-lo aqui, o PATCH manda **apenas
`summary`, `start` e `end`** — nunca `recurrence`, `description` ou
`extendedProperties`.

O motivo: o modelo de recorrência daqui é pobre perto do que o Google aceita.
Reenviá-lo trocaria um "toda segunda e quarta até dezembro"
(`BYDAY=MO,WE;UNTIL=...`) por um "toda semana". `PATCH` é mesclagem — campo
omitido fica intacto do lado de lá.

### Aniversariante: só um sentido

Aniversariante sincroniza de forma confiável apenas **Note-Chan → Google**.
Evento anual recorrente criado direto no Google **não** vira aniversariante
aqui — vira evento comum. Adivinhar que um evento anual é aniversário é
arriscado demais.

### Exclusão

Excluir aqui não apaga no Google na hora. O id entra em
`data.googleSync.pendingDeletes` e é processado no início da próxima
sincronização. Só sai da fila o que realmente foi excluído — `404` e `410`
contam (já não existe lá). Falha de rede ou token deixa o id na fila para a
próxima tentativa.

### Leitura incremental

Usa `syncToken` da Calendar API. Quando o Google responde **410**, o token
expirou e a leitura cai para uma completa na janela de **30 dias atrás até 365
à frente**. Parâmetros fixos: `singleEvents=false`, `showDeleted=true`,
`maxResults=2500`.

O `syncToken` é **estado de cada máquina** — ver seção 3.

### Fuso horário

O Google devolve `dateTime` no fuso do **evento** (`...T14:00:00-03:00`).
Recortar a string mostraria a hora de parede de lá; o app converte para `Date`
e lê os componentes locais, então a hora exibida é a do relógio do usuário.

### Quando roda

- Ao expandir o widget (transição bandeja → expandido)
- A cada **15 minutos** com o app rodando
- Logo após conectar a conta
- No botão "Sincronizar agora" em Configurações

**Uma por vez.** Há uma trava de "em andamento": pedidos que chegam durante
outra sincronização reaproveitam a mesma promessa. Sem isso, abrir o widget e
clicar no botão dispararia dois `pushNewLocalItems` em paralelo, e o mesmo
evento seria criado duas vezes na agenda.

### Campos de propriedade do processo principal

Estes campos nunca são editados pelo renderer e são repostos a cada `save-data`
(ver `mergeMainOwnedList` em `Main.js`). Se o renderer pudesse sobrescrevê-los,
qualquer edição de card quebraria o vínculo com o Google:

```
evento:         googleEventId, googleSyncedAt, foreign,
                lastNotified, lastNoTimeNotified
aniversariante: googleEventId, googleSyncedAt
```

### Limitação conhecida: evento não aparece numa segunda máquina

Em `applyGoogleEventsToLocal`, um evento que traz `noteChanId` mas não existe
localmente é **pulado**:

```js
const local = data.events.find(e => e.id === noteChanId);
if (!local) continue;
```

Com uma máquina só, isso está certo: "não existe aqui" significa "foi excluído
aqui". Com duas, significa "nunca vi isso" — e o evento criado no PC A nunca
materializa no PC B. Aniversariante tem o mesmo comportamento.

Não vale corrigir isoladamente: mesmo materializando o evento, ele chegaria sem
checklist, sem tags e sem histórico de concluído (ver "O que NUNCA sai daqui").
A solução está na seção 3.

---

## 3. Sincronização entre máquinas — PROJETO, não implementado

### Objetivo e restrição

Usar a mesma conta Google como ponte para que o Note-Chan instalado em mais de
um computador tenha os mesmos dados. **Sem servidor próprio** para criar ou
hospedar.

Uso previsto: **um usuário, uma máquina por vez**. Não há necessidade de tempo
real — na prática é um revezamento (usa no PC A, depois no PC B).

### Mecanismo: Google Drive appDataFolder

Pasta oculta por aplicativo dentro do Drive do próprio usuário, acessada com o
escopo `https://www.googleapis.com/auth/drive.appdata`. Não aparece na
interface do Drive, só o app que criou consegue ler, e existe exatamente para
guardar estado de aplicativo sem servidor. Um `data.json` do Note-Chan tem
alguns KB.

**Por que não as alternativas:**

| Opção | Por que não |
|---|---|
| `extendedProperties` de eventos | Limite apertado por evento; exigiria eventos-fantasma só para carregar nota. Abuso da API. |
| Google Keep | Não tem API pública para conta pessoal — a que existe é só Workspace. |
| Google Tasks | Mapearia listas de forma tosca e não cobre notas, tags nem bichinho. |
| Firebase/Firestore | É Google e tem plano gratuito, mas é provisionar e administrar um backend, com regras de segurança e conta que pode cobrar. Sai do critério. |

### O Calendar não serve de transporte

Esta é a conclusão que fecha o desenho. O payload que sobe para o Calendar
**não carrega** `items`, `completedDates`, `tagIds` nem `category` (seção 2). Um
evento que chegasse ao PC B pelo Calendar viria sem checklist, sem tags e sem
histórico de concluído; um aniversariante viria sem categoria.

Portanto: **o Drive carrega o registro completo dos seis tipos de dado, e o
Calendar continua exatamente como está** — espelho dos eventos e
aniversariantes, para eles aparecerem e serem editáveis dentro do Google
Agenda. Não há dois donos brigando: o Drive tem o registro inteiro, o Calendar
tem o recorte visível na agenda, e os dois já se reconhecem por
`googleEventId`.

Ordem em cada abertura: **baixa do Drive e funde → roda a sincronização do
Calendar**.

### O que sincroniza

| Sincroniza | Não sincroniza |
|---|---|
| Notas | Configurações (decisão do usuário) |
| Tarefas (listas) | `googleSync.syncToken` |
| Eventos | `googleSync.pendingDeletes` |
| Aniversariantes | `noteWindow` (tamanho de janela) |
| Tags | `widget` (modo, aba ativa) |
| Bichinho | |

**Atenção ao `syncToken`.** Ele é estado de cada máquina. Se viajar para o PC
B, ele vai achar que já leu tudo do Calendar e **parar de receber eventos**. O
mesmo vale para `pendingDeletes`: a fila é de quem excluiu.

### Modelo de fusão

- **Por item, nunca o arquivo inteiro.** Substituir o blob todo faria a máquina
  que gravasse por último apagar o trabalho da outra por completo, não só o
  item em conflito.
- **`updatedAt` mais novo vence.**
- **Bichinho vai como bloco único** — nível e XP remendados de duas origens
  ficariam incoerentes.
- **Exclusão precisa de lápide** (`{ id, tipo, excluídoEm }`, descartada depois
  de ~30 dias). Sem isso, a outra máquina ainda tem o item e o ressuscita na
  próxima fusão.

Duas formas possíveis, ambas aceitáveis para o uso previsto:

- **Um arquivo por máquina** — cada instalação escreve só o seu; para ler,
  lista todos e funde. Duas máquinas nunca disputam o mesmo arquivo, então o
  problema de escrita concorrente não existe.
- **Arquivo único** — mais simples de ler; exige cuidado com escrita
  concorrente, que no revezamento previsto praticamente não acontece.

### Quando sincroniza

- **Ao abrir** — baixa e funde
- **Ao recolher para a bandeja** — que é o "fechar" percebido pelo usuário. O
  app continua rodando (o `✕` só esconde; só "Sair" na bandeja encerra), então
  o upload tem todo o tempo necessário
- **Periodicamente**, para o fechamento ser só um flush que quase sempre não
  tem o que fazer
- **No botão manual**, que é a garantia
- Precisa de um controle de "mudou algo desde a última subida" — esconder
  acontece o tempo todo e não pode virar requisição a cada `Esc`

**Não é tempo real.** Notificação push do Drive exige endpoint HTTPS público,
ou seja, servidor. Sem isso é sondagem, e a mudança aparece na outra máquina
dentro da janela do intervalo.

### Fechamento abrupto

Gerenciador de Tarefas, queda de energia, desligamento do Windows. Nada roda, o
upload não acontece — e mesmo assim **não se perde dado**, por três razões:

1. **O local já é durável.** O `data.json` é gravado continuamente (debounce de
   500 ms, escrita atômica em `.tmp` + rename, `.bak` e snapshot diário). Uma
   morte súbita perde no máximo a última fração de segundo de digitação, o que
   já acontece hoje, sem relação com sincronização.
2. **A fusão é por item.** Ao voltar, a máquina baixa, funde, e os itens dela
   que forem mais novos vencem. Não existe "perdi porque não subi": existe
   "demorou mais para chegar".
3. **As lápides moram no arquivo local.** Uma exclusão feita antes do
   travamento sobrevive e é aplicada na próxima fusão.

Pior cenário real: matar o PC A sem subir, mexer no PC B, e só depois voltar ao
A. Mesmo aí as alterações dos dois convivem. Só se **o mesmo item** foi editado
nas duas máquinas é que uma versão cai, e ganha a de carimbo mais novo.

Upload interrompido no meio também não corrompe o lado do Drive: a atualização
só passa a valer quando termina. É a mesma propriedade do `.tmp` + rename que o
`DataManager` já usa localmente.

### Pendências antes de implementar

- [ ] **Tags não têm `updatedAt`.** Hoje são `{ id, name, color }`. Sem o campo
      não há como fundir por data. Exige migração no `loadData`.
      Na migração das tags existentes o valor deve ir como `0`, não como a data
      de hoje: carimbar "agora" faria a máquina que abrisse por último parecer
      ter as tags mais recentes e sobrescrever um renome legítimo feito na
      outra. Com `0`, empate mantém a local e só uma edição de verdade ganha.
- [ ] **Lápides** no formato do `data.json`, com poda por idade.
- [ ] **Separar** o que sincroniza do que é local, no formato do arquivo.
- [ ] **Escopo `drive.appdata`** somado aos atuais, e **Drive API habilitada**
      no Cloud Console. Quem já estiver conectado precisa clicar em Conectar
      mais uma vez.
- [ ] Decidir entre arquivo por máquina e arquivo único.

O `schemaVersion` no `data.json` (introduzido na migração do texto rico) já
existe e é a peça que faltava para versionar essas mudanças de formato.

### Caminho sugerido

1. Reforma do `data.json` — lápides e `updatedAt` em tag, **sem tocar em rede**.
2. Módulo do Drive com **notas e tarefas só** — são as mais simples e não têm
   vínculo com o Calendar.
3. Trazer eventos, aniversariantes e bichinho.
