---
name: print-soc
description: Inspect NUS School of Computing print queues and quota, or submit a local PDF through the Print@SoC MCP server. Use when the user asks about SoC printers, print quota, queue status, or printing a PDF through Print@SoC.
---

# Print@SoC

Use the Print@SoC MCP tools for NUS School of Computing printing tasks.

## Workflow

1. Call `connection_status` before queue, quota, or submission operations.
2. Call `connect_ssh` only when the user supplies the required NUS SoC account details through an approved secure path.
3. Use `list_print_queues`, `check_print_quota`, or `check_printer_queue` for read-only inspection.
4. Before calling `submit_pdf_print_job`, summarize the local PDF path, printer queue, copies, paper size, duplex mode, orientation, and layout.
5. Treat submission as consequential. Call `submit_pdf_print_job` with `confirm=true` only after the user explicitly confirms that exact print operation.
6. Never place passwords or private-key passphrases in chat output, logs, or generated configuration files.

The MCP server is started by the plugin with `print-soc mcp`. The Print@SoC CLI and desktop binary must already be installed.
