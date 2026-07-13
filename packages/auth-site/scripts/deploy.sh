#!/usr/bin/env bash
# deploy.sh — build and sync the auth-site SPA to S3.
#
# Usage:
#   deploy.sh --bucket <auth_site_bucket_name> --client-id <auth_site_client_id> [--multi-tenant]
#
# Required:
#   --bucket      S3 bucket name (auth_site_bucket_name Terraform output)
#   --client-id   Cognito app client ID (auth_site_client_id Terraform output)
# Optional:
#   --multi-tenant  Pass to enable the multi-tenant UI (default: false)
#
# AWS credentials must be configured in the environment before running.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_dir="$(dirname "${script_dir}")"

BUCKET=""
CLIENT_ID=""
MULTI_TENANT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)    BUCKET="$2";    shift 2 ;;
    --client-id) CLIENT_ID="$2"; shift 2 ;;
    --multi-tenant) MULTI_TENANT="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${BUCKET}" || -z "${CLIENT_ID}" ]]; then
  echo "Usage: deploy.sh --bucket <bucket> --client-id <client-id> [--multi-tenant]" >&2
  exit 1
fi

echo "Building auth-site..."
(cd "${pkg_dir}" && npm run build)

echo "Writing dist/config.json..."
cat > "${pkg_dir}/dist/config.json" <<JSON
{
  "userPoolClientId": "${CLIENT_ID}",
  "multiTenant": ${MULTI_TENANT}
}
JSON

echo "Syncing to s3://${BUCKET}/..."
aws s3 sync "${pkg_dir}/dist/" "s3://${BUCKET}/" --delete

echo "Deploy complete: https://${BUCKET} (check the auth_url Terraform output for the CloudFront URL)"
