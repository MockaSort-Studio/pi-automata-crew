# Deferred grant decisions

The repository target inventory confines restored operations to the authorized repository. Role grants provide
mutations; persona grants contribute only reads. Project operations remain denied because they have no repository
field and no Project authorization policy has been selected.

| Operation                         | Inventory class | Decision                                       |
| --------------------------------- | --------------- | ---------------------------------------------- |
| `github_discussion_comments`      | `ownerRepo`     | Restored: owner and repository bound.          |
| `github_discussion_view`          | `ownerRepo`     | Restored: owner and repository bound.          |
| `github_discussions_list`         | `ownerRepo`     | Restored: owner and repository bound.          |
| `github_discussion_post`          | `ownerRepo`     | Restored: owner and repository bound.          |
| `github_issues_list`              | `repo`          | Restored: repository bound.                    |
| `github_subissues_list`           | `repo`          | Restored: repository bound.                    |
| `github_dependency_list`          | `repo`          | Restored: repository bound.                    |
| `github_label_list`               | `repo`          | Restored: repository bound.                    |
| `github_issue_create`             | `repo`          | Restored: repository bound.                    |
| `github_issue_update`             | `repo`          | Restored: repository bound.                    |
| `github_issue_comment`            | `repo`          | Restored: repository bound.                    |
| `github_issue_add_label`          | `repo`          | Restored: repository bound.                    |
| `github_issue_remove_label`       | `repo`          | Restored: repository bound.                    |
| `github_subissue_add`             | `repo`          | Restored: repository bound.                    |
| `github_dependency_add`           | `repo`          | Restored: repository bound.                    |
| `github_project_fields`           | `deferred`      | Denied: no repository field or Project policy. |
| `github_project_item_add`         | `deferred`      | Denied: no repository field or Project policy. |
| `github_project_item_find`        | `deferred`      | Denied: no repository field or Project policy. |
| `github_project_field_set`        | `deferred`      | Denied: no repository field or Project policy. |
| `github_pull_request_checks_wait` | `repo`          | Restored: repository bound.                    |
