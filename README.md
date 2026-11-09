<img src="assets/icon.svg" width="64" height="64" alt="">

# GitPulse — GitHub Profile & Repository Analytics Dashboard

> A web application built for the **GitHub Developer Program**. It turns any public GitHub profile into an interactive analytics dashboard and an embeddable SVG stats card, powered entirely by the GitHub REST API.

## ✨ Features

- **Profile overview** — avatar, bio, location, followers/following, public repos & gists.
- **Aggregated stats** — total stars, forks, watchers, repository size.
- **Language distribution** — doughnut chart of bytes of code across top repositories.
- **90-day activity chart** — daily event buckets with longest & current streak.
- **Top repositories** — ranked by stars with descriptions and metadata.
- **Embeddable SVG card** — drop-in badge for any `README.md` (`/api/card/:username.svg`).
- **Rate-limit aware** — works unauthenticated (60 req/hr) and authenticated (5000 req/hr) via `GITHUB_TOKEN`.

## 🏗️ Architecture

```
┌────────────┐   fetch    ┌──────────────┐   REST API   ┌────────────┐
│  Browser   │ ─────────▶ │ Express.js   │ ───────────▶ │  GitHub    │
│ (Chart.js) │ ◀───────── │  (Node 22)   │ ◀─────────── │  API       │
└────────────┘   JSON/SVG └──────────────┘              └────────────┘
```

The backend acts as a thin proxy so the (optional) token never leaks to the client and pagination/rate-limit handling stays server-side.

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- (Optional) a GitHub Personal Access Token with `read:user` + `public_repo`

### Install & Run

```bash
git clone https://github.com/akamusti/githubproject.git
cd githubproject
npm install
cp .env.example .env        # then add your GITHUB_TOKEN
npm start
```

Open http://localhost:3000 and enter a username (try `torvalds`, `github`, or `akamusti`).

For live reload during development:

```bash
npm run dev
```

## 🔌 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health + auth status |
| `GET` | `/api/user/:username` | Raw GitHub user profile |
| `GET` | `/api/repos/:username` | All public repos (sorted by stars) |
| `GET` | `/api/stats/:username` | Aggregated dashboard payload |
| `GET` | `/api/card/:username.svg` | Embeddable SVG stats card |

## 🧩 Embed the Card

```markdown
[![GitPulse](https://your-host/api/card/USERNAME.svg)](https://github.com/USERNAME)
```

## 🔐 Configuration

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | _(empty)_ | Optional PAT. Raises rate limit to 5000 req/hr. |
| `PORT` | `3000` | HTTP port. |

## 🛠️ Tech Stack

- **Runtime:** Node.js 22 (native `fetch`)
- **Server:** Express 4
- **Frontend:** Vanilla JS + Chart.js 4 (CDN)
- **Config:** dotenv

## 📄 License

MIT © [akamusti](https://github.com/akamusti)

---

Built with [T3 Code](https://t3.codes). Created for the GitHub Developer Program.