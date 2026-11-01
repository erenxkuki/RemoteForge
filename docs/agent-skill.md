# RemoteForge Agent Skill

Instructions for AI coding agents using RemoteForge via MCP.

## Workflow

1. Call `remoteforge_request_session` with agentIdentity, projectName, requestedScopes.
   - Save the returned `sessionId` and `sessionSecret`.
2. Wait for the human operator to approve the request in the dashboard/CLI.
   - Poll `remoteforge_session_status` until status is "approved".
3. Call `remoteforge_claim_session` with sessionId + sessionSecret to obtain a token.
   - The MCP server stores the token automatically.
4. Create a workspace: `remoteforge_create_workspace(nodeId, name)`.
5. Upload project: read local files, base64-encode, call `remoteforge_write_file` per file, or use upload flow.
6. Configure environment: `remoteforge_run_command` / `remoteforge_install_dependencies`.
7. Build: `remoteforge_build(workspaceId, profile)`.
8. Run tests: `remoteforge_run_command(workspaceId, "npm", ["test"])`.
9. Collect artifacts: `remoteforge_run_command` or artifact collection; download via `remoteforge_list_artifacts`.
10. Destroy workspace when done.

## Scopes

workspace:create, workspace:read, workspace:write, command:run, process:manage, build:run, artifact:read, terminal:open.

## Error handling

- If a job fails, inspect logs in the returned job object.
- On 401, re-claim session or request new session.
- On 403, request additional scopes.
- Never store or print tokens in code.