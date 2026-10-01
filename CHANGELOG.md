# Changelog

All notable changes to Locked In are documented in this file.

## [0.1.0.0] - 2026-09-26

### Added

- Launch the Founding 100 entry experience with the promise “Stop collecting courses. Finish one.”, a course-catalog CTA, clear capped-beta disclosures, and privacy-safe conversion tracking.
- Add public support, risk, privacy, social-preview, sitemap, robots, and runtime-configuration surfaces so prospective users can evaluate the product before signing in.
- Add a read-only mainnet release harness that validates deployed web and API health, build revision, Solana configuration, beta capacity, security headers, legal-draft notices, and prohibited marketing claims without moving funds.
- Add CI lanes and regression coverage for the web app, backend, Rust program, Postgres migrations, public-route behavior, mobile acquisition targets, analytics scrubbing, and deployed mainnet checks.

### Changed

- Make the live mainnet topology and `kamino_usdc_mainnet` yield profile the documented production source of truth while keeping local development defaults safe.
- Centralize public-route handling across the edge proxy and client flow guard, and keep the Founding 100 cohort distinct from the limited live deposit capacity.
- Update the backend Fastify runtime and tighten release configuration, preflight validation, dependency checks, and production build metadata.

### Fixed

- Keep support and social-preview pages available to signed-out visitors while rejecting redirects and route-name tricks in release checks.
- Remove principal-return promises, preserve one clear page heading, enlarge mobile acquisition targets, and keep legal and risk language visible beside conversion paths.
- Verify the deployed program, USDC mint, yield profile, capacity, and exact release revision before treating a production rollout as healthy.
