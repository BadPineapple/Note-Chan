# Note-Chan

Widget de notas, listas e eventos que fica ancorado no canto da tela — leve, sempre visível e **local por padrão**: sem conta, sem login, tudo em `data.json` na sua máquina. A única coisa que sai do computador é opcional — a sincronização com o Google Agenda, que só liga se você conectar sua conta em Configurações.

Também vem com um bichinho virtual pra dar uma desculpa carinhosa pra você completar suas tarefas.

Feito com [Electron](https://www.electronjs.org/) puro (sem framework de UI) para Windows.

## Índice

- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Uso](#uso)
- [Onde ficam os seus dados](#onde-ficam-os-seus-dados)
- [Sincronização com o Google Agenda](#sincronização-com-o-google-agenda)
- [Desenvolvimento](#desenvolvimento)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Licença](#licença)

## Funcionalidades

### Widget

- Fica ancorado no canto inferior esquerdo da tela, sempre visível por cima das outras janelas.
- Modo bandeja: recolhe pra só a barra de título, clique expande de novo.
- Atalho global pra mostrar/ocultar (`Ctrl+Alt+N` por padrão) e captura rápida de nota de qualquer lugar do Windows (`Ctrl+Alt+Q` por padrão) — ambos configuráveis.
- Arrastar um arquivo pra cima do widget cria uma nota com o conteúdo dele (texto lido direto; outros formatos viram um atalho pro caminho do arquivo).
- Navegação completa por teclado: setas para mover entre cards, `Enter` abre/fecha, `Delete` exclui (com confirmação em dois toques), `Esc` recolhe.
- Busca por título entre os cards da aba atual — clique na lupa ou `Ctrl+F`, ignora acentuação.
- Cronômetro e temporizador embutidos, com o tempo restante/decorrido aparecendo discretamente na própria barra de título mesmo com o painel fechado.

### Bichinho virtual

Um mascote em pixel art com 4 status: vida, fome, carência e higiene.

- Fome e higiene decaem com o tempo (higiene bem mais devagar); carência decai só com a falta de interação (abrir o app, dar carinho, brincar); vida se recupera sozinha quando os outros três estão em dia.
- Completar tarefas e eventos nas outras abas recupera fome automaticamente — comida na aba dele é só um bônus manual.
- Três abas de interação: Comida, Brinquedos e Higiene, cada ação com um ganho de status diferente.
- Ganha XP e sobe de nível com o tempo de cuidado.
- Ícone flutuante no canto inferior direito do widget abre o painel dele.

### Notas, Listas e Eventos

Três abas, cada uma com seus próprios cards, arrastáveis para reordenar:

- **Notas** — texto livre, com prévia recolhida e editor expandido.
- **Listas** — itens com checkbox, reordenáveis, "Enter" continua a lista igual Notion/Todoist.
- **Eventos** — data, recorrência (diária/semanal/mensal/anual), horário de início/fim opcional, link, checklist próprio, e alarme sonoro que toca na hora marcada (sintetizado via Web Audio, sem depender de arquivo de áudio externo). Eventos sem horário avisam quando o widget é aberto no dia marcado, em vez de tocar o alarme.

Cada nota/lista/evento pode receber **tags** coloridas (gerenciadas em Configurações, com rolagem horizontal quando há muitas), exibidas como pills no card.

### Aniversariantes

Aba dedicada dentro de Configurações: nome, data e categoria (família/amigo/trabalho), com indicador de quantos dias faltam e idade que a pessoa vai fazer.

### Notificações

Além do alarme de eventos, o app avisa em dois outros momentos, sempre "na voz" do bichinho e sem tom de cobrança:

- Quando fome, higiene, carência ou vida do bichinho ficam baixos — no máximo um aviso por status a cada 3h, pra não virar spam.
- Quando há eventos sem horário marcados para o dia, ao abrir o widget.

Clicar numa notificação do bichinho abre o widget direto no painel dele.

### Configurações

- 5 temas prontos: Dourado, Kuromi, Hello Kitty, Cinnamoroll e Gudetama.
- Transparência do widget ajustável.
- Alarme de eventos: ligar/desligar, volume e escolha de som (4 opções sintetizadas).
- Atalhos globais reconfiguráveis (gravados clicando e pressionando a combinação desejada).
- Sincronização com o Google Agenda: conectar/desconectar a conta e sincronizar sob demanda (ver [seção dedicada](#sincronização-com-o-google-agenda) abaixo).

## Instalação

### Baixando o instalador

Pegue o `Note-Chan-Setup-<versão>.exe` mais recente e rode — o instalador NSIS deixa escolher a pasta de instalação e cria atalhos no Menu Iniciar e na Área de Trabalho. Não precisa de privilégio de administrador.

### Compilando você mesmo

Pré-requisitos: [Node.js](https://nodejs.org/) (LTS) e npm.

```bash
npm install
npm run dist
```

O instalador é gerado em `dist/Note-Chan-Setup-<versão>.exe`.

## Uso

| Atalho | Ação |
|---|---|
| `Ctrl+Alt+N` (padrão) | Mostrar/ocultar o widget |
| `Ctrl+Alt+Q` (padrão) | Captura rápida de nota (de qualquer app) |
| `Ctrl+F` | Abrir a busca por card |
| `←` / `→` | Trocar de aba |
| `↑` / `↓` | Navegar entre os cards |
| `Enter` | Abrir/fechar o card selecionado |
| `Delete` | Excluir o card selecionado (2º toque confirma) |
| `Esc` | Fechar a busca ou o cronômetro, se algum estiver aberto; senão, recolhe o widget |

Os atalhos globais (`Ctrl+Alt+N` e `Ctrl+Alt+Q`) podem ser trocados em Configurações → Geral.

O ícone da bandeja do sistema também dá acesso rápido a: abrir o widget, captura rápida, criar nota/lista/evento/aniversariante direto, Configurações e Sair.

## Onde ficam os seus dados

Tudo fica em `data.json` dentro da pasta de dados do usuário do Windows (`%APPDATA%/NoteChan`). A cada gravação:

- Uma cópia do estado anterior é mantida (`data.json.bak`) como rede de segurança contra uma escrita corrompida.
- Um snapshot datado é salvo em `backups/` uma vez por dia, mantendo os últimos 14 dias.

Se você conectar o Google Agenda, o token de acesso fica em `google-auth.enc`, criptografado com o cofre de credenciais do próprio Windows (`safeStorage` do Electron) — nunca em texto puro, nunca dentro do `data.json`.

Logs de execução ficam em `logs/runtime.log` (rotacionado a cada 2 MB), úteis pra diagnosticar problemas sem precisar abrir o DevTools.

## Sincronização com o Google Agenda

Recurso opcional e de mão dupla: eventos e aniversariantes criados no Note-Chan vão pro seu **calendário principal** do Google, e o que você cria direto no Google Agenda aparece no Note-Chan.

- **Direção do conflito**: se o mesmo evento mudar dos dois lados, o Google sempre vence.
- **Recorrência**: sincroniza como evento recorrente de verdade no Google (RRULE); "marcar como concluído" continua sendo só uma informação do Note-Chan — o Google não tem esse conceito.
- **Como identifica o que é seu**: cada evento/aniversariante criado pelo app carrega uma marcação invisível (`extendedProperties`) no lado do Google, pra atualizar/excluir só o que é dele sem tocar nos seus outros compromissos.
- **Aniversariantes**: só sincronizam de forma confiável num sentido (Note-Chan → Google, como evento anual). Um evento anual recorrente criado direto no Google **não** vira aniversariante aqui — entra como evento comum, pra não arriscar categorizar errado.
- **Quando roda**: automaticamente ao abrir o widget (sair do modo bandeja) e sob demanda pelo botão "Sincronizar agora" em Configurações → Geral. Não fica checando sozinho em segundo plano.

### Configurando pela primeira vez

Sincronização exige credenciais OAuth próprias (o app não vem com uma chave compartilhada):

1. Crie um projeto em [console.cloud.google.com](https://console.cloud.google.com), ative a **Google Calendar API**.
2. Configure a tela de consentimento OAuth (Externo/Testing, adicionando seu e-mail como usuário de teste — dispensa verificação do Google pra uso pessoal).
3. Crie uma credencial **OAuth 2.0 → App para computador** e copie o Client ID e o Client Secret.
4. Copie `src/js/GoogleAuthConfig.example.js` para `src/js/GoogleAuthConfig.js` (esse arquivo é gitignored) e preencha os dois valores.
5. Em Configurações → Geral → Google Agenda, clique em Conectar e autorize pelo navegador.

## Desenvolvimento

```bash
npm install
npm start        # roda o app em modo desenvolvimento (DevTools abre junto)
npm run dist      # gera o instalador Windows em dist/
```

Não há framework de build nem bundler — os arquivos em `src/html` e `src/js` são servidos como estão pelo Electron.

### Ícone do app

`assets/img/icon.png` (1024×1024) é gerado a partir de `scripts/icon-source.html` — um SVG renderizado num `BrowserWindow` do Electron e salvo em disco. Pra ajustar o mascote, edite o SVG e rode:

```bash
npx electron scripts/generate-icon.js
```

O electron-builder converte esse PNG pro `.ico` do instalador automaticamente (exige no mínimo 256×256 de origem).

### Ícones da interface

Toda a interface usa SVG do conjunto [Lucide](https://lucide.dev/) (ISC license) embutido diretamente no HTML/JS — sem emoji, sem fonte de ícone, sem dependência em tempo de execução. `src/js/Icons.js` guarda o miolo de cada ícone usado (`Icons.svg("nome", tamanho)` devolve a tag `<svg>` pronta, herdando a cor do tema via `currentColor`). Pra adicionar um ícone novo, pegue o path em `unpkg.com/lucide-static/icons/<nome>.svg` e acrescente uma entrada no objeto `ICONS`.

## Arquitetura

- **Processo principal** (`src/js/Main.js`) — dono das janelas, da bandeja do sistema, dos atalhos globais, do alarme e notificações, da sincronização com o Google (`GoogleAuth.js` + `GoogleCalendarSync.js`) e da persistência (`DataManager.js`). Nenhuma janela do renderer tem acesso a Node.js (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
- **Renderer** (`src/js/preload.js` + `Widget.js`, `Settings.js`, `QuickCapture.js`, `Alarm.js`) — cada janela HTML fala com o processo principal só através de um `window.api` restrito, exposto via `contextBridge` com uma lista fechada de canais IPC permitidos.
- **Janelas**: widget (notas/listas/eventos/bichinho), Configurações, captura rápida e o popup de alarme — cada uma é um `BrowserWindow` isolado.
- **Módulos compartilhados** (UMD, `require()` no main e `<script>` global no renderer): `EventUtils.js` (datas/recorrência), `TagUtils.js` (paleta de tags), `TamaSprite.js` (desenho do bichinho em SVG por fórmula) e `Icons.js` (ícones da UI).

## Stack

- [Electron](https://www.electronjs.org/) — runtime desktop
- JavaScript puro no front-end (sem React/Vue/framework nenhum) e CSS com variáveis para os temas
- [electron-builder](https://www.electron.build/) — empacotamento e instalador NSIS
- [Lucide](https://lucide.dev/) — conjunto de ícones SVG da interface
- Google Calendar API v3, via `fetch` nativo do Node/Electron (sem SDK) — só para quem conectar a sincronização

## Licença

MIT — veja [LICENSE](LICENSE).
