// Crew policy baseline. Env resolves these operation names to the immutable
// GitHub suite; this module never imports the suite implementation.
export const GITHUB_BASE_TOOLS = Object.freeze([
  "github_repo_discussions_set", "github_discussion_comments", "github_discussion_post", "github_discussion_view", "github_discussions_list", "github_discussion_delete",
  "github_issue_create", "github_issue_view", "github_subissue_add", "github_subissues_list", "github_dependency_add", "github_issues_list", "github_dependency_list", "github_issue_comment", "github_issue_update",
  "github_label_list", "github_label_create", "github_label_update", "github_issue_add_label", "github_issue_remove_label",
  "github_project_fields", "github_project_item_add", "github_project_item_find", "github_project_field_set",
  "github_pull_requests_list", "github_pull_request_view", "github_pull_request_files", "github_pull_request_checks", "github_pull_request_review_threads", "github_pull_request_comment", "github_pull_request_update", "github_pull_request_review_start", "github_pull_request_review_inline_comment", "github_pull_request_review_submit", "github_pull_request_review", "github_pull_request_merge", "github_pull_request_add_label", "github_pull_request_remove_label",
]);
export const GITHUB_BASE_TOOL_SET = new Set(GITHUB_BASE_TOOLS);
