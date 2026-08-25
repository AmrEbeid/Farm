# SPEC-0034 — Support Request Attachments and Status

Status: Implemented candidate, pending migrate-first production release  
Owner: Amr Ebeid  
Surface: `/support`

## Purpose

Any authenticated Farm OS user can submit a problem, requested edit, development request, or idea and attach
the screenshots or documents needed to understand it. The request keeps a visible workflow status so the
submitter can see whether it is new, reviewed, in progress, completed, blocked, or rejected.

## Roles and visibility

- The submitter can read their own requests and attachments and add more attachments later.
- The Owner can read the organization's queue, add attachments, update status, and record the resolution.
- Other organization members cannot read another submitter's request or attachments.
- Anonymous users and users from another organization have no access.

## Attachment contract

- Up to five files may be selected per upload action.
- Maximum size is 25 MiB per file.
- Allowed types are JPG/JPEG, PNG, WebP, HEIC/HEIF, PDF, DOC, and DOCX. SVG and executable formats are rejected.
- The exact object path is `{org_id}/{ticket_id}/{uuid-v4}.{allowed_extension}`.
- File size, extension, declared MIME type, and server-read byte signature must agree before metadata is saved.
- Invalid or unregistrable uploads are removed through the signed-in user's tested cleanup policy.
- Partial multi-file results report the exact uploaded count and refresh the request list.

## Security and retention

- Binary files live in the private `support-attachments` bucket, separate from general farm media.
- Storage and metadata use the same submitter-or-Owner rule and fail closed across tickets and organizations.
- Unregistered objects are not readable. Registered objects cannot be updated or deleted by clients.
- Attachment links expire after five minutes.
- Request and attachment text is not copied into the shared organization audit log.
- Users must not upload passwords, keys, or unnecessary sensitive personal data.

## Status operating rule

Use `new` at submission, `triaged` after review, `in_progress` when work starts, and `done` only after the result
is live and verified. Use `blocked` with a clear reason when work cannot proceed, and `rejected` only with an
explanation. The Owner remains the database-authorized status editor.

## Verification

- Executable pgTAP coverage for submitter, Owner, same-org other user, other organization, anonymous user,
  malformed paths, registered-object immutability, and unregistered-object cleanup.
- Pure signature tests for every accepted file type and disguised-content rejection.
- Full application tests, lint, TypeScript, production build, dependency audit, and independent security review.

## Changelog

- 2026-08-25: Initial attachment and status contract prepared for release.

