# 🔗 Backlink Vault

> **Presented by Scene47** — Intelligent backlink discovery, automated SEO auditing & community-driven link management.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

---

## 📋 What Is This App?

**Backlink Vault** is a full-stack web application that acts as a shared, community-curated database of SEO backlink opportunities. It combines:

- A **public vault** of backlink sources categorised by niche, domain authority, acquisition type, and link health
- An **automated bot worker** that continuously crawls submitted URLs to check HTTP status, classify DoFollow/NoFollow, estimate Domain Authority, and extract niche metadata
- A **user registration & personal tracker** so SEO practitioners can track their own link-building progress
- A **full admin panel** with approval queue, CMS editing, user management, bot controls, and analytics

---

## 🏗️ Architecture Overview

```
backlink-vault/
├── server.py          # Python HTTPServer — all routing, API endpoints, BotWorker thread
├── index.html         # Single-page app shell (landing + main dashboard)
├── app.js             # All frontend JS — auth, filters, tab switching, API calls
├── styles.css         # Vanilla CSS design system (dark mode, glassmorphism)
├── vault.db           # SQLite database (auto-created on first run)
├── requirements.txt   # Python dependencies
├── Procfile           # Deployment start command: `web: python -u server.py`
└── nixpacks.toml      # Railway/Nixpacks build configuration
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ — stdlib only (`http.server`, `sqlite3`, `threading`, `urllib`) |
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) |
| Database | SQLite (single-file, zero config) |
| Scraping | `BeautifulSoup4` + `urllib` with unverified SSL contexts |
| Deployment | Railway, Render, Fly.io, or any VPS/container host |

---

## ⚙️ Minimum Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 0.5 vCPU | 1 vCPU |
| RAM | 256 MB | 512 MB |
| Disk | 500 MB | 2 GB |
| Python | 3.11+ | 3.13+ |
| OS | Linux (any distro) | Ubuntu 22.04 LTS |
| Network | Outbound HTTP/HTTPS | Unrestricted |

> **Why not Cloudflare Pages / Vercel / Netlify?**  
> This app requires a **persistent long-running process** (the BotWorker thread) and a **local SQLite file** on disk. Serverless edge platforms cannot satisfy these requirements. Use Railway, Render, Fly.io, or a VPS instead.

---

## 🔑 Environment Variables

Set these in your hosting provider's dashboard (all have safe defaults):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Port the server listens on |
| `SECRET_KEY` | Yes (prod) | `vault_default_secret_key_2026` | Used to sign session tokens — **change this in production** |
| `ADMIN_EMAIL` | No | `ryn.ahmed101@gmail.com` | Admin login email |
| `ADMIN_PASSWORD` | No | `Ryan@1206` | Admin login password |
| `BOT_DELAY` | No | `1.0` | Seconds between bot scrape requests |

> ⚠️ **Change `SECRET_KEY` before deploying publicly.** Use a random 32+ character string.

---

## 🚀 Deploy to Railway (Recommended)

1. Fork or push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select this repository
4. Railway auto-detects `Procfile` and starts the app
5. Set your environment variables in the Railway dashboard
6. Add a custom domain or use the provided `.railway.app` URL

**Railway will auto-redeploy on every push to `main`.**

---

## 🐳 Deploy Anywhere Else (Docker / VPS)

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py

# Or with custom port
PORT=3000 python server.py
```

The `vault.db` SQLite file is created automatically in the same directory on first run.

---

## 👤 User Roles

| Role | Access |
|------|--------|
| **Guest** | Browse vault, view filters, read info pages |
| **Member** | + Submit backlinks, use Personal Tracker, bulk upload CSV/XLSX |
| **Admin** | + Approve/reject submissions, edit any backlink, manage users, control bot, edit CMS pages |

**Admin account** is set via `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables. Only one admin account exists — it is pre-seeded on every startup.

---

## 🤖 BotWorker

The background `BotWorker` thread runs continuously and:

1. Picks up URLs with status `Approved` or `Queued` from the database
2. Fetches the page using a rotating User-Agent pool with SSL bypass
3. Parses HTML with `BeautifulSoup4` to extract title, H1, H2, and meta description
4. Classifies the site's **niche** using keyword matching across scraped content
5. Detects **DoFollow / NoFollow** link equity
6. Estimates **Domain Authority** (0–100) algorithmically
7. Checks HTTP status (200 = Active, 4xx/5xx = Broken)
8. Logs every action to `bot_logs` table for admin review

---

## 🗄️ Database Schema

The SQLite database contains these tables (auto-created):

- `users` — registered accounts
- `sessions` — login session tokens
- `backlinks` — the main vault (URL, niche, DA, status, acquisition type, etc.)
- `personal_backlinks` — per-user private tracking
- `bot_logs` — audit trail of every bot scrape
- `bot_settings` — bot on/off toggle and delay config
- `cms_pages` — editable content pages (About, Privacy, Terms, etc.)
- `cms_settings` — site-wide settings (ads, banners)

---

## 📂 Key API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | Login with email/password |
| POST | `/api/auth/register` | Public | Create a new account |
| GET | `/api/backlinks` | Public | List vault backlinks (filtered) |
| POST | `/api/backlinks` | Member | Submit a new backlink |
| GET | `/api/stats` | Public | Summary statistics |
| GET | `/api/admin/users` | Admin | List all registered users |
| GET | `/api/admin/approvals` | Admin | Pending approval queue |
| POST | `/api/admin/backlinks/{id}/edit` | Admin | Edit any backlink |
| POST | `/api/admin/backlinks/{id}/approve` | Admin | Approve a submission |
| POST | `/api/admin/backlinks/{id}/reject` | Admin | Reject a submission |
| POST | `/api/admin/users/{id}/delete` | Admin | Delete a user account |
| GET | `/api/export/csv` | Admin | Export full vault as CSV |

---

## 🛠️ Making It Reusable for a New Brand

To rebrand and redeploy for a different website:

1. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars to your new credentials
2. Set a new `SECRET_KEY`
3. Delete `vault.db` if you want a clean slate (or keep it as seed data)
4. Update the brand name in `index.html` (search for `Backlink Vault` and `Scene47`)
5. Push to a new GitHub repo and connect to Railway/Render

---

## 📜 License

MIT — Free to use, modify, and deploy commercially.

---

*Built with Python stdlib + BeautifulSoup4. No bloated frameworks. Deploys in under 60 seconds.*
