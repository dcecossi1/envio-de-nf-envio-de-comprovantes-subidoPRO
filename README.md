# Envio de NFS-e por e-mail com o link da cobrança do Asaas

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
git clone https://github.com/SEU-USUARIO/envio-nfse-por-email.git
cd envio-nfse-por-email
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
  csv.ts           leitor de CSV
  config.ts        .env e arquivo de token
scripts/
  autorizar.ts     autorização da conta Google (uma vez)
  enviar.ts        plano e envio
```

## Limitações conhecidas

- Só lê DANFSe do padrão nacional (v1.0 e v2.0) em PDF com texto.
- Uma cobrança por cliente por mês; parcelamento não é tratado.
- O registro é um arquivo local: se você rodar de máquinas diferentes, leve
  `registro/envios.json` junto ou a trava de reenvio não vale.
- Não emite nota nem cria cobrança — os dois já precisam existir.

## Licença

MIT. Veja [LICENSE](LICENSE).
