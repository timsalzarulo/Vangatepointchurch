# Vantage Point Leadership Pipeline

A web app for growing leaders and caring for volunteers, built on Mac Lake's five levels of leadership:

| Level | Name | Focus |
|---|---|---|
| 1 | **Leading Self** | Character, faithfulness, personal capacity |
| 2 | **Leading Others** | Caring for, organizing and developing a team |
| 3 | **Leading Leaders** | Coaching and multiplying leaders |
| 4 | **Leading a Department** | Vision, systems and the leadership bench for a ministry |
| 5 | **Leading Campus/Church** | Aligning the whole campus or church to one mission |

## What it does

- **See each person whole.** A profile shows every area they serve in and lead, their pipeline level, who leads them, who they're developing, their training, their check-ins and how their level has changed over time.
- **Set standards.** Each level has standards grouped **Be · Know · Do** (character, knowledge, skills) and a list of training. The app comes with starter content for all five levels; edit it on *Pipeline & Standards* to fit your church.
- **Track development.** Leaders rate each standard (Not yet → Emerging → Developing → Consistent) and track training. When someone is consistent in every standard and has finished the required training for their level, they show up as **ready for the next level**.
- **Apprenticeship and succession.** Record who each leader is developing. The dashboard shows **succession coverage** (the share of leadership roles with an apprentice) and the **bench** at each level.
- **Prevent burnout.** For each person, the app works out their total load: roles, weekly commitments, hours per month (how often × hours each time), leadership roles, **span of care** (how many people they're directly responsible for), their last check-in capacity score, and how long it's been since a break. People are flagged *Watch* or *At risk* against guidelines you set in **Settings**.
- **See the organization.** *Ministries & Teams* is a tree of campus → department → team → group. For each area you see its leaders, headcount, hours, succession coverage and how many people are at risk. Numbers roll up from everything inside an area.
- **Import and export.** Bring in people and roles from CSV (for example a Planning Center export), and export everything for reporting.
- **Access control.** *Viewer* (read only), *Editor* (update people, roles, development, check-ins) and *Admin* (also manage users and guidelines).

## Running it

You need Node.js 22.13 or newer. The only dependency is Express, and the data lives in a single SQLite file (`data/pipeline.db`).

```bash
npm install
npm start               # http://127.0.0.1:3000
```

The first time you open the app it asks you to create the admin account.

To try it out with made-up people first:

```bash
DB_PATH=data/demo.db npm run seed:demo
DB_PATH=data/demo.db npm start
```

Other commands:

```bash
npm test                                                      # run the tests
npm run create-admin -- "Name" you@church.org "long password"  # create an admin or reset a password
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Interface to listen on. Set it to `0.0.0.0` to accept outside connections. |
| `DB_PATH` | `data/pipeline.db` | SQLite database file |
| `COOKIE_SECURE` | unset | Set to `1` when you serve over HTTPS |
| `TRUST_PROXY` | unset | Set this (for example to `1`) when the app runs behind a reverse proxy |

### Deploying

This app holds pastoral information about real people, so:

- Serve it only over **HTTPS**, for example behind Caddy, nginx or a platform's TLS, and set `COOKIE_SECURE=1`.
- **Back up** the `data/` folder regularly. It is a single SQLite file.
- Give people the lowest access level they need. Most team leaders only need *Viewer* or *Editor*.

## Importing your volunteers

Import in two steps on the *Import / Export* page. There's a **Preview** button that shows what would change without saving anything.

1. **People:** one row per person, with columns `first_name`, `last_name`, `email`, `phone`, `campus`, `level` (1–5 or the level's name), `status`, `joined_date` and `external_id`.
2. **Roles:** one row per person per role, with columns `email` (or `external_id`, or a name), `area` written as a path like `North Campus > Kids > Check-in` (or separate `ministry` and `team` columns), `role`, `role_level`, `frequency` (weekly / biweekly / monthly / quarterly / occasional) and `hours` for each time they serve.

The importer matches existing people by external ID first, then email, then name. Blank cells never overwrite existing data. Areas that don't exist yet are created for you.

## How the capacity flags work

All thresholds can be changed under **Settings**.

| Flag | Default rule | Severity |
|---|---|---|
| Low capacity reported | Latest check-in capacity ≤ 2 out of 5 | High |
| High serving hours | More than 20 hrs/month (High above 30) | Medium / High |
| Leading too many areas | More than 2 leadership roles | Medium / High |
| Span of care too wide | More than 10 people directly under them (High above 15) | Medium / High |
| Too many roles / weekly roles | More than 3 roles / more than 2 weekly roles | Medium |
| On break but still assigned | Status is *On break* but they still hold active roles | Medium |
| No recent break | Leaders or heavy servers who haven't had a break in more than 12 months | Medium (Low if the date is inferred from their start date) |
| Check-in overdue | A leader with no check-in in 90 days | Low |
| Serving above pipeline level | A role needs a higher level than the person has reached | Low |
| No apprentice | A leadership role with no one being developed for it | Low |

A person is **At risk** if they have any High flag or three or more Medium flags. They are on **Watch** if they have any Medium flag or three or more Low flags.

**Span of care** counts the people serving under someone in the areas they lead, plus the leaders of the areas directly beneath those.

## Project layout

```
src/
  server.js         Express app, security headers, CSRF guard
  db.js             SQLite schema and default settings
  seed-content.js   Starter standards and training for the five levels
  analytics.js      Capacity, span of care, risk, readiness and dashboard calculations
  auth.js           Password hashing (scrypt), sessions, roles
  routes/           JSON API
public/             Front end (plain ES modules, no build step)
scripts/            Demo data and admin tools
test/               node:test suites
```
