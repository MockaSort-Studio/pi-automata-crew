# GitHub CI metadata egress

Members with an explicit workflow-list or workflow-view Armory grant may make GET requests to the corresponding Actions run and job metadata endpoints for their authorized repository only. This is not general GitHub access. Only `page` and `per_page` numeric pagination parameters are accepted. Other paths, log downloads, redirects and signed storage hosts are denied. The guest receives a Gondolin placeholder in `GH_TOKEN`, not the host token; requests must use `Authorization: Bearer $GH_TOKEN`.

Use the existing host-side `github_workflow_run_failed_log` operation for failed-step logs. Its output is limited to the last 12,000 characters (or the requested smaller limit), followed by a truncation marker when applicable. Earlier failure details can be missing; full log access is not implemented.

The guest network uses Gondolin's request hooks and secret manager. VM release revokes the old placeholder; an idle restart creates a fresh one. The per-hop hook rejects redirects after substitution rather than forwarding a credential. Independent security review is required before merging this boundary.
