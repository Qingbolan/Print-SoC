# Use Print@SoC with an agent

The [print-soc skill](../plugins/print-soc/skills/print-soc/SKILL.md) gives Codex,
Claude Code and other local agents a workflow for setup, printer selection,
document preparation, printing, tracking and maintenance. It uses the actual
CLI/desktop and optional MCP server; it does not bundle credentials or a printer.

## Give your agent this prompt

> Read https://github.com/Qingbolan/Print-SoC/blob/main/AGENTS.md and use its print-soc skill to set up SoC printing on my computer, find an accessible printer near me, and prepare my document and print settings; show me the preview and selected settings before sending a print job, and let me enter passwords locally.

Or, in Chinese:

> 阅读 https://github.com/Qingbolan/Print-SoC/blob/main/AGENTS.md 并使用其中的 print-soc skill，帮我配置 SoC 打印、找到附近我有权限使用的打印机并准备文件和打印参数，展示预览和设置让我确认后再打印，密码由我在本机输入。

Tell the agent your file path, building, paper and binding preferences when you
know them. Setup alone will not send a test page. If you already authorize an
exact print job, the skill does not require repeating that confirmation.

## Install the skill

Clone this repository, then copy the **whole**
`plugins/print-soc/skills/print-soc` folder, including `references`, to your
agent's skill directory. The same skill is used by both clients.

From the repository root on macOS/Linux, choose one:

```sh
# Codex: personal skill
mkdir -p "$HOME/.agents/skills"
cp -R plugins/print-soc/skills/print-soc "$HOME/.agents/skills/"

# Claude Code: personal skill
mkdir -p "$HOME/.claude/skills"
cp -R plugins/print-soc/skills/print-soc "$HOME/.claude/skills/"
```

If `print-soc` already exists there, review/replace that skill folder rather than
merging stale references into it. On Windows, copy the folder with Explorer or
PowerShell to the corresponding directory under your user profile. For a
project-only install, use `.agents/skills/print-soc` (Codex) or
`.claude/skills/print-soc` (Claude Code) inside that project.

Open a new session if the client has not picked it up. Invoke `$print-soc` in
Codex or `/print-soc` in Claude Code. In this repository, `AGENTS.md` points to the
canonical skill, and `CLAUDE.md` imports the shared repository instructions.
Other agents can read the skill explicitly even without automatic discovery.

These locations follow the [Codex skill guide](https://learn.chatgpt.com/docs/build-skills)
and [Claude Code skill guide](https://code.claude.com/docs/en/skills). Client skill
installation does not install Print@SoC itself; follow the [application setup](../README.md#install).

## Optional MCP connection

For clients accepting `mcpServers` JSON, register:

```json
{
  "mcpServers": {
    "print-soc": {
      "command": "print-soc",
      "args": ["mcp"]
    }
  }
}
```

For Codex clients configured through `config.toml`, the equivalent entry is:

```toml
[mcp_servers.print-soc]
command = "print-soc"
args = ["mcp"]
```

Merge the entry with existing client configuration; do not replace other servers.
The launcher must be on the client's PATH. Desktop Settings → Advanced can also
provide a configuration pointing to the installed executable. Use the client's
MCP discovery to verify connection before printing. The bundled Codex plugin in
`plugins/print-soc` includes this registration and the same skill.

MCP uses the saved desktop account with `connect_ssh {}`. Its tools cover live
printer selection, PDF/image/Office preparation, layout previews, native setup,
submission, shared history, queue tracking and cancellation. No password belongs
in the client configuration. See the [MCP reference](../plugins/print-soc/skills/print-soc/references/mcp.md)
for exact settings and the prepare → review → submit workflow. CLI commands
handle installation, updates, rollback and full removal.

## What an agent should verify

For setup: the installed version, shared account readiness, chosen destination,
registered local queue and running Rust service. For a print: the rendered pages,
effective settings, returned job identity and subsequent queue evidence. Actual
paper output remains a separate check. A Windows desktop install is supported;
the optional CUPS system-printer setup applies to macOS/Linux.
