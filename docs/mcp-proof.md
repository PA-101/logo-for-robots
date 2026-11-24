# MCP proof: tools/sim-mcp

This file records what actually happened when the sim-mcp server was registered and called during the autonomous build. Nothing here is invented.

## 1. Registering the server in Kiro: blocked

The agent tried to create the workspace MCP configuration `.kiro/settings/mcp.json` with this entry:

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

A Kiro permission rule refused the write. The exact error (the long path list is shortened here with "..."):

```
Blocked by a permission rule (deny fs_write matching "~/.kiro/settings/, ..., .kiro/settings/, ..."); the user did not reject it. Source: kiro-scope.
```

The agent did not work around the rule (for example by writing the file from the shell), so the file does not exist in the repository. To register the server, add the entry above yourself; see `tools/sim-mcp/README.md`.

## 2. Calling the tools through Kiro: not possible in this session

Because the server was not registered, its tools were not in the agent's tool catalogue. The agent tried to load the first tool. The exact call and error:

```
load_resource(id = "tool::logo-for-robots-sim::list_levels")
-> "Use one exact resource ID from the current load_resource catalogue. Check the load_resource catalogue for a currently available tool ID."
```

`run_program` and `suggest_fix` were not attempted through Kiro for the same reason. Also, the Kiro docs say MCP configuration changes are applied between turns, so even a successful registration would only have made the tools available in a later turn.

**Status: the three tools have NOT been called through Kiro yet.** After you add the configuration, call `list_levels`, `run_program` and `suggest_fix` from Kiro and add the real results here.

## 3. What was verified instead (not through Kiro)

The same server was driven directly over stdio by a small Node client, the way an MCP client talks to it, and by `tests/mcp.test.js` (4 tests, passing). This proves the server works. It does **not** prove the Kiro integration.

Transcript of the direct stdio run. `>>>` is a request line, `<<<` is the reply. The `list_levels` reply is shortened to levels 1 and 9, and the `run_program` event log is shown as an event count.

```
>>> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"stdio-check","version":"1"}}}
<<< {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"logo-for-robots-sim","version":"1.0.0"}}}
>>> {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_levels","arguments":{}}}
<<< isError=false
{
  "levels": [
    {
      "level_id": "1",
      "title": "First Steps",
      "chapter": 1,
      "chapter_name": "Basics",
      "objective": "Drive down the corridor, turn right and stop in the goal.",
      "layouts": 1
    },
    ... levels 2 to 8 ...
    {
      "level_id": "9",
      "title": "Find the Door",
      "chapter": 3,
      "chapter_name": "Bumpers",
      "objective": "Find the door in the south wall and drive into the room below it.",
      "layouts": 3
    }
  ],
  "challenge": {
    "level_id_format": "challenge:N",
    "seeds": "1 to 150",
    "layouts": 1
  }
}
>>> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_program","arguments":{"level_id":"1","program":"forward 200\nright 90\nforward 50"}}}
<<< isError=false
{
  "level_id": "1",
  "pass": false,
  "runs": [
    {
      "layout": null,
      "status": "fail",
      "reason": "program_ended",
      "time_s": 5.77,
      "charge_used_c": 0.458,
      "capacity_c": 3,
      "time_limit_s": 12,
      "explanation": [
        "The program finished 0.51 m short of the goal."
      ],
      "events": "[1 events]"
    }
  ]
}
>>> {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"suggest_fix","arguments":{"level_id":"1","program":"forward 200\nright 90\nforward 50"}}}
<<< isError=false
{
  "level_id": "1",
  "found": true,
  "program": "forward 200\nright 90\nforward 100",
  "edits": [
    "Line 3: forward 50 -> forward 100"
  ],
  "explanation": "Before: The program finished 0.51 m short of the goal. The run ended at 5.8 s after using 0.46 C.\nChange: Line 3: forward 50 -> forward 100.\nAfter: the robot reaches the goal in 5.9 s using 0.48 C of 3.00 C (16% of the battery).\nTried 28 changes; 1 passed. This is the smallest change that works.",
  "tried": 28
}
```
