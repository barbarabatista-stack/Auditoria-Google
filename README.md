# Painel– Auditoria Google

Painel semanal que mostra vazamentos de dados, apps conectados e a segurança das contas Google Workspace ou Microsoft 365 admin (Nesse projeto será o GOOGLE). O intuito do projeto é usar ferramentas que não gerem custos adicionais, por isso vamos usar APP Script, Drive e planilhas.

Feito em **Google Apps Script**, publicado como **App da Web**. Ele só **lê** dados: não altera regras, contas nem configurações do Workspace. (Com possibilidade de permitir alteração)

---

## O que o painel mostra

| Aba | Conteúdo | Atualização |
|---|---|---|
| **Regras de DLP** | Alertas que você deseja, histórico por semana, quem enviou e todos os tipos de dado comparados com a semana anterior | Semanal |
| **Apps de terceiros** | Apps em que alguém entrou com a conta corporativa, com acessos sensíveis. Botões **Aprovar** e **Reprovar**: Aprovados saem da lista de aplicativos não permitidos, reprovados ficam em destaque para realizar o bloqueio. O aplicativo foi criado apenas com a função de visualizador, mas o modelo de ação dele você pode definir. | Dashboard atualizado Semanalmente |
| **Usuários** | Total de contas, ativas, suspensas e sem login há mais de X meses | Na hora |
| **MFA** | Contas sem verificação em duas etapas, com administradores primeiro | Na hora |


## Como funciona

1. Toda **segunda-feira às 6h**, um acionador lê a semana anterior (segunda a domingo) nos logs do Workspace.
2. A leitura é feita **um dia por vez**. Se o tempo da execução acabar (o limite do Google é de 6 minutos), o script agenda a continuação para 1 minuto depois, até terminar.
3. Os resultados ficam numa planilha no Drive (Podendo ser conectado a um banco de dados): **DLP – Histórico semanal**.
4. A página lê essa planilha. Usuários e MFA são lidos direto do diretório quando a aba é aberta.

### Fontes de dados (Admin SDK)

| Dado | API | Origem |
|---|---|---|
| Eventos de DLP | Reports API (`rregras`) | Log de regras |
| Apps autorizados | Reports API (`token`, evento `authorize`) | Log de OAuth |
| Datas de suspensão | Reports API (`admin`, evento `SUSPEND_USER`) | Log de admin (A definir) |
| Contas e MFA | Directory API (`users.list`) | Diretório |

---

## Arquivos

```
├── Codigo.gs          # Coleta dos dados, planilha e servidor da página
├── Pagina.html        # Visual da página (abas, listas, botões)
├── appsscript.json    # Manifesto: fuso, serviços avançados e acesso
└── README.md
```

## Pré-requisitos

- Conta **administradora** do Google Workspace.
- Serviços avançados ativados no projeto:
  - **Admin SDK API** – versão `reports_v1`, identificador `AdminReports`
  - **Admin SDK API** – versão `directory_v1`, identificador `AdminDirectory`

---

## Instalação

1. Em [script.google.com](https://script.google.com), crie um projeto.
2. Em **Configurações do projeto**, marque **Mostrar arquivo de manifesto "appsscript.json"**.
3. Crie os arquivos `Codigo.gs`, `Pagina.html` e `appsscript.json` e cole o conteúdo deste repositório. Salve.
4. Execute **`testarConexao`** e autorize. O registro deve mostrar "DLP OK", "Apps OK" e "Diretório OK".
5. Execute **`carregarHistorico`** uma vez. Ele carrega as últimas semanas e continua sozinho até terminar (acompanhe em **Execuções**).
6. Publique em **Implantar > Nova implantação > App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Somente eu**
   - Nas configurações você pode definir quem pode acessar e ter permissão de alteração
7. Execute **`instalar`** para agendar a atualização semanal.

### Atualizar o código depois

Cole os arquivos novos, salve e vá em **Implantar > Gerenciar implantações > Editar > Nova versão > Implantar**. Sem a nova versão, o link continua usando o código antigo.

---

## Configuração

Tudo fica no objeto `CONFIG`, no início do `Codigo.gs`:

| Opção | Padrão | Para que serve |
|---|---|---|
| `SENSIVEIS` | CPF, Cartão | Foram o que eu defini, mas fica de acordo com o que você deseja |
| `LIMITE_ACIMA_DO_NORMAL` | `A definir` | Alta (%) sobre a média das semanas anteriores que marca "Acima do normal" |
| `MAX_REMETENTES_POR_SEMANA` | `A definir` | Remetentes guardados por semana |
| `SEMANAS_INICIAIS` | `A definir` | Semanas carregadas pelo `carregarHistorico` |
| `SEMANAS_NA_PAGINA` | `A definir` | Semanas disponíveis no seletor |
| `MESES_SEM_LOGIN` | `A definir` | Meses sem login para a conta entrar na lista de inativas |
| `HORA_ATUALIZACAO` | `A definir` | Hora da atualização de segunda-feira |
| `APPS_APROVADOS` | Sua lista | Termos no nome do app que o tornam aprovado |
| `REGRAS_OCULTAS` | |Regras guardadas na planilha, mas escondidas do painel |

---

## Planilha de histórico (Modelo usado nessa versão)

| Aba | Conteúdo |
|---|---|
| Resumo semanal | Eventos por regra e semana |
| Remetentes sensíveis | Quem disparou as regras sensíveis, por semana |
| Apps autorizados | Apps por semana, com usuários e acessos |
| Apps conhecidos | Primeira vez que cada app apareceu |
| Decisões de apps | Aprovações e reprovações feitas no painel (apague a linha para desfazer) |
| Controle | Semanas concluídas |
| Progresso diário | Dados temporários enquanto a semana é lida |

---

## Funções

| Função | Uso |
|---|---|
| `testarConexao()` | Confere o acesso aos logs e ao diretório |
| `carregarHistorico()` | Carga inicial das semanas (continua sozinha) |
| `atualizarSemanaAnterior()` | Lê a semana passada (usada pelo acionador) |
| `instalar()` / `desinstalar()` | Cria ou remove o agendamento semanal |
| `decidirApp(id, nome, decisao)` | Chamada pelos botões Aprovar e Reprovar |

---

## Segurança e privacidade

- O painel mostra e-mails de colaboradores. Mantenha o acesso da implantação como **Somente eu**, ou restrito à equipe de segurança.
- O script só lê dados. As únicas gravações são na planilha de histórico.
- O código não contém senhas nem chaves. O ID da planilha fica nas propriedades do script.

---

## Limitações

- A semana em andamento não aparece. O painel mostra até o domingo anterior.
- Apps conectados antes da semana não aparecem na aba Apps, só as autorizações feitas na semana.
- Datas de suspensão só existem para os últimos 180 dias.
- O agendamento roda com a conta de quem instalou. Se ela perder o acesso de administradora, a atualização para.
