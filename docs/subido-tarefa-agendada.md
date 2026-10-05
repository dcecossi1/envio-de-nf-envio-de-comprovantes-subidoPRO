# Tarefa agendada: comprovantes + envio para a Liga Subido PRO

Modelo de instruções para uma **tarefa agendada do app desktop do Claude**
que, uma vez por mês, baixa os comprovantes do Asaas e envia os recebimentos
para a Liga Subido PRO pelo seu Chrome, usando a extensão **Claude in Chrome**.

Copie o bloco abaixo, troque o que está entre `<< >>` e crie a tarefa no app
(seção **Scheduled**), ou peça ao Claude para criá-la com esse texto.

Antes do primeiro dia agendado, clique em **Run now** uma vez: você aprova as
permissões de terminal e de navegador e as rodadas seguintes não param
esperando aprovação.

## Escolha antes: confirmar ou concluir sozinho

O modelo traz duas versões do passo 7. Use **uma**:

- **Com confirmação** (recomendado no começo): a tarefa preenche tudo, para
  antes de "Concluir" e espera você responder na conversa da tarefa.
- **Sem confirmação**: a tarefa conclui sozinha. Só use se você revisa os envios
  depois — um cliente ou valor errado vai direto para a validação.

## Modelo

```
Tarefa mensal: baixar os comprovantes de pagamento do Asaas e enviar os
recebimentos novos para a Liga Subido PRO. Responda em português. Nunca imprima
o conteúdo do .env.

Envie somente os itens listados por `npm run subido -- pendentes`, e somente
no site pro-v5.subido.com.br. Não cadastre cliente nem contrato, não edite nem
exclua nada no Subido.

## Parte 1 — comprovantes
Rode: cd <<CAMINHO DO PROJETO>> && npm run comprovantes
Anote quantos foram baixados e as falhas.

## Parte 2 — janela e pendentes
Rode: cd <<CAMINHO DO PROJETO>> && npm run subido -- pendentes --copiar-para <<SUA PASTA DE RASCUNHO DA SESSÃO>>
Sai um JSON com "dentroDaJanela", "enviar" (pagamento, clienteSubido, valor,
data, titulo, arquivo) e "pulados" (com motivo).
- Se "dentroDaJanela" for false (quinta ou sexta): NÃO envie nada. Avise que
  caiu fora da janela (sábado 00h a quarta 23h59) e quantos estão pendentes.
- Se "enviar" estiver vazio: vá para a notificação.

## Parte 3 — envio no Subido (Claude in Chrome)
Carregue as ferramentas do Claude in Chrome numa única chamada de ToolSearch
(tabs_context_mcp, tabs_create_mcp, navigate, computer, find, read_page,
javascript_tool, file_upload, browser_batch, get_page_text). Trabalhe numa aba
nova. Se a extensão não estiver conectada ou o Subido pedir login, pare e avise
— nunca digite senha.

Antes de começar, abra https://pro-v5.subido.com.br/ e anote "Total de envios".

Para cada item de "enviar", um de cada vez:
1. Abra https://pro-v5.subido.com.br/recebimentos/adicionar-recebimentos e
   espere 3 segundos.
2. Selecione o cliente por TEXTO EXATO — a lista é virtualizada e clicar por
   referência pode escolher o cliente vizinho. Com javascript_tool, troque ALVO
   pelo clienteSubido:
   const espera=(ms)=>new Promise(r=>setTimeout(r,ms));const combo=()=>[...document.querySelectorAll('[role=combobox]')];const alvo='ALVO';if(combo()[0].getAttribute('aria-expanded')!=='true'){combo()[0].click();await espera(900);}let opt;for(let i=0;i<40&&!opt;i++){opt=[...document.querySelectorAll('[role=option]')].find(o=>o.innerText.trim()===alvo);if(!opt){const lb=document.querySelector('[role=listbox]');if(!lb)break;lb.scrollTop+=200;await espera(150);}}if(!opt)throw new Error('cliente não achado');opt.scrollIntoView({block:'center'});await espera(200);opt.click();await espera(2000);combo()[1].click();await espera(1200);({cliente:combo()[0].innerText.trim(),contratos:[...document.querySelectorAll('[role=option]')].map(o=>o.innerText.trim())})
   Confirme que "cliente" é exatamente o clienteSubido; se não for, pule o item.
3. Contrato (texto "dd/mm/aaaa - dd/mm/aaaa"): com um contrato só, use ele —
   a data de fim cadastrada não impede o envio. Com mais de um, use o que
   cobre a data do pagamento; se nenhum cobrir, o de início mais recente.
   Clique na opção pelo texto exato.
4. Clique em "Continuar". Confira o nome do cliente no topo; se diferente, saia
   pelo link "Início" do menu lateral e pule o item.
5. Preencha: "Valor do recebimento" = só os dígitos (1.900,00 → 190000);
   "Data do recebimento" = só os dígitos (10/10/2026 → 10102026); "Sobre o
   envio" = titulo exato. Anexe o PDF de "arquivo" com file_upload no campo
   "Comprovante de Pagamento" e confirme "Arquivo adicionado".
6. Screenshot: confira valor, data, título e arquivo. Se algo estiver errado,
   saia pelo link "Início" e pule o item.

7. (VERSÃO COM CONFIRMAÇÃO) Mostre o resumo do item e pergunte "Concluir este
   envio?". Só clique em "Concluir" depois de um "sim". Sem resposta, saia pelo
   link "Início" e reporte como pendente.
7. (VERSÃO SEM CONFIRMAÇÃO) O dono da conta autorizou concluir sem perguntar.
   Clique em "Concluir".

8. Confirme o sucesso (mensagem de sucesso, ou "Total de envios" maior). Só
   então rode: cd <<CAMINHO DO PROJETO>> && npm run subido -- registrar <pagamento>
   Sem confirmação de sucesso, NÃO registre e reporte "incerto — conferir".

Nunca clique em "Adicionar outro recebimento", "Cadastrar cliente",
"Adicionar contrato" ou "Excluir". Se algo travar 2 ou 3 vezes, pare e relate.
Feche as abas que você abriu.

## Notificação e resumo
Mande UMA notificação (PushNotification, status "proactive", menos de 200
caracteres) com o que foi enviado e o que ficou de fora. Comece com
"ATENÇÃO:" se algo falhou. "Sem contrato (fica de fora por regra)" não é falha.
Termine com o resumo: comprovantes baixados, envios concluídos (cliente, valor,
data), pulados com motivo, itens incertos.
```

## Por que o envio é pelo navegador

O Subido não oferece API pública, e o login é seu. Copiar cookie ou senha para
um robô expõe sua conta; dirigir o seu próprio navegador, com você logado, não.
O custo é que o app do Claude e o Chrome precisam estar abertos no horário.
