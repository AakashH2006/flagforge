# client-admin

Organizer dashboard (React 19, Vite, React Router). Sign in with an organizer account to schedule
events, write challenges, attach files and publish them when the set is ready.

```bash
npm run dev:admin   # from the repo root: http://localhost:5173 (proxies /api to http://localhost:4000)
npm run build -w client-admin
```

The API must be running (`npm run dev` from the root). For a build served from another origin, set
`VITE_API_URL`; set `VITE_PARTICIPANT_URL` so the "Live scoreboard" link points at the player site
(see `.env.example`).

## What it does

- **Events.** A list of your own events, live ones first, with a create form that defaults to a
  two-day window starting on the next whole hour. The settings tab renames an event, moves its
  window, or deletes it along with everything inside.
- **Challenges.** Grouped by category, each row showing what the challenge is worth right now, how
  many teams have solved it and whether players can see it. Drafts are dimmed and dashed.
- **The editor.** Title, category, a Markdown description with a preview, the flag, the three
  dynamic-scoring numbers with their curve spelled out in plain words, and a publish toggle.
- **Attachments.** Upload the pcap, binary or archive a challenge hands out; download it back to
  check it, or remove it. Files save as soon as they are chosen, not when the form is submitted.

Flags are write-only. The API never returns one, so the editor's flag field is blank when you open
an existing challenge and leaving it that way keeps the flag you set.

See the root README for the API it uses.
