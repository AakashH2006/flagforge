# client-participant

Player interface (React 19, Vite, React Router). Players sign in, form or join a team, browse challenges by category, read Markdown descriptions, download challenge files and submit flags with instant feedback.

```bash
npm run dev:participant   # from the repo root: http://localhost:5174 (proxies /api to http://localhost:4000)
npm run build -w client-participant
```

The API must be running (`npm run dev` from the root). For a build served from another origin, set `VITE_API_URL` (see `.env.example`).

See the root README for features and the API it uses.
