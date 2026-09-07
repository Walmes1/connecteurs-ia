/* ═══════════════════════════════════════════════════════════════════════════
   mcp.js · micro-serveur MCP (stdio, JSON-RPC ligne par ligne) · 0 dépendance
   ---------------------------------------------------------------------------
   Créateur : Oualid Messaoudi · Éditeur : Vitalink ATLS Education GmbH
   vitalink-atls-education.de · HRB 38336 · Licence MIT
   ---------------------------------------------------------------------------
   Suffisant pour Claude Desktop / Claude Code : initialize, tools/list,
   tools/call, ping. Tout ce qui n'est pas du JSON-RPC part sur stderr.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const PROTOCOL = '2024-11-05';

function log(...parts) {
  process.stderr.write(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n');
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * @param {{name:string, version:string, tools:Array<{name,description,inputSchema,run:(args:object)=>Promise<string>|string}>}} def
 */
function serve(def) {
  const byName = new Map(def.tools.map((t) => [t.name, t]));

  async function dispatch(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;

    try {
      if (method === 'initialize') {
        return isRequest && send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: {
              name: def.name,
              title: def.title || def.name,
              version: def.version,
              websiteUrl: def.websiteUrl,
              publisher: def.publisher,
              author: def.author,
            },
            instructions: def.instructions,
          },
        });
      }

      if (method === 'ping') return isRequest && send({ jsonrpc: '2.0', id, result: {} });

      if (method === 'tools/list') {
        return isRequest && send({
          jsonrpc: '2.0', id,
          result: {
            tools: def.tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        });
      }

      if (method === 'tools/call') {
        const tool = byName.get(params && params.name);
        if (!tool) throw new Error(`Outil inconnu : ${params && params.name}`);
        let text;
        try {
          text = await tool.run((params && params.arguments) || {});
        } catch (err) {
          return isRequest && send({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: `❌ ${err && err.message ? err.message : String(err)}` }], isError: true },
          });
        }
        return isRequest && send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: String(text) }] },
        });
      }

      // notifications (notifications/initialized, cancelled…) : rien à répondre
      if (!isRequest) return;

      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode non gérée : ${method}` } });
    } catch (err) {
      log('[mcp] erreur', err && err.stack);
      if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err && err.message || err) } });
    }
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { log('[mcp] JSON invalide ignoré'); continue; }
      dispatch(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  log(`[${def.name}] prêt (v${def.version}, ${def.tools.length} outils)`);
}

module.exports = { serve, log };
