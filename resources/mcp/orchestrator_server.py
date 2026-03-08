#!/usr/bin/env python3
"""
MCP server for C3P2 orchestrator — zero dependencies (stdlib only).
version: 3.0.0

Exposes 8 tools over JSON-RPC 2.0 / stdio:
  delegate           — Delegate work to a specialist agent
  validate           — Run a shell command to check results
  done               — Report goal achieved
  fail               — Report unrecoverable failure
  send_message       — Send a message to a teammate agent
  check_inbox        — Check your inbox for messages from teammates
  checkpoint         — Create a checkpoint commit of current progress
  spawn_orchestrator — Spawn a sub-orchestrator for a complex sub-task

The C++ app intercepts delegate/validate/done/fail from the stream-json output.
send_message and check_inbox do actual file I/O (inbox JSONL files).
"""
import json
import sys
import os
import time
import fcntl

TOOLS = [
    {
        "name": "delegate",
        "description": (
            "Delegate a task to a specialist agent. "
            "The agent will execute autonomously and return results."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "role": {
                    "type": "string",
                    "enum": ["architect", "implementer", "reviewer", "tester", "debugger"],
                    "description": (
                        "Specialist role: architect (designs/plans), "
                        "implementer (writes code), reviewer (reviews code), "
                        "tester (writes/runs tests), debugger (diagnoses issues)"
                    ),
                },
                "task": {
                    "type": "string",
                    "description": (
                        "Detailed task description for the specialist. "
                        "Be specific about what to do, which files to touch, "
                        "and what the expected output should be."
                    ),
                },
                "working_dir": {
                    "type": "string",
                    "description": (
                        "Working directory for the delegated agent. "
                        "Use this to target a specific repo directory."
                    ),
                },
            },
            "required": ["role", "task"],
            "additionalProperties": False,
        },
    },
    {
        "name": "validate",
        "description": (
            "Run a shell command to validate results (build, test, lint, etc). "
            "Returns the command output and exit code."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute (e.g. 'cmake --build build', 'npm test')",
                },
                "description": {
                    "type": "string",
                    "description": "Human-readable description of what this validates",
                },
            },
            "required": ["command"],
            "additionalProperties": False,
        },
    },
    {
        "name": "done",
        "description": "Report that the goal has been fully achieved. Only call this after implementation, validation, and review are all complete.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summary of what was accomplished",
                },
            },
            "required": ["summary"],
            "additionalProperties": False,
        },
    },
    {
        "name": "fail",
        "description": "Report that the goal cannot be achieved. Only use for truly unrecoverable failures.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why the goal cannot be completed",
                },
            },
            "required": ["reason"],
            "additionalProperties": False,
        },
    },
    {
        "name": "send_message",
        "description": (
            "Send a message to a teammate agent. "
            "Use this to share findings, coordinate work, or request information from another agent on your team."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "description": "Name of the target agent (e.g. 'implementer-2', 'architect-1')",
                },
                "content": {
                    "type": "string",
                    "description": "The message content to send",
                },
            },
            "required": ["to", "content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "check_inbox",
        "description": (
            "Check your inbox for messages from teammates. "
            "Returns all unread messages. Call this periodically between major steps."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "checkpoint",
        "description": (
            "Create a checkpoint commit of current progress. "
            "Use this to save work incrementally so progress is not lost."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "A descriptive commit message for this checkpoint",
                },
            },
            "required": ["message"],
            "additionalProperties": False,
        },
    },
    {
        "name": "spawn_orchestrator",
        "description": (
            "Spawn a sub-orchestrator for a complex sub-task. "
            "The sub-orchestrator runs autonomously and returns results. "
            "Use this for tasks that require deep, focused work."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Detailed task description for the sub-orchestrator",
                },
                "working_dir": {
                    "type": "string",
                    "description": (
                        "Working directory for the sub-orchestrator "
                        "(optional, defaults to current epic's primary repo)"
                    ),
                },
            },
            "required": ["task"],
            "additionalProperties": False,
        },
    },
    {
        "name": "diagnose",
        "description": (
            "Inspect the current state of the codebase without modifying anything. "
            "Use this to see git diffs, recent commits, repo status, or file contents. "
            "Useful for understanding what happened in a previous attempt."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["git_diff", "git_log", "git_status", "file_contents"],
                    "description": (
                        "What to inspect: git_diff (working tree changes), "
                        "git_log (recent commits), git_status (repo status), "
                        "file_contents (read a specific file)"
                    ),
                },
                "target": {
                    "type": "string",
                    "description": (
                        "For file_contents: the file path to read. "
                        "For other actions: optional arguments (e.g. number of commits for git_log)."
                    ),
                },
            },
            "required": ["action"],
            "additionalProperties": False,
        },
    },
]

# Tool call acknowledgments — Claude sees these as tool results
TOOL_ACKS = {
    "delegate": "Command received. Delegation will be executed and results provided in your next message.",
    "validate": "Command received. Validation will be executed and results provided in your next message.",
    "done": "Orchestration marked as complete.",
    "fail": "Orchestration marked as failed.",
    "spawn_orchestrator": "Command received. Sub-orchestrator will be spawned and results provided in your next message.",
    "diagnose": "Command received. Diagnosis results will be provided in your next message.",
}

INBOX_BASE = os.path.expanduser("~/.angy/inboxes")


def get_team_id():
    return os.environ.get("ANGY_TEAM_ID", "")


def get_agent_name():
    return os.environ.get("ANGY_AGENT_NAME", "")


def handle_send_message(args):
    team_id = get_team_id()
    sender = get_agent_name()
    target = args.get("to", "")
    content = args.get("content", "")

    if not team_id or not sender:
        return "Error: Agent identity not configured (no team context)."
    if not target:
        return "Error: 'to' is required."
    if not content:
        return "Error: 'content' is required."

    inbox_dir = os.path.join(INBOX_BASE, team_id)
    os.makedirs(inbox_dir, exist_ok=True)
    inbox_file = os.path.join(inbox_dir, target + ".jsonl")

    msg = json.dumps({
        "from": sender,
        "to": target,
        "content": content,
        "timestamp": time.time(),
    })

    # Atomic append with file locking
    with open(inbox_file, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(msg + "\n")
        fcntl.flock(f, fcntl.LOCK_UN)

    return "Message sent to " + target


def handle_check_inbox():
    team_id = get_team_id()
    agent_name = get_agent_name()

    if not team_id or not agent_name:
        return "Error: Agent identity not configured (no team context)."

    inbox_file = os.path.join(INBOX_BASE, team_id, agent_name + ".jsonl")

    if not os.path.exists(inbox_file):
        return "No messages in your inbox."

    messages = []
    with open(inbox_file, "r") as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        for line in f:
            line = line.strip()
            if line:
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        fcntl.flock(f, fcntl.LOCK_UN)

    # Clear inbox after reading (rename to .read for debugging)
    try:
        read_path = inbox_file + ".read"
        if os.path.exists(read_path):
            os.remove(read_path)
        os.rename(inbox_file, read_path)
    except OSError:
        pass

    if not messages:
        return "No messages in your inbox."

    parts = []
    for m in messages:
        parts.append("From %s: %s" % (m.get("from", "unknown"), m.get("content", "")))
    return "Inbox messages:\n" + "\n---\n".join(parts)


def send(msg):
    """Write a JSON-RPC message to stdout."""
    sys.stdout.write(json.dumps(msg, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def reply(req_id, result):
    """Send a JSON-RPC success response."""
    send({"jsonrpc": "2.0", "id": req_id, "result": result})


def reply_error(req_id, code, message):
    """Send a JSON-RPC error response."""
    send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method", "")
        req_id = msg.get("id")  # None for notifications

        # ─── Lifecycle ────────────────────────────────────────────
        if method == "initialize":
            params = msg.get("params", {})
            reply(req_id, {
                "protocolVersion": params.get("protocolVersion", "2025-11-25"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "c3p2-orchestrator", "version": "3.0.0"},
            })

        elif method in ("notifications/initialized", "notifications/cancelled"):
            pass  # notifications — no response

        # ─── Tool Discovery ───────────────────────────────────────
        elif method == "tools/list":
            reply(req_id, {"tools": TOOLS})

        # ─── Tool Execution ───────────────────────────────────────
        elif method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name", "")
            args = params.get("arguments", {})

            if name == "send_message":
                result_text = handle_send_message(args)
            elif name == "check_inbox":
                result_text = handle_check_inbox()
            elif name == "checkpoint":
                result_text = "Checkpoint created: " + args.get("message", "")
            else:
                result_text = TOOL_ACKS.get(name, "Acknowledged: " + name)

            reply(req_id, {
                "content": [{"type": "text", "text": result_text}],
            })

        # ─── Other Standard Methods ───────────────────────────────
        elif method == "ping":
            reply(req_id, {})

        elif method in ("resources/list", "resources/templates/list"):
            reply(req_id, {"resources": []})

        elif method == "prompts/list":
            reply(req_id, {"prompts": []})

        # ─── Unknown ──────────────────────────────────────────────
        elif req_id is not None:
            reply_error(req_id, -32601, "Method not found: " + method)
        # else: unknown notification — silently ignore


if __name__ == "__main__":
    main()
