# Live Evidence Interview Coach

A typed-answer interface preview for a future AI-powered interview coaching demo.

## Current behavior

- Responsive interview question and answer fields.
- Input length counters and client-side validation.
- A sample results dashboard with five scoring dimensions.
- **No live AI calls.** Preview scores and feedback are illustrative and are not derived from entered text.
- No API credentials, cloud tokens, or backend endpoint are included.

## Run locally

Open `index.html` in a browser. No build step or dependencies required.

## Deployment

Import this GitHub repository as a Vercel project with framework preset **Other**. It is a static site.

## Before enabling public AI evaluation

Implement a server-side gateway that authenticates to the existing IAM-protected Cloud Run service, validates inputs, enforces abuse-resistant rate limits and a persistent usage quota, and returns safe errors. Never put service-account private keys or API secrets in browser JavaScript or this public repository. Google Cloud budget alerts are not spending caps. The public site must remain in preview-only mode until those safeguards are tested.
