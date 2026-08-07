/**
 * Minimal line-delimited JSON-RPC client for the Print@SoC MCP stdio server.
 */

const { spawn } = require('child_process');

class McpClient {
  constructor(binaryPath, env = {}) {
    this.child = spawn(binaryPath, ['mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.onStdout(chunk));
    this.child.stderr.on('data', chunk => {
      this.stderrBuffer += chunk;
    });
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', code => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`MCP server exited with code ${code}`));
      }
    });
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        continue;
      }
      if (message.id === undefined) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'MCP request failed'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async close() {
    try {
      await this.request('shutdown', {}, 5000);
    } catch (_) {}
    try {
      this.child.stdin.end();
    } catch (_) {}
    setTimeout(() => {
      if (!this.child.killed) this.child.kill('SIGTERM');
    }, 500).unref?.();
  }
}

function toolText(result) {
  const item = Array.isArray(result?.content) ? result.content.find(entry => entry.type === 'text') : null;
  return item?.text || '';
}

async function callConnectedTool(binaryPath, connectArgs, toolName, toolArgs = {}, env = {}) {
  const client = new McpClient(binaryPath, env);
  try {
    await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'print-soc-cli', version: '0.1.0' }
    });
    client.notify('notifications/initialized');

    const connected = await client.request('tools/call', {
      name: 'connect_ssh',
      arguments: connectArgs
    });
    if (connected?.isError) {
      throw new Error(toolText(connected) || 'SSH connection failed');
    }

    const result = await client.request('tools/call', {
      name: toolName,
      arguments: toolArgs
    });
    if (result?.isError) {
      throw new Error(toolText(result) || `${toolName} failed`);
    }
    if (result?.structuredContent) {
      return result.structuredContent;
    }
    const text = toolText(result);
    return text ? JSON.parse(text) : {};
  } finally {
    await client.close();
  }
}

module.exports = {
  callConnectedTool
};
