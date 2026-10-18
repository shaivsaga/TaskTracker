# TaskTracker

A shared task board for a school class. The class president posts what the section has to do, and each classmate keeps their own progress on it, privately, in their own browser.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**Live site:** https://dsct.dev

<table>
  <tr>
    <td><img src="docs/screenshots/board-dark.png" alt="Kanban board in dark mode" width="480"></td>
    <td><img src="docs/screenshots/list-light.png" alt="Task list in light mode" width="480"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/calendar.png" alt="Month calendar view" width="480"></td>
    <td><img src="docs/screenshots/phone.png" alt="Phone layout with the sidebar open" width="240"></td>
  </tr>
</table>

## Why this exists

I am the class president of my section. Deadlines, quizzes, summative tests, term exams,  rubrics and submission links were scattered across group chats, and people kept asking the same questions. TaskTracker puts it all in one place: I publish a task once, and everyone can see what is due, when, and what they still need to do.

It is also a project for my computer science studies, so the design choices below matter as much as the features.

## Features

**For classmates**
- A board of published tasks, as a Kanban board or a list, sorted by due date with overdue tasks first.
- Set your own status on each task: Not started, In progress, or Done. Drag cards, or use the dropdown.
- Completed tasks move to their own page and can be reopened at any time.
- Month and week calendar views.
- Task notes with bold, italic, bullets, clickable links and images.
- Announcements pinned by the president.
- Dark and light themes, a first-time tutorial, and quick-add shortcuts such as `tmr`, `3pm` and `ip`.
- Transfer your progress to another device with a QR code or a link.

**For the president**
- A private admin area to draft tasks and announcements, preview them as a student would see them, and publish.
- A version history of every publish, so a mistake can be undone.
- A diff of what changed since the last publish.

## How it works

Progress is personal and stays on the device. Tasks are shared and come from the server.

```mermaid
flowchart LR
    P[President's browser<br/>Draft in localStorage] -->|Publish, password required| A[api/publish.php]
    A --> C[data/current.json<br/>the Board]
    A --> V[data/versions/<br/>history]
    C -->|read| S[Classmate's browser]
    S --> L[Status in localStorage]
    S <-->|QR or link, 10 minutes| T[transfer.php]
```

- **Draft and Board.** The president edits a private Draft. Publishing replaces the public Board with it. Students only ever see the Board.
- **Status stays local.** Each classmate's progress is saved in their own browser and is never sent to the server, so the president cannot see who has done what.
- **Transfer** moves progress between devices. Each task keeps the time its status last changed, and when two devices disagree, the most recent change wins.

## Tech stack

| Area | Choice |
| --- | --- |
| Front end | Plain HTML, CSS and JavaScript. No framework, no build step. |
| Back end | PHP 8.1 or newer, with flat JSON files for storage. No database. |
| Hosting | Azure App Service (Linux, PHP 8.5, nginx) |
| Deploys | GitHub Actions |
| Fonts | IBM Plex Sans and IBM Plex Mono |

## Data and privacy

- There are no accounts and no sign-up. Classmates' progress, theme and view choices live in the browser's local storage.
- Clearing a browser's site data removes that progress. Use Transfer to move it or keep a copy.
- Transfer creates a temporary file on the server that expires after 10 minutes and can be cancelled early. It contains task ids, statuses and timestamps only.
- The server never receives classmates' statuses unless they choose to transfer them.

## Security notes

- The admin API (`api/`) is protected by HTTP Basic Authentication, enforced by the web server.
- Publishing is validated on the server: field types and lengths, date and time formats, a maximum board size, and a rule that refuses to publish an empty board unless the president explicitly confirms clearing it.
- Writes are serialized with a lock and replaced atomically, so a failed publish never leaves a half-written board.
- Notes and announcements are sanitized to a small whitelist of tags before they are shown.
- Transfer endpoints rebuild every payload from a strict whitelist and are rate limited per IP address.
- Secret files and the `data/` folder are never served to the public. Only `data/current.json` is.

## Getting started locally

You need PHP 8.1 or newer, for example through XAMPP.

1. Clone the repository into your web root (for XAMPP, `htdocs`).
2. Start Apache and open `http://localhost/TaskTracker/`.
3. Make sure the `data/` folder can be written by PHP. It is created on first use.
4. To try the admin area, add `?admin` to the address. Publishing needs the `api/` folder to be password protected. Locally, create an `api/.htaccess` and `.htpasswd` of your own. They are not in this repository.

`api/config.php` is optional. If it is missing, defaults are used.

## Deployment

The production site runs on Azure App Service with GitHub Actions.

- Pushing to `main` deploys the code. `data/` is created on the server and is not in git.
- Azure's PHP images use nginx, which ignores `.htaccess`. The equivalent rules, including the password on `api/` and blocking of hidden files and `data/`, are in [`deploy/nginx-default.conf`](deploy/nginx-default.conf).
- [`deploy/startup.sh`](deploy/startup.sh) is set as the app's startup command, so the nginx rules are re-applied after every restart.
- The admin password file is created once on the server, outside the web folder, and is never committed.
- HTTPS Only is turned on.

## Project structure

```
index.html        Markup for every page and dialog, plus the icon sprite
styles.css        Design tokens, layout and both themes
app.js            All application behavior
qr-draw.js        Draws the transfer QR code
qrcode.js         QR code generator library
transfer.php      Temporary transfer links
api/publish.php   Publish the Board (password protected)
api/versions.php  Version history (password protected)
deploy/           nginx rules and startup script for Azure
data/             Created at runtime, not in git
```

## Testing

I test by hand with a checklist: both themes, collapsed and open sidebar, a 320 px wide screen, touch targets on phones, keyboard-only use, and admin and student sessions. Automated tests for the core logic (merging, sorting, due dates and the sanitizers) are on the roadmap.

## Known limitations

- Images pasted into notes are stored inside the note, which makes the Board file larger. Proper file uploads are planned.
- Progress lives in the browser, so it does not follow a person to a new device without Transfer.
- A phone that already has the site open may need one refresh after an update. New visits fetch the latest files automatically.

## Roadmap

- [ ] Phone calendar readability
- [ ] Update notice: a popup listing tasks that are new or changed since your last visit
- [ ] Manage subjects from the admin area
- [ ] File uploads for PDFs and images on tasks
- [ ] Add to home screen on Android and iPhone
- [ ] Automatic cleanup of progress for deleted tasks
- [ ] Optional personal to-do list, kept on the device
- [ ] CSV export and progress charts
- [ ] Automated tests for the core logic
- [ ] Longer term: reminders and insights, designed with privacy first

## Credits and license

Released under the [MIT License](LICENSE).

- Fonts: [IBM Plex](https://github.com/IBM/plex), SIL Open Font License.
- QR generation: `qrcode.js`, which bundles [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, MIT License.

Built by [@shaivsaga](https://github.com/shaivsaga).