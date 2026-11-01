---
name: remoteforge
description: Use RemoteForge to run development, builds, tests, and commands on a remote VPS from an AI coding agent.
---

# RemoteForge Skill

## When to use
When the user asks to build, test, compile, or run code on a remote VPS instead of locally.

## Workflow
1. Request a session via MCP tool `remoteforge_request_session`.
2. Wait for human approval (poll `remoteforge_session_status`).
3. Claim the session token (`remoteforge_claim_session`).
4. Create a workspace (`remoteforge_create_workspace`).
5. Upload the project (write files or upload archive).
6. Install dependencies (`remoteforge_install_dependencies`).
7. Build (`remoteforge_build`).
8. Run tests (`remoteforge_run_command`).
9. Collect artifacts (`remoteforge_list_artifacts` + download).
10. Destroy workspace when done.

## Security
- Never store tokens in code.
- Use only approved scopes.
- Revoke sessions when finished.