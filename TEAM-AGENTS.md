# Optional Agent Teams mode

This template works with ordinary subagents by default. It can also reuse the same `.claude/agents/*.md` definitions as Claude Code Agent Teams teammates when cross-layer work benefits from direct communication and a shared task list.

> Agent Teams is experimental, disabled by default, uses more tokens, and has known limitations. Use it deliberately; `/feature-loop` remains the default workflow.

[English](#english) · [Українська](#українська)

## English

### Enable it

Check the installed version:

```bash
claude --version
```

Follow the current minimum version in the official Agent Teams documentation. Then opt in through your shell environment or add this `env` block to `.claude/settings.json` and restart Claude Code:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

If `.claude/settings.json` already contains `hooks`, merge the `env` property at the top level; do not replace the hooks.

The template does not enable this flag by default because experimental team mode has higher coordination/token cost and is unnecessary for sequential tasks.

### Start a team iteration

```text
/team-feature-loop <feature request or docs/tasks/task.md>
```

Or ask naturally:

```text
Spawn a teammate using the backend-agent agent type to implement the API scope,
and a teammate using the frontend-agent agent type to implement the UI scope.
They must message each other directly if the contract changes.
```

The existing agent definition supplies the teammate's model, tool allowlist, and additional role instructions. Team coordination and task tools remain available. Project/user skills and MCP servers load as in a normal session; `skills` and `mcpServers` fields from agent frontmatter are not applied to teammates.

### When teams are appropriate

Use Agent Teams for:

- backend/frontend/integration work with disjoint file ownership;
- parallel research, security, performance, or competing debugging hypotheses;
- work where teammates must communicate directly rather than only report to the lead.

Prefer ordinary `/feature-loop` subagents for sequential work, small changes, shared-file edits, or tightly dependent steps.

### Scope safety

Ordinary `/work-task` uses `.claude/.active-task-scope.json`. Multiple independent sessions must not overwrite that shared file.

`/team-feature-loop` reads the generated runtime team config after teammates spawn and creates one scope file per Claude session:

```text
.claude/.active-task-scope.<session_id>.json
```

`scope-guard.js` checks the current hook `session_id`. If team-scope files exist but the current session has no matching file, edits are blocked. This prevents one teammate from silently inheriting another teammate's Scope. Runtime team config under `~/.claude/teams/` is read-only for this workflow and must never be edited manually.

Even with per-session enforcement, assign different files to different teammates. Two sessions editing the same file can overwrite each other.

### Worktrees

`git worktree` is useful for independent Claude sessions, benchmarks, or separate branches. It is not part of the Agent Teams loop.

Run `/team-feature-loop` inside one checkout when teammates need direct communication and a shared task list for one feature. Use separate worktrees when sessions should not share `.claude/.active-task-scope.json`, staged changes, or working files.

### Team lifecycle

- The main session is the lead; teammates have independent context windows.
- Use the shared task list and explicit dependencies.
- Teammates message each other directly and notify the lead of results.
- Wait for implementation teammates before documentation and final quality gates.
- End at human review; do not merge without explicit approval.
- Current Claude Code creates the team when the first teammate spawns and removes runtime team resources automatically when the session ends. Do not use obsolete `TeamCreate`/`TeamDelete` instructions.

Official reference: [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) and [Hooks reference](https://code.claude.com/docs/en/hooks).

---

## Українська

### Увімкнення

Перевір установлену версію:

```bash
claude --version
```

Звір актуальну мінімальну версію з офіційною документацією Agent Teams. Потім увімкни режим через environment змінну або додай цей блок `env` у `.claude/settings.json` і перезапусти Claude Code:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Якщо `.claude/settings.json` уже містить `hooks`, додай `env` на верхньому рівні й не замінюй hooks.

Шаблон не вмикає прапорець автоматично: experimental team mode витрачає більше токенів і додає coordination overhead, який не потрібен послідовним таскам.

### Запуск командної ітерації

```text
/team-feature-loop <feature request або docs/tasks/task.md>
```

Або природною мовою:

```text
Spawn a teammate using the backend-agent agent type для API scope
і teammate using the frontend-agent agent type для UI scope.
При зміні контракту вони мають повідомити одне одного напряму.
```

Наявний agent definition передає тіммейту model, tool allowlist і додаткові рольові інструкції. Team coordination та task tools залишаються доступними. Project/user skills і MCP servers завантажуються як у звичайній сесії; поля `skills` і `mcpServers` із agent frontmatter для тіммейтів не застосовуються.

### Коли використовувати команду

Agent Teams доречні для:

- backend/frontend/integration робіт із різними файлами у власності;
- паралельного research, security/performance review або перевірки різних debugging hypotheses;
- задач, де тіммейтам треба спілкуватися напряму, а не лише звітувати ліду.

Для послідовних етапів, малих змін, редагування спільних файлів і тісно залежних кроків краще звичайний `/feature-loop` із subagents.

### Безпечний Scope

Звичайний `/work-task` використовує `.claude/.active-task-scope.json`. Кілька незалежних сесій не повинні перезаписувати цей спільний файл.

Після spawn `/team-feature-loop` читає згенерований runtime team config і створює окремий файл для кожної Claude-сесії:

```text
.claude/.active-task-scope.<session_id>.json
```

`scope-guard.js` перевіряє поточний hook `session_id`. Якщо team-scope файли існують, але поточна сесія не має відповідного файла, редагування блокується. Так Scope одного тіммейта не успадковується іншим. Runtime-конфіг у `~/.claude/teams/` у цьому workflow лише читається — його не можна редагувати вручну.

Навіть із per-session enforcement різні тіммейти мають володіти різними файлами. Одночасне редагування одного файла може призвести до перезапису.

### Worktrees

`git worktree` корисний для незалежних Claude-сесій, benchmark-ів або окремих branches. Це не частина Agent Teams loop.

Запускай `/team-feature-loop` в одному checkout, коли teammates мають прямо спілкуватися і користуватися shared task list для однієї фічі. Використовуй окремі worktrees, коли сесії не повинні ділити `.claude/.active-task-scope.json`, staged changes або робочі файли.

### Життєвий цикл команди

- Головна сесія є lead; кожен teammate має незалежний context window.
- Використовуй shared task list та явні dependencies.
- Тіммейти спілкуються напряму і повідомляють lead про результат.
- Дочекайся implementation teammates перед документацією та фінальними quality gates.
- Завершуй на human review; merge потребує окремого дозволу.
- Актуальний Claude Code формує команду під час першого spawn і автоматично прибирає runtime team resources після завершення сесії. Не використовуй застарілі інструкції `TeamCreate`/`TeamDelete`.

Офіційні джерела: [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) та [Hooks reference](https://code.claude.com/docs/en/hooks).
