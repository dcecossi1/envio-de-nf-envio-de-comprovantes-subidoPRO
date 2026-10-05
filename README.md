# Envio de NF + envio de comprovantes SubidoPRO

Envio de NFS-e por e-mail com o link da cobrança do Asaas, download dos comprovantes de pagamento e envio dos recebimentos para a Liga Subido PRO.

> Também baixa os comprovantes de pagamento do Asaas, organizados por cliente e mês — veja [Comprovantes de pagamento](#comprovantes-de-pagamento) — e prepara o envio desses recebimentos para a Liga Subido PRO — veja [Envio para a Liga Subido PRO](#envio-para-a-liga-subido-pro).

Todo mês a mesma tarefa: emitir as notas fiscais de serviço, achar a cobrança
de cada cliente e mandar um e-mail com o PDF anexado e o link para pagar. Este
projeto faz isso em um comando, sem abrir o Gmail e sem copiar link nenhum.

O que ele faz, na ordem:

1. lê os PDFs das notas em uma pasta e extrai número, competência, CNPJ do
   tomador e valor de cada uma;
2. descobre para quem enviar, casando o **CNPJ do tomador** com uma lista sua
   (arquivo CSV ou planilha do Google Sheets);
3. procura no Asaas a cobrança daquele cliente com vencimento no mês;
4. mostra o plano — quem recebe o quê, e o motivo de cada nota que ficou de
   fora — e **não envia nada** até você mandar;
5. envia pelo Gmail da conta que você autorizou, com o PDF em anexo e o link
   da fatura no corpo;
6. anota o que saiu, para que rodar de novo não reenvie.

Nada é enviado sem que você peça, e existe um modo de teste que manda tudo
para o seu próprio endereço antes de falar com cliente nenhum.

## O que você precisa antes de começar

| Requisito | Como conseguir |
| --- | --- |
| **Node.js 20 ou mais novo** | <https://nodejs.org> — confira com `node -v` |
| **poppler** (fornece o `pdftotext`) | macOS: `brew install poppler` · Ubuntu/Debian: `sudo apt install poppler-utils` · Windows: <https://github.com/oschwartz10612/poppler-windows/releases> e adicione a pasta `bin` ao PATH |
| **Conta no Asaas** com as cobranças cadastradas | <https://www.asaas.com> |
| **Chave de API do Asaas** | Painel → Integrações → Chaves de API |
| **Conta Google** para enviar os e-mails | qualquer Gmail ou Google Workspace |
| **Credencial OAuth do Google** | Google Cloud Console (passo 3 abaixo) |
| **Notas em PDF** no padrão nacional (DANFSe) | baixadas do portal da sua prefeitura |

### Sobre o formato das notas

O leitor entende o **DANFSe do padrão nacional da NFS-e**, versões 1.0 e 2.0 —
o PDF que a maioria das prefeituras emite desde 2023. Ele precisa de PDF com
texto: nota que é só imagem escaneada não é lida, e o programa avisa quais
arquivos ficaram de fora em vez de errar em silêncio.

Layout municipal antigo, fora do padrão nacional, não é suportado. Para
adaptar, mexa em `src/nfse.ts` — é o único arquivo que sabe o formato da nota.

## Passo a passo

### 1. Baixar e instalar

```bash
git clone https://github.com/SEU-USUARIO/envio-de-nf-envio-de-comprovantes-subidoPRO.git
cd envio-de-nf-envio-de-comprovantes-subidoPRO
npm install
```

### 2. Criar a chave de API do Asaas

No painel do Asaas: **Integrações → Chaves de API → criar**. A chave aparece
uma única vez, então copie na hora.

Duas recomendações que valem mais que qualquer código deste repositório:

- **Dê o mínimo de permissão.** Este projeto só precisa **ler clientes** e
  **ler cobranças**. Se quiser que o PDF também fique anexado na fatura, aí sim
  cobranças precisa de escrita.
- **Nunca habilite saque/transferência via API nesta chave.** Se a lista de
  permissões da sua conta não separar isso, mantenha o bloqueio de saque via
  API ativo nas configurações de segurança.

Chave do Asaas desativa sozinha após 3 meses sem uso e expira em 6 meses.
Anote a data de renovação em algum lugar visível.

### 3. Criar a credencial do Google

No [Google Cloud Console](https://console.cloud.google.com/):

1. crie um projeto (ou use um que já tenha);
2. em **APIs e serviços → Biblioteca**, ative a **Gmail API**;
3. em **Tela de permissão OAuth**, escolha **Externo**, preencha o nome do app e
   o seu e-mail de contato, e adicione a si mesmo em **Usuários de teste**
   (enquanto o app estiver em modo de teste, só quem está nessa lista consegue
   autorizar — o que é exatamente o que você quer);
4. em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha o tipo
   **App para computador**;
5. guarde o **ID do cliente** e a **chave secreta do cliente**.

O único acesso pedido no envio é `gmail.send`: permite enviar e nada mais — não
lê, não lista e não apaga mensagem nenhuma. Se você optar por manter a lista de
destinatários numa planilha do Google, o programa também pede leitura do Drive,
apenas para exportar aquela aba.

### 4. Preencher o `.env`

```bash
cp .env.example .env
```

Abra o `.env` e preencha a chave do Asaas, as credenciais do Google, o
**CNPJ de quem emite as notas** (nota de outro emitente é recusada, o que evita
enviar por engano um PDF que caiu na pasta) e a assinatura do e-mail.

O `.env` está no `.gitignore`. Não versione, não cole em chat, não mande por
e-mail.

### 5. Montar a lista de destinatários

O CNPJ é o que liga a nota ao cliente — nome de empresa muda de grafia, CNPJ
não. Duas opções:

**a) Arquivo local** (mais simples):

```bash
cp destinatarios.exemplo.csv destinatarios.csv
```

```csv
cliente,cnpj,emails,observacao
Empresa Exemplo Ltda,12.345.678/0001-90,financeiro@exemplo.com.br,
Outra Empresa SA,98.765.432/0001-10,contas@outra.com.br; nfe@outra.com.br,
Cliente Sem Nota,,,não emite nota
```

Mais de um destinatário no mesmo cliente: separe por `;`. Linha sem CNPJ válido
fica de fora do envio, e o texto da coluna `observacao` aparece no plano como
motivo.

**b) Planilha do Google Sheets**, se a lista é mantida em equipe: preencha
`PLANILHA_ID` e `PLANILHA_GID` no `.env` (os dois saem da URL da planilha) e use
as mesmas colunas. A planilha é lida a cada execução, então mudou lá, mudou aqui.

### 6. Autorizar a conta que envia

```bash
npm run autorizar
```

Abre o consentimento do Google no navegador. Ao confirmar, o token fica em
`.google-token.json` (fora do Git, com permissão de leitura só para o seu
usuário). Isso é uma vez só.

> Na tela de aviso "app não verificado", **Avançado → Acessar (não seguro)** é o
> caminho: o "app" é este script rodando na sua máquina, autorizado por você.

### 7. Ver o plano

Coloque os PDFs numa pasta (ex.: `./notas`) e rode:

```bash
npm run enviar -- --pasta ./notas --competencia 2026-09
```

Saída de exemplo:

```
Pasta /home/voce/notas: 9 PDF(s), 9 nota(s) da competência 09/2026.

Cliente          NF   Valor        Cobrança                   Para                 Situação
---------------  ---  -----------  -------------------------  -------------------  ----------------------------------
Empresa Exemplo  100  R$ 3.500,00  10/09 R$ 3.500,00 PENDING  financeiro@exe.com   pronto
Outra Empresa    101  R$ 1.900,00  10/09 R$ 1.900,00 PENDING  contas@outra.com     pronto
Terceira Ltda    107  R$ 2.000,00  —                          fin@terceira.com     sem cliente no Asaas com esse CNPJ

Cobranças vencendo em 09/2026 sem nota na pasta:
  - Quarta Empresa: 15/09 R$ 1.650,00 PENDING

2 pronta(s) para enviar. Nada foi enviado — use --teste ou --enviar.
```

Repare nas duas listas. A de cima é o que vai sair, com o motivo de cada nota
barrada. A de baixo é o contrário: cobrança que existe no Asaas e cuja nota
ainda não está na pasta — normalmente é nota que você esqueceu de emitir.

### 8. Testar em você mesmo

```bash
npm run enviar -- --pasta ./notas --competencia 2026-09 --teste voce@empresa.com
```

Manda todos os e-mails para o seu endereço, com `[TESTE]` no assunto e o
conteúdo idêntico ao que o cliente receberia. Nada é registrado nem anexado no
Asaas. Confira o anexo e o link antes de seguir.

### 9. Enviar

```bash
npm run enviar -- --pasta ./notas --competencia 2026-09 --enviar
```

Cada envio é anotado em `registro/envios.json`. Rodar o mesmo comando de novo
mostra as notas já enviadas como `já enviada em ...` e não manda nada — dá para
emitir uma nota que faltou, rodar outra vez e só ela sair.

## Comprovantes de pagamento

Para cada cobrança paga no Asaas, baixa o comprovante em PDF e salva tudo numa
pasta só, com o nome do cliente e o mês em que ele pagou:

```
comprovantes/
  Comprovante Empresa Exemplo 09-2026.pdf
  Comprovante Outra Empresa 09-2026.pdf
  Comprovante Outra Empresa 10-2026.pdf
```

```bash
npm run comprovantes                           # mês atual e o anterior
npm run comprovantes -- --mes 2026-09          # só setembro de 2026
npm run comprovantes -- --pasta ~/Comprovantes # salvar em outra pasta
```

- **O mês é o do pagamento**, não o do vencimento. Cobrança que venceu em
  setembro e foi paga em outubro sai como `10-2026`.
- **Sem `--mes`, o mês anterior entra junto.** Assim quem pagou atrasado depois
  da última rodada não fica de fora.
- **Rodar de novo não duplica.** Arquivo que já existe é pulado. Se o mesmo
  cliente pagar duas vezes no mesmo mês, o segundo vira `... (2).pdf`.
- **O nome vem da sua lista de destinatários**, casado pelo CNPJ — o nome
  cadastrado no Asaas às vezes vem truncado. Cliente fora da lista usa o nome do
  Asaas, e sem lista nenhuma o download funciona do mesmo jeito.
- A pasta `comprovantes/` está no `.gitignore`.

Usa só leitura de clientes e de cobranças na chave do Asaas. A API não entrega
o PDF diretamente: entrega o link da página pública do comprovante, e o PDF sai
do botão "Baixar pdf" dessa página. Se o Asaas mudar a página, o comando falha
com uma mensagem clara em vez de salvar um arquivo errado.

### Rodar todo mês sozinho

Exemplo: todo dia 25 às 9h. Ajuste o caminho do projeto.

**macOS e Linux** (`crontab -e`):

```
0 9 25 * * cd /caminho/para/envio-de-nf-envio-de-comprovantes-subidoPRO && npm run --silent comprovantes >> comprovantes.log 2>&1
```

No macOS, o `cron` precisa de **Acesso Total ao Disco** (Ajustes do Sistema →
Privacidade e Segurança) se a pasta de destino for Downloads ou Documentos.

**Windows** (Agendador de Tarefas): ação "Iniciar um programa", programa
`cmd.exe`, argumentos `/c cd /d C:\caminho\para\envio-de-nf-envio-de-comprovantes-subidoPRO && npm run comprovantes`.

O computador precisa estar ligado no horário. O comando sai com código 1 se
algum comprovante falhar, o que permite plugar um aviso por e-mail ou chat.

## Envio para a Liga Subido PRO

Para quem participa da **Liga Subido PRO**, programa que pontua agências pelo
faturamento comprovado de clientes. Cada recebimento de cliente **com
contrato** vira um envio no site: cliente, contrato, valor, data, um título e o
comprovante.

O Subido não tem API pública e o login é seu, então o envio é feito **no seu
navegador**, pela extensão Claude in Chrome, numa tarefa agendada do app do
Claude. Este projeto entrega os dados de cada envio e anota o que já foi.

### Como o site funciona

1. **Novo envio** → escolha o **cliente** e o **contrato** → Continuar.
2. Preencha **valor do recebimento**, **data do recebimento**, **sobre o
   envio** (um título) e anexe o **comprovante** (JPG, PNG ou PDF, até 5 MB) →
   Concluir.
3. **Janela de envio: sábado 00h00 a quarta 23h59.** Quinta é validação,
   sexta às 22h sai o resultado. A pontuação só entra depois de aprovado.
4. Só pontuam os serviços aceitos (tráfego, criação de anúncios, sites, CRM,
   rastreamento, social media e outros) — confira em "Serviços aceitos".

### Passo a passo

**1. Requisitos extras**

- App desktop do Claude, com **tarefas agendadas** (seção Scheduled).
- Extensão **[Claude in Chrome](https://chromewebstore.google.com/detail/fcoeoabgfenejglbffodgkkbkcdhcgfn)**
  instalada e conectada com a mesma conta do app.
- Você logado no Subido nesse Chrome.
- Os comprovantes já funcionando (`npm run comprovantes`, seção anterior).

**2. Ligue cada cliente do Asaas ao nome dele no Subido**

```bash
cp subido-clientes.exemplo.json subido-clientes.json
```

```json
{
  "clientes": {
    "12345678000190": "Empresa Exemplo",
    "98765432000110": "Outra Empresa Ltda",
    "11122233344": null
  }
}
```

- A chave é o CPF/CNPJ do cliente no Asaas, só dígitos. O nome do Subido muda
  de grafia em relação ao Asaas; o documento não.
- O valor é o nome **exatamente** como aparece na lista de clientes em Novo
  envio.
- **Só entra quem tem contrato.** Cliente que paga mas não tem contrato fica
  com `null`: ele é pulado de propósito e não aparece como problema.
- Cliente que não está no arquivo aparece como "cliente novo — decidir se
  entra". Assim ninguém novo é enviado sem você decidir.

O arquivo fica fora do Git.

**3. Diga a partir de quando os pagamentos entram**

No `.env`, `SUBIDO_INICIO=2026-10-01` — o primeiro dia do mês que você **ainda
não enviou à mão**. Pagamentos anteriores nunca entram, então não há risco de
duplicar o que você já mandou.

**4. Veja o que seria enviado**

```bash
npm run subido -- pendentes
```

Sai um JSON com `dentroDaJanela`, a lista `enviar` (cliente no Subido, valor,
data, título no formato `Cliente - pagamento MM/AAAA` e o caminho do PDF) e a
lista `pulados`, cada um com o motivo. Nada é enviado por este comando.

**5. Crie a tarefa agendada**

Siga **[docs/subido-tarefa-agendada.md](docs/subido-tarefa-agendada.md)**: é o
texto completo da tarefa, com duas versões — **com confirmação** antes de cada
"Concluir" (recomendada no começo) ou **sem confirmação**, se você revisa
depois. A tarefa:

- baixa os comprovantes do mês;
- confere se o dia está dentro da janela — se não estiver, só avisa;
- para cada pendente, preenche o formulário no seu Chrome, escolhendo o
  contrato do cliente (com mais de um, o que cobre a data do pagamento);
- depois de cada envio concluído, roda `npm run subido -- registrar <id>`, que
  anota em `registro/subido.json` — **é essa anotação que impede reenvio**;
- termina com uma notificação do que foi enviado e do que ficou de fora.

Uma data boa é o **dia 26**: os vencimentos do mês já passaram e, na maioria
dos meses, o dia cai dentro da janela. Quando não cair, a tarefa avisa.

**6. Rode uma vez antes do primeiro dia**

No app, clique em **Run now** na tarefa. Você aprova as permissões de terminal
e de navegador uma vez e as rodadas seguintes não param esperando.

### Armadilhas já conhecidas

- **A lista de clientes do formulário é virtualizada.** Clicar no item por
  posição ou referência já selecionou o cliente vizinho. O modelo de tarefa
  seleciona pelo texto exato e confere o nome de novo antes de preencher.
- **O upload do Claude in Chrome só aceita arquivos de pastas que a sessão pode
  ler.** Por isso `pendentes --copiar-para <pasta>` copia os PDFs para a pasta
  de rascunho da sessão antes do anexo.
- **A data de fim do contrato no Subido não impede o envio.** Com um contrato
  só, ele é usado. Se você prefere pular contrato vencido, troque o passo 3 do
  modelo da tarefa.
- O app do Claude e o Chrome precisam estar abertos no horário. Se estiverem
  fechados, a tarefa roda quando o app abrir de novo.

## Opções

| Opção | Para que serve |
| --- | --- |
| `--pasta <caminho>` | onde estão os PDFs (obrigatório) |
| `--competencia AAAA-MM` | mês da nota, lido de dentro do PDF (obrigatório) |
| `--enviar` | envia de verdade, para os clientes |
| `--teste <e-mail>` | manda tudo só para esse endereço, com `[TESTE]` no assunto |
| `--so acme,contoso` | limita a clientes cujo nome contém um desses trechos |
| `--permitir-sem-cobranca` | envia mesmo sem cobrança no Asaas; o e-mail sai sem o link |
| `--ignorar-valor` | envia mesmo se o valor da nota diferir do da cobrança |

No `.env` ainda há `ANEXAR_NA_COBRANCA=true`, que além do e-mail anexa o PDF na
própria fatura do Asaas — o cliente passa a ver a nota na página de pagamento.
Isso exige permissão de escrita em cobranças na chave de API.

## Como cada nota é ligada à cobrança certa

1. O CNPJ do tomador sai de dentro do PDF, nunca do nome do arquivo (nome de
   arquivo vem com erro de digitação mais vezes do que se imagina).
2. Esse CNPJ acha o cliente no Asaas e a linha na sua lista de destinatários.
3. Entre as cobranças daquele cliente com vencimento no mês, vale a mais antiga
   ainda em aberto; se todas estiverem pagas, a mais recente.
4. Se o valor da nota não bate com o da cobrança, a nota não sai — é quase
   sempre sinal de nota errada ou cobrança alterada.

## Segurança

- **Segredos ficam em arquivos locais ignorados pelo Git**: `.env` e
  `.google-token.json`. Nunca versione, nunca cole em chat.
- **O e-mail sai da sua própria conta** e fica na pasta "Enviados" dela. Não há
  servidor de e-mail intermediário nem remetente falso.
- **Dados de cliente não entram no repositório**: `destinatarios.csv`,
  `registro/` e qualquer `*.pdf` estão no `.gitignore`.
- **Se um segredo vazar, troque, não torça**: gere uma chave nova no Asaas e
  apague a antiga; para o Google, remova o acesso do app em
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e
  rode `npm run autorizar` de novo.

## Problemas comuns

| Mensagem | O que fazer |
| --- | --- |
| `pdftotext não encontrado` | instale o poppler (veja a tabela de requisitos) |
| `não achei chave de acesso, número...` | o PDF não é DANFSe do padrão nacional ou não tem texto |
| `CNPJ ... não está na lista de destinatários` | acrescente o cliente ao CSV ou à planilha |
| `sem cliente no Asaas com esse CNPJ` | cadastre o cliente no Asaas ou use `--permitir-sem-cobranca` |
| `emitente diferente do CNPJ_EMITENTE` | o PDF é de outro prestador, ou o `CNPJ_EMITENTE` do `.env` está errado |
| `o Google não devolveu refresh token` | remova o acesso em myaccount.google.com/permissions e autorize de novo |
| `insufficient_permission` (Asaas) | a chave não tem permissão para essa operação; revise as permissões dela |
| `a planilha não veio como CSV` | a conta autorizada não tem acesso à planilha, ou o `PLANILHA_GID` está errado |

## Estrutura

```
src/
  nfse.ts          leitura do DANFSe (v1.0 e v2.0) — o único arquivo que conhece o formato da nota
  asaas.ts         API do Asaas: lê clientes e cobranças, anexa documento
  google.ts        renovação do token, envio pelo Gmail, export da planilha
  destinatarios.ts casamento por CNPJ entre nota e lista de e-mails
  registro.ts      registro do que já saiu (trava contra reenvio)
  comprovantes.ts  nome dos arquivos de comprovante (usado pelos dois scripts)
  csv.ts           leitor de CSV
  config.ts        .env e arquivo de token
scripts/
  autorizar.ts     autorização da conta Google (uma vez)
  enviar.ts        plano e envio
  comprovantes.ts  download dos comprovantes de pagamento
  subido.ts        pendentes e registro dos envios para a Liga Subido PRO
docs/
  subido-tarefa-agendada.md  modelo da tarefa agendada que envia pelo navegador
```

## Limitações conhecidas

- Só lê DANFSe do padrão nacional (v1.0 e v2.0) em PDF com texto.
- Uma cobrança por cliente por mês; parcelamento não é tratado.
- O registro é um arquivo local: se você rodar de máquinas diferentes, leve
  `registro/envios.json` junto ou a trava de reenvio não vale.
- Não emite nota nem cria cobrança — os dois já precisam existir.

## Licença

MIT. Veja [LICENSE](LICENSE).
