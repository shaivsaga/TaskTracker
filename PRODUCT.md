# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Classmates (primary):** Students in a school section checking what is due, when, and what they still need to do, while tracking their own progress privately on their own device.
- **Class president (secondary):** The section's student organizer who drafts tasks, announcements, subjects, and file attachments in a private admin area, previews them as a student, and publishes updates to the shared board.

## Product Purpose

TaskTracker replaces scattered deadlines, quizzes, summative tests, term exams, rubrics, and submission links across group chats with one shared class task board (`https://dsct.dev`). The president publishes a task once, and every classmate sees what is due and tracks their own completion privately. Success means classmates can scan what needs doing in seconds on a phone or desktop without accounts, noise, or anxiety.

## Positioning

A zero-account, privacy-preserving class task board: shared tasks come from the server, while student progress stays strictly on-device in the browser (`localStorage`) so the president cannot see who has done what. Urgency is calm and matter-of-fact—never punitive, competitive, or score-driven.

## Operating Context

- **Student flow:** View published tasks as a Kanban board (desktop) or list (phone/desktop), filter by subject or search, inspect notes and attached files (PDF, PPTX, DOCX, JPG, PNG), check month/week calendar views, set personal status (`Not started`, `In progress`, `Done`), and move progress between devices via a temporary 10-minute QR/link transfer.
- **President flow:** Sign in via HTTP Basic Auth (`api/login.php`) to edit a private draft, attach files (upload, paste, or drop), manage subjects and announcements, preview as a student, inspect diffs and publish history, and publish atomically to the public board.
- **Deployment & runtime:** Served at `https://dsct.dev` on Azure App Service (Linux, PHP 8.5, nginx) via GitHub Actions on `main`, and tested locally on XAMPP/Apache with PHP 8.1+.

## Capabilities and Constraints

- **No framework or build step:** Plain HTML, CSS, and ES-module JavaScript; PHP 8.1+ backend with flat JSON storage (`data/current.json`) and no database.
- **Frozen data contracts:** `data/current.json` schema and browser `localStorage` key names/shapes are frozen for backward compatibility with existing student state.
- **Security & privacy boundaries:** No student accounts or sign-up; admin auth is isolated to `api/login.php` with HttpOnly session cookies; `data/`, `deploy/`, `.env`, and `api/.htpasswd` are never publicly served; notes and announcements are sanitized to a strict tag whitelist.
- **Active near-term goal — Multi-section support:** Expanding beyond a single section so a second section gets its own isolated board, admin login, and unlisted rotatable address while the primary section keeps its short address and frozen storage keys (see [docs/multi-section-plan.md](docs/multi-section-plan.md)).
- **Deploy safety:** Merging to `main` auto-deploys production; `index.html` asset cache-busting (`?v=<sha7>`) and inline script CSP hashes are CI/server-enforced.

## Brand Commitments

- **Name & domain:** TaskTracker (`https://dsct.dev`).
- **Voice & emotional framing:** Calm, clear, and non-judgmental. Use plain status labels ("2 days overdue", "Expired", "Closed", "Done"). Never show "Missed", "Failed", scores, streaks, leaderboards, or comparisons between students.

## Evidence on Hand

- [README.md](README.md) — product overview, classmate/president workflows, privacy/security model, and deployment docs.
- [DESIGN.md](DESIGN.md) — documented visual system ("The Pixel Study Hall"), tokens, layout rules, and component specs.
- [docs/multi-section-plan.md](docs/multi-section-plan.md) — planned multi-section architecture and rollout notes.
- [docs/screenshots/](docs/screenshots/) — desktop and phone reference captures.
- [tests/](tests/) — Node test suite, PHP test suite, and E2E/visual-regression checks.

## Product Principles

1. **Progress stays on-device:** Personal task status never leaves the student's browser unless the student explicitly initiates a temporary device transfer.
2. **One publish, calm clarity:** The president authors once in a private draft; students get a fast, scannable, distraction-free board.
3. **Zero-friction access:** No accounts, no sign-up, and no build/framework overhead—fast on phones and school Wi-Fi.
4. **Non-punitive urgency:** Deadlines inform without shaming, scoring, or comparing students.
5. **Ship with reversible confidence:** Drafts, student previews, publish diffs, and version history protect the class from accidental edits.

## Accessibility & Inclusion

- Meet **WCAG AA** contrast and readability in both light and dark themes.
- Maintain a **320 px** minimum viewport floor without horizontal overflow.
- Keep **44 px** minimum touch targets for interactive controls on mobile and desktop.
- Support full **keyboard navigation**, `prefers-reduced-motion`, and `prefers-contrast: more`.
