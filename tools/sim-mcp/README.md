# sim-mcp: the Logo for Robots simulator as an MCP server

A small developer tool. It is not part of the shipped app, and `index.html` never loads it. It needs Node 18 or newer and has no dependencies.

It speaks MCP over stdio (newline-delimited JSON-RPC 2.0) and provides three tools:

| Tool | Arguments | Returns |
|---|---|---|
| `list_levels` | none | the 9 levels with ids, titles, chapters, objectives and layout counts, plus the Challenge id format |
| `run_program` | `level_id`, `program` | pass/fail for every layout, with time, charge used, the explanation and the event log |
| `suggest_fix` | `level_id`, `program` | the Auto-Fix Coach result: whether a fix was found, the edited program, the edits and the explanation |

Level ids are `"1"` to `"9"` for the handpicked levels and `"challenge:N"` for Challenge seed N (1 to 150). Bad ids and programs that do not parse come back as tool errors (`isError: true`). They never crash the server.

## Register it in Kiro

Add this entry to the workspace file `.kiro/settings/mcp.json`, creating the file if needed:

```json
{
  "mcpServers": {
    "logo-for-robots-sim": {
      "command": "node",
      "args": ["tools/sim-mcp/server.js"],
      "disabled": false,
      "autoApprove": ["list_levels", "run_program", "suggest_fix"]
    }
  }
}
```

Kiro reconnects MCP servers when the file is saved. The Kiro docs do not say which working directory the server starts in. If the relative path does not start, replace `tools/sim-mcp/server.js` with the absolute path to that file on your machine. The server finds the app files from its own location, so only this path matters.

## Try it without Kiro

```
node tools/sim-mcp/server.js
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_levels","arguments":{}}}
```

Type one JSON message per line. The tests in `tests/mcp.test.js` drive the server the same way.
