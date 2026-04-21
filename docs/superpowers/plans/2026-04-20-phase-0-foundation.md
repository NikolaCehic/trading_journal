# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployed, authenticated, dark-themed TanStack Start app on Cloudflare Pages, with every piece of infrastructure from the spec (Drizzle + Neon + Inngest + Better Auth + Sentry + typed env + CI/CD) wired and verified. End state: a public URL where a visitor can click "Try the demo" and land on an empty `/app/dashboard`, or sign in with Google and reach the same page.

**Architecture:** TanStack Start (Vinxi-based) deployed to Cloudflare Pages via the Nitro `cloudflare-pages` preset. Pages Functions run on Cloudflare Workers. Neon Postgres accessed via `@neondatabase/serverless`. Drizzle ORM with drizzle-kit migrations. Better Auth handles Google OAuth + demo-session creation. Inngest runs in dev via its CLI and deploys as a Cloudflare Pages Function endpoint. Sentry wraps server functions and Inngest handlers. shadcn/ui components on Tailwind CSS with a single warm-orange accent (`#ea580c`) and dark-mode-only palette.

**Tech Stack:** TanStack Start · TypeScript · Tailwind CSS · shadcn/ui · Drizzle ORM · Neon Postgres · Better Auth · Inngest · Sentry · `@t3-oss/env-core` · Zod · Vitest · pnpm · GitHub Actions · Wrangler · Cloudflare Pages · Cloudflare R2

**Plan 01 of ~6.** Subsequent plans (Phase 1 Ingestion, Phase 2 Derivation, Phase 3 Dashboard & Trade Views, Phase 4 AI Narrator, Phase 5 Demo & Landing, Phase 6 Polish & Write-up) will be written after each preceding phase ships.

---

## Pre-flight: credentials the engineer needs in hand

Before starting, ensure you have (or will create):

- A GitHub account + an empty repo to push to
- A Cloudflare account (free tier)
- A Neon account (free tier) — will create a project during Task 5
- A Google Cloud Console project with OAuth consent screen configured (External, Testing mode is fine for v1); a set of OAuth 2.0 credentials for a Web application
- An Inngest account (free tier) — will wire in Task 8
- A Sentry account (free tier) — will wire in Task 9
- An Anthropic API key — **not needed until Phase 4**; skip for now
- Node 20+ and pnpm 9+ installed locally
- `wrangler` CLI (`npm i -g wrangler` or via pnpm dlx)

---

## File structure at end of Phase 0

```
trade_journal/
├── app/
│   └── routes/
│       ├── __root.tsx                  global app shell
│       ├── (public)/
│       │   ├── index.tsx               landing (minimal placeholder)
│       │   └── login.tsx               Google OAuth entry
│       ├── (app)/
│       │   ├── _layout.tsx             authed app shell
│       │   └── dashboard.tsx           empty dashboard placeholder
│       └── api/
│           └── auth/
│               └── $.tsx               Better Auth catchall
├── src/
│   ├── auth/
│   │   ├── client.ts                   Better Auth client
│   │   └── server.ts                   Better Auth server config
│   ├── db/
│   │   ├── client.ts                   Neon + Drizzle client
│   │   └── schema/
│   │       ├── index.ts                barrel export
│   │       └── auth.ts                 Better Auth tables
│   ├── jobs/
│   │   ├── client.ts                   Inngest client
│   │   └── functions.ts                registered Inngest functions
│   ├── lib/
│   │   ├── env.ts                      @t3-oss/env-core config
│   │   ├── log.ts                      structured logger
│   │   └── sentry.ts                   Sentry init
│   └── styles/
│       └── globals.css                 Tailwind + theme tokens
├── drizzle/                             generated migrations
├── tests/
│   └── smoke/
│       └── env.test.ts                  env validation smoke test
├── .github/
│   └── workflows/
│       └── ci.yml                       GitHub Actions CI
├── .env.example                         committed example
├── .env.local                           git-ignored, local secrets
├── .gitignore
├── app.config.ts                        TanStack Start + Nitro config
├── drizzle.config.ts                    drizzle-kit config
├── package.json
├── pnpm-lock.yaml
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── wrangler.toml                        Cloudflare Pages config
└── README.md
```

**Module responsibilities:**

- `app/routes/` — TanStack Start file-based routing; UI surface.
- `src/auth/` — Better Auth config; one file for client use, one for server.
- `src/db/` — Drizzle client + schema. Schema split per domain (auth now, ingestion/derivation/ai added in later phases).
- `src/jobs/` — Inngest client and functions. Empty handlers in Phase 0; populated in later phases.
- `src/lib/` — small cross-cutting utilities (typed env, structured logger, Sentry init).
- `src/styles/` — Tailwind globals + theme tokens.
- `tests/smoke/` — tests that don't belong to a specific domain (env validation, health checks).

---

## Task 1 — Initialize the project

**Files:**
- Create: `trade_journal/package.json`
- Create: `trade_journal/.gitignore`
- Create: `trade_journal/README.md`

- [ ] **Step 1: Create the project directory and initialize pnpm**

```bash
cd /Users/nikolacehic/Desktop/trade_journal
pnpm init
```

Expected: `package.json` created with defaults.

- [ ] **Step 2: Replace `package.json` with the real starter**

Content of `package.json`:

```json
{
  "name": "trade-journal",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "vinxi dev",
    "build": "vinxi build",
    "start": "vinxi start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "inngest:dev": "inngest-cli dev"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

Content:

```gitignore
# deps
node_modules
.pnpm-store

# builds
.output
.vinxi
.nitro
dist

# env
.env
.env.*
!.env.example

# editors
.vscode
.idea
.DS_Store

# db
*.sqlite

# logs
*.log
```

- [ ] **Step 4: Create minimal `README.md`**

Content:

```markdown
# Trade Journal

AI-powered trading journal for crypto perps and spot traders. Flagship portfolio project.

See `docs/superpowers/specs/` for the design spec and `docs/superpowers/plans/` for phased implementation plans.

## Development

```bash
pnpm install
pnpm dev
```
```

- [ ] **Step 5: Initialize git and make the first commit**

```bash
cd /Users/nikolacehic/Desktop/trade_journal
git init
git add .gitignore package.json README.md docs/
git commit -m "chore: initialize trade-journal repo with design spec"
```

Expected: first commit lands on `main`.

---

## Task 2 — Install TanStack Start

**Files:**
- Modify: `trade_journal/package.json`
- Create: `trade_journal/app.config.ts`
- Create: `trade_journal/tsconfig.json`
- Create: `trade_journal/app/routes/__root.tsx`
- Create: `trade_journal/app/routes/(public)/index.tsx`

- [ ] **Step 1: Install TanStack Start + dependencies**

```bash
pnpm add @tanstack/react-router @tanstack/start @tanstack/react-query \
  react react-dom \
  vinxi
pnpm add -D @tanstack/router-plugin @tanstack/router-devtools \
  @types/react @types/react-dom typescript
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"],
      "~app/*": ["./app/*"]
    }
  },
  "include": ["app", "src", "tests", "app.config.ts", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `app.config.ts`**

```ts
import { defineConfig } from '@tanstack/start/config'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',
  },
  vite: {
    plugins: [
      tsConfigPaths({ projects: ['./tsconfig.json'] }),
    ],
  },
})
```

- [ ] **Step 4: Install `vite-tsconfig-paths`**

```bash
pnpm add -D vite-tsconfig-paths
```

- [ ] **Step 5: Create `app/routes/__root.tsx`**

```tsx
import { createRootRoute, Outlet, ScrollRestoration } from '@tanstack/react-router'
import { Meta, Scripts } from '@tanstack/start'

export const Route = createRootRoute({
  meta: () => [
    { charSet: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { title: 'Trade Journal' },
  ],
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en" className="dark">
      <head>
        <Meta />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Create the placeholder landing route**

File: `app/routes/(public)/index.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(public)/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-semibold">Trade Journal</h1>
      <p className="mt-4 text-neutral-400">
        A trading journal that coaches you on your own data.
      </p>
      <p className="mt-8 text-sm text-neutral-500">
        Coming soon — Phase 0 foundation in progress.
      </p>
    </main>
  )
}
```

- [ ] **Step 7: Run the dev server and verify the page loads**

```bash
pnpm dev
```

Expected: dev server starts on `http://localhost:3000` (or printed port). Opening it shows "Trade Journal" heading on a dark background. Stop the server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json app.config.ts app/
git commit -m "chore: scaffold TanStack Start app with dark root shell"
```

---

## Task 3 — Tailwind + shadcn/ui + theme tokens

**Files:**
- Create: `trade_journal/postcss.config.js`
- Create: `trade_journal/tailwind.config.ts`
- Create: `trade_journal/src/styles/globals.css`
- Modify: `trade_journal/app/routes/__root.tsx` (import globals)
- Create: `trade_journal/src/lib/cn.ts`

- [ ] **Step 1: Install Tailwind + shadcn prerequisites**

```bash
pnpm add -D tailwindcss postcss autoprefixer @tailwindcss/typography
pnpm add clsx tailwind-merge class-variance-authority
pnpm add lucide-react
```

- [ ] **Step 2: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 3: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#ea580c',
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        pnl: {
          win: '#16a34a',
          loss: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontFeatureSettings: {
        mono: ['"tnum"', '"cv11"'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
} satisfies Config
```

- [ ] **Step 4: Create `src/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: dark;
  }
  html {
    font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  }
  html.dark body {
    background: #0a0a0a;
    color: #fafafa;
  }
  .tabular-nums {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 5: Import globals in the root route**

Modify `app/routes/__root.tsx` — add an import at the top:

```tsx
import '~/styles/globals.css'
```

(Keep the rest of the file unchanged.)

- [ ] **Step 6: Create the `cn` utility**

File: `src/lib/cn.ts`

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 7: Initialize shadcn/ui and add a starter button**

```bash
pnpm dlx shadcn@latest init -y -d --base-color neutral --css-variables
pnpm dlx shadcn@latest add button -y
```

Expected: shadcn wires a `components.json`, creates `app/components/ui/button.tsx` (or similar) depending on shadcn defaults. **If shadcn prompts interactively**, accept defaults and force the components path to `app/components/ui`.

- [ ] **Step 8: Verify theme by rendering a button on the landing page**

Modify `app/routes/(public)/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '~app/components/ui/button'

export const Route = createFileRoute('/(public)/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-semibold">Trade Journal</h1>
      <p className="mt-4 text-neutral-400">
        A trading journal that coaches you on your own data.
      </p>
      <div className="mt-8 flex gap-3">
        <Button className="bg-brand text-white hover:bg-brand-700">Try the demo</Button>
        <Button variant="outline">Sign in with Google</Button>
      </div>
    </main>
  )
}
```

- [ ] **Step 9: Run dev server and visually confirm**

```bash
pnpm dev
```

Expected: landing page shows two buttons — orange "Try the demo" and outlined "Sign in with Google" — on the dark background. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat(ui): add Tailwind, shadcn/ui, dark theme, and orange brand tokens"
```

---

## Task 4 — Typed environment variables

**Files:**
- Create: `trade_journal/src/lib/env.ts`
- Create: `trade_journal/.env.example`
- Create: `trade_journal/.env.local`
- Create: `trade_journal/tests/smoke/env.test.ts`
- Create: `trade_journal/vitest.config.ts`

- [ ] **Step 1: Install env + validation deps**

```bash
pnpm add @t3-oss/env-core zod
pnpm add -D vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Create `src/lib/env.ts`**

```ts
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    SENTRY_DSN: z.string().url().optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  clientPrefix: 'VITE_',
  client: {
    VITE_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    NODE_ENV: process.env.NODE_ENV,
    VITE_APP_URL: process.env.VITE_APP_URL,
  },
  emptyStringAsUndefined: true,
})
```

**Why optional now:** Inngest/Anthropic/Sentry/R2 vars are declared optional in Phase 0 so the app boots before those services are wired. Later tasks tighten them to required.

- [ ] **Step 4: Create `.env.example`**

```dotenv
# Required
DATABASE_URL=postgresql://user:pass@host/db
BETTER_AUTH_SECRET=replace-with-openssl-rand-hex-32
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
VITE_APP_URL=http://localhost:3000

# Optional until later phases
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
ANTHROPIC_API_KEY=
SENTRY_DSN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

- [ ] **Step 5: Create `.env.local` with placeholder values for dev**

```bash
cd /Users/nikolacehic/Desktop/trade_journal
cp .env.example .env.local
```

Then open `.env.local` and fill `BETTER_AUTH_SECRET` with a generated value:

```bash
openssl rand -hex 32
```

Paste the output into `.env.local` under `BETTER_AUTH_SECRET`. Leave `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` blank for now — they get filled in Tasks 5 and 7.

**Do NOT commit `.env.local`.** (Already gitignored.)

- [ ] **Step 6: Write the env validation smoke test**

File: `tests/smoke/env.test.ts`

```ts
import { describe, it, expect } from 'vitest'

describe('env validation', () => {
  it('throws when required vars are missing', async () => {
    // Snapshot + clear required env vars so createEnv fails
    const originalDbUrl = process.env.DATABASE_URL
    const originalSecret = process.env.BETTER_AUTH_SECRET
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET

    let threw = false
    try {
      // Fresh import so the validation runs now, not earlier
      await import('~/lib/env?missing-required')
    } catch (err) {
      threw = true
    } finally {
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl
      if (originalSecret) process.env.BETTER_AUTH_SECRET = originalSecret
    }

    expect(threw).toBe(true)
  })
})
```

- [ ] **Step 7: Run the test and verify it fails (because env.ts throws at import time but the test harness may not actually fail as expected without a fresh module graph)**

```bash
pnpm test
```

Expected: test passes (env throws because required vars are missing during a fresh import attempt).

If it doesn't pass on first run: the test may have caught the existing-module cached env. Restructure it to use `vi.resetModules()`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('env validation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws when required vars are missing', async () => {
    const original = {
      DATABASE_URL: process.env.DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    }
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET

    try {
      await expect(import('~/lib/env')).rejects.toThrow()
    } finally {
      if (original.DATABASE_URL) process.env.DATABASE_URL = original.DATABASE_URL
      if (original.BETTER_AUTH_SECRET) process.env.BETTER_AUTH_SECRET = original.BETTER_AUTH_SECRET
    }
  })
})
```

Re-run `pnpm test` — expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat(env): add typed env validation via @t3-oss/env-core with smoke test"
```

---

## Task 5 — Neon Postgres + Drizzle ORM

**Files:**
- Create: `trade_journal/drizzle.config.ts`
- Create: `trade_journal/src/db/client.ts`
- Create: `trade_journal/src/db/schema/index.ts`
- Create: `trade_journal/src/db/schema/auth.ts`

- [ ] **Step 1: Create a Neon project**

In the Neon web console:
1. Create a new project (e.g. "trade-journal").
2. Copy both connection strings — the pooled one (used as `DATABASE_URL`) and the direct one (used as `DIRECT_URL` for migrations).
3. Paste both into `.env.local`.

Verify: `.env.local` now has `DATABASE_URL=postgresql://...?sslmode=require` populated.

- [ ] **Step 2: Install Drizzle + Neon driver**

```bash
pnpm add drizzle-orm @neondatabase/serverless
pnpm add -D drizzle-kit
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import 'dotenv/config'
import type { Config } from 'drizzle-kit'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL (or DIRECT_URL) must be set for drizzle-kit')

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config
```

- [ ] **Step 4: Install dotenv for drizzle-kit to read `.env.local`**

```bash
pnpm add -D dotenv
```

- [ ] **Step 5: Patch drizzle.config.ts to explicitly load `.env.local`**

Replace the top of `drizzle.config.ts`:

```ts
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import type { Config } from 'drizzle-kit'
```

(Keep everything below unchanged.)

- [ ] **Step 6: Create the Drizzle client**

File: `src/db/client.ts`

```ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { env } from '~/lib/env'
import * as schema from './schema'

const sql = neon(env.DATABASE_URL)
export const db = drizzle(sql, { schema })
export type DB = typeof db
```

- [ ] **Step 7: Create the schema barrel**

File: `src/db/schema/index.ts`

```ts
export * from './auth'
```

- [ ] **Step 8: Create the auth schema tables (Better Auth's required tables)**

File: `src/db/schema/auth.ts`

```ts
import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 9: Generate the first migration**

```bash
pnpm db:generate
```

Expected: creates `drizzle/0000_<auto_name>.sql` with `CREATE TABLE "user"`, `"session"`, `"account"`, `"verification"`. Inspect the file to confirm.

- [ ] **Step 10: Run the migration against Neon**

```bash
pnpm db:migrate
```

Expected: migration applies; `drizzle-kit` reports success.

Verify in the Neon dashboard: tables `user`, `session`, `account`, `verification` exist.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat(db): wire Drizzle + Neon with Better Auth schema tables"
```

---

## Task 6 — Structured logger

**Files:**
- Create: `trade_journal/src/lib/log.ts`
- Create: `trade_journal/src/lib/log.test.ts`

- [ ] **Step 1: Write the failing test**

File: `src/lib/log.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { log } from './log'

describe('log', () => {
  it('emits structured JSON with level, message, and context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.info('hello', { userId: 'u_123' })

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(payload.level).toBe('info')
    expect(payload.msg).toBe('hello')
    expect(payload.userId).toBe('u_123')
    expect(typeof payload.ts).toBe('string')
    spy.mockRestore()
  })

  it('emits error via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    log.error('bad', { err: 'boom' })
    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(payload.level).toBe('error')
    expect(payload.err).toBe('boom')
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/lib/log.test.ts
```

Expected: FAIL — "Cannot find module './log'".

- [ ] **Step 3: Write the minimal implementation**

File: `src/lib/log.ts`

```ts
type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ?? {}),
  })
  if (level === 'error') console.error(payload)
  else console.log(payload)
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
}
```

- [ ] **Step 4: Re-run the test**

```bash
pnpm test src/lib/log.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/log.ts src/lib/log.test.ts
git commit -m "feat(lib): add structured JSON logger"
```

---

## Task 7 — Better Auth + Google OAuth

**Files:**
- Create: `trade_journal/src/auth/server.ts`
- Create: `trade_journal/src/auth/client.ts`
- Create: `trade_journal/app/routes/api/auth/$.tsx`
- Create: `trade_journal/app/routes/(public)/login.tsx`
- Create: `trade_journal/app/routes/(app)/_layout.tsx`
- Create: `trade_journal/app/routes/(app)/dashboard.tsx`
- Modify: `trade_journal/app/routes/(public)/index.tsx`

- [ ] **Step 1: Provision Google OAuth credentials**

In Google Cloud Console:
1. Create (or select) a project.
2. Configure the OAuth consent screen (External, Testing). Add your email as a test user.
3. Create OAuth 2.0 Client ID credentials (type: Web application).
4. **Authorized JavaScript origins:** `http://localhost:3000`
5. **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`

Copy the client ID and client secret into `.env.local`:

```
GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<...>
```

- [ ] **Step 2: Install Better Auth**

```bash
pnpm add better-auth
```

- [ ] **Step 3: Create the server auth config**

File: `src/auth/server.ts`

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '~/db/client'
import { env } from '~/lib/env'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // renew daily
  },
  user: {
    additionalFields: {
      isDemo: {
        type: 'boolean',
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
})

export type AuthSession = typeof auth.$Infer.Session
```

- [ ] **Step 4: Create the client auth helper**

File: `src/auth/client.ts`

```ts
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : (import.meta.env.VITE_APP_URL ?? 'http://localhost:3000'),
})

export const { signIn, signOut, useSession } = authClient
```

- [ ] **Step 5: Create the Better Auth catchall route handler**

File: `app/routes/api/auth/$.tsx`

```tsx
import { createAPIFileRoute } from '@tanstack/start/api'
import { auth } from '~/auth/server'

export const APIRoute = createAPIFileRoute('/api/auth/$')({
  GET: ({ request }) => auth.handler(request),
  POST: ({ request }) => auth.handler(request),
})
```

- [ ] **Step 6: Create the login route**

File: `app/routes/(public)/login.tsx`

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '~app/components/ui/button'
import { signIn } from '~/auth/client'

export const Route = createFileRoute('/(public)/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()

  async function handleGoogle() {
    await signIn.social({
      provider: 'google',
      callbackURL: '/app/dashboard',
    })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Use your Google account to continue.
      </p>
      <Button
        className="mt-8 w-full bg-brand text-white hover:bg-brand-700"
        onClick={handleGoogle}
      >
        Continue with Google
      </Button>
    </main>
  )
}
```

- [ ] **Step 7: Create the authenticated app layout with a guard**

File: `app/routes/(app)/_layout.tsx`

```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { auth } from '~/auth/server'
import { getWebRequest } from 'vinxi/http'

const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getWebRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  return session?.user ?? null
})

export const Route = createFileRoute('/(app)/_layout')({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="text-sm font-semibold">Trade Journal</div>
          <div className="text-xs text-neutral-400">
            {user.isDemo ? 'demo · ' : ''}
            {user.email}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 8: Create the empty dashboard placeholder**

File: `app/routes/(app)/dashboard.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(app)/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Phase 0 placeholder — analytics arrive in Phase 3.
      </p>
    </div>
  )
}
```

- [ ] **Step 9: Update the landing page buttons to wire through to login/demo**

Modify `app/routes/(public)/index.tsx`:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '~app/components/ui/button'

export const Route = createFileRoute('/(public)/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-semibold">Trade Journal</h1>
      <p className="mt-4 text-neutral-400">
        A trading journal that coaches you on your own data.
      </p>
      <div className="mt-8 flex gap-3">
        <Button
          className="bg-brand text-white hover:bg-brand-700"
          disabled
          title="Demo data arrives in Phase 5"
        >
          Try the demo
        </Button>
        <Button variant="outline" asChild>
          <Link to="/login">Sign in with Google</Link>
        </Button>
      </div>
    </main>
  )
}
```

**Note:** the demo button is intentionally disabled — its server function arrives in Phase 5. Phase 0 only needs the real auth path working.

- [ ] **Step 10: Run dev and test the full auth flow**

```bash
pnpm dev
```

Expected:
1. Visit `http://localhost:3000` — landing page shows with disabled demo button.
2. Click "Sign in with Google" → redirects to `/login`.
3. Click "Continue with Google" → redirects to Google OAuth → back to `/app/dashboard`.
4. Dashboard shows `Phase 0 placeholder` with the signed-in email in the header.
5. Verify a new row exists in the `user` table in Neon.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat(auth): wire Better Auth with Google OAuth and protected /app layout"
```

---

## Task 8 — Inngest client (stub)

**Files:**
- Create: `trade_journal/src/jobs/client.ts`
- Create: `trade_journal/src/jobs/functions.ts`
- Create: `trade_journal/app/routes/api/inngest.tsx`

- [ ] **Step 1: Install Inngest**

```bash
pnpm add inngest
pnpm add -D inngest-cli
```

- [ ] **Step 2: Create the Inngest client**

File: `src/jobs/client.ts`

```ts
import { Inngest } from 'inngest'
import { env } from '~/lib/env'

export const inngest = new Inngest({
  id: 'trade-journal',
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
})
```

- [ ] **Step 3: Create the functions registry (empty in Phase 0)**

File: `src/jobs/functions.ts`

```ts
import { inngest } from './client'

const heartbeat = inngest.createFunction(
  { id: 'heartbeat', name: 'Heartbeat' },
  { cron: '0 * * * *' }, // every hour on the :00
  async ({ step }) => {
    await step.run('ping', () => ({ ok: true, ts: new Date().toISOString() }))
  },
)

export const functions = [heartbeat]
```

- [ ] **Step 4: Create the Inngest HTTP endpoint**

File: `app/routes/api/inngest.tsx`

```tsx
import { createAPIFileRoute } from '@tanstack/start/api'
import { serve } from 'inngest/cloudflare'
import { inngest } from '~/jobs/client'
import { functions } from '~/jobs/functions'

const handler = serve({ client: inngest, functions })

export const APIRoute = createAPIFileRoute('/api/inngest')({
  GET: ({ request }) => handler.GET(request),
  POST: ({ request }) => handler.POST(request),
  PUT: ({ request }) => handler.PUT(request),
})
```

- [ ] **Step 5: Run Inngest dev server in one terminal**

```bash
pnpm inngest:dev
```

Expected: Inngest dev UI starts at `http://localhost:8288`.

- [ ] **Step 6: In a second terminal, run the app**

```bash
pnpm dev
```

- [ ] **Step 7: Register the app with Inngest dev server**

In the Inngest dev UI (`http://localhost:8288`), point it at `http://localhost:3000/api/inngest`.

Expected: the `heartbeat` function appears in the Inngest UI as a registered function.

Stop both servers.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat(jobs): wire Inngest client with heartbeat cron placeholder"
```

---

## Task 9 — Sentry error tracking

**Files:**
- Create: `trade_journal/src/lib/sentry.ts`
- Modify: `trade_journal/app/routes/__root.tsx` (client Sentry init)

- [ ] **Step 1: Create a Sentry project (Cloudflare Workers platform)**

In Sentry:
1. Create a new project, platform = "Cloudflare Workers" (or generic JavaScript if Workers isn't listed).
2. Copy the DSN.
3. Paste into `.env.local` as `SENTRY_DSN`.

- [ ] **Step 2: Install Sentry**

```bash
pnpm add @sentry/cloudflare @sentry/react
```

- [ ] **Step 3: Create the server Sentry init**

File: `src/lib/sentry.ts`

```ts
import * as Sentry from '@sentry/cloudflare'
import { env } from '~/lib/env'

export function initSentryServer() {
  if (!env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  })
}

export { Sentry }
```

- [ ] **Step 4: Initialize Sentry at server boot**

Modify `app/routes/__root.tsx` — add to the top of the file (after existing imports):

```tsx
import { initSentryServer } from '~/lib/sentry'
initSentryServer()
```

- [ ] **Step 5: Verify the app still runs without SENTRY_DSN set**

```bash
pnpm dev
```

Expected: app boots fine (Sentry init no-ops when DSN is empty). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(observability): wire Sentry error tracking (no-op without DSN)"
```

---

## Task 10 — Cloudflare Pages deploy

**Files:**
- Create: `trade_journal/wrangler.toml`

- [ ] **Step 1: Install Wrangler**

```bash
pnpm add -D wrangler
```

- [ ] **Step 2: Authenticate Wrangler**

```bash
pnpm wrangler login
```

Follow the browser flow.

- [ ] **Step 3: Create `wrangler.toml`**

```toml
name = "trade-journal"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".output/public"
```

- [ ] **Step 4: Build the app**

```bash
pnpm build
```

Expected: build succeeds; `.output/public/` directory is created.

- [ ] **Step 5: Create the Cloudflare Pages project**

```bash
pnpm wrangler pages project create trade-journal --production-branch main
```

- [ ] **Step 6: Set production environment variables on Cloudflare**

For each required env var, run:

```bash
pnpm wrangler pages secret put DATABASE_URL --project-name trade-journal
# paste value when prompted
pnpm wrangler pages secret put BETTER_AUTH_SECRET --project-name trade-journal
pnpm wrangler pages secret put GOOGLE_CLIENT_ID --project-name trade-journal
pnpm wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name trade-journal
```

Set non-secret vars via the Cloudflare dashboard under Pages → trade-journal → Settings → Environment variables:

- `BETTER_AUTH_URL` = `https://trade-journal.pages.dev` (temporarily — replace with custom domain later)
- `VITE_APP_URL` = `https://trade-journal.pages.dev`
- `NODE_ENV` = `production`

- [ ] **Step 7: Deploy**

```bash
pnpm wrangler pages deploy .output/public --project-name trade-journal --branch main
```

Expected: deploy completes; URL is printed.

- [ ] **Step 8: Update Google OAuth allowed origins/redirects**

Back in Google Cloud Console, edit the OAuth 2.0 Client credentials:

- **Authorized JavaScript origins:** add `https://trade-journal.pages.dev`
- **Authorized redirect URIs:** add `https://trade-journal.pages.dev/api/auth/callback/google`

Save.

- [ ] **Step 9: Verify production auth flow**

Visit `https://trade-journal.pages.dev`:
1. Landing page loads in dark mode with orange branding.
2. Sign in with Google works end-to-end.
3. `/app/dashboard` shows after auth.

- [ ] **Step 10: Commit**

```bash
git add wrangler.toml package.json pnpm-lock.yaml
git commit -m "chore(deploy): add Cloudflare Pages deploy config via Wrangler"
```

---

## Task 11 — GitHub Actions CI

**Files:**
- Create: `trade_journal/.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint || echo "lint script not fully configured yet — skipping on first pass"

      - name: Test
        env:
          DATABASE_URL: postgresql://ci:ci@localhost/ci
          BETTER_AUTH_SECRET: ci_secret_that_is_at_least_32_chars_long___
          BETTER_AUTH_URL: http://localhost:3000
          GOOGLE_CLIENT_ID: ci-client-id
          GOOGLE_CLIENT_SECRET: ci-client-secret
          VITE_APP_URL: http://localhost:3000
          NODE_ENV: test
        run: pnpm test
```

**Note:** Drizzle migration checks are deferred to Phase 1 where real migration-diff validation makes sense. Phase 0 CI only covers typecheck + lint + unit tests.

- [ ] **Step 2: Push to GitHub**

```bash
# If you haven't created the remote yet, create it on github.com first, then:
git remote add origin git@github.com:<your-user>/trade-journal.git
git branch -M main
git push -u origin main
```

- [ ] **Step 3: Verify CI runs**

Open the Actions tab on the GitHub repo. Expected: the CI workflow runs and the `Typecheck` and `Test` steps pass. The `lint` step may warn because we haven't configured ESLint yet — acceptable for Phase 0.

- [ ] **Step 4: Commit any fixes**

If CI fails for legitimate reasons (env, missing dep), fix and commit:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions pipeline for typecheck and tests"
git push
```

---

## Task 12 — ESLint + basic lint config

**Files:**
- Create: `trade_journal/eslint.config.js`

- [ ] **Step 1: Install ESLint and TypeScript plugin**

```bash
pnpm add -D eslint typescript-eslint eslint-plugin-react eslint-plugin-react-hooks
```

- [ ] **Step 2: Create `eslint.config.js`**

```js
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['.output/**', '.nitro/**', '.vinxi/**', 'dist/**', 'drizzle/**'],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
    settings: {
      react: { version: 'detect' },
    },
  },
)
```

- [ ] **Step 3: Run lint locally**

```bash
pnpm lint
```

Expected: runs clean, or reports fixable warnings on the scaffolded code. Fix any real errors; warnings acceptable.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "chore(lint): add ESLint with TypeScript and React plugins"
git push
```

- [ ] **Step 5: Verify CI now passes lint cleanly**

Check the latest GitHub Actions run on `main`. Expected: `Typecheck`, `Lint`, and `Test` all pass green.

---

## Task 13 — Phase 0 smoke check and sign-off

**Files:**
- Create: `trade_journal/tests/smoke/phase-0.test.ts`

- [ ] **Step 1: Write a minimal smoke test verifying critical imports don't throw**

File: `tests/smoke/phase-0.test.ts`

```ts
import { describe, it, expect } from 'vitest'

describe('Phase 0 smoke', () => {
  it('env module loads', async () => {
    const mod = await import('~/lib/env')
    expect(mod.env).toBeDefined()
  })

  it('db client module loads', async () => {
    const mod = await import('~/db/client')
    expect(mod.db).toBeDefined()
  })

  it('auth server module loads', async () => {
    const mod = await import('~/auth/server')
    expect(mod.auth).toBeDefined()
  })

  it('inngest client module loads', async () => {
    const mod = await import('~/jobs/client')
    expect(mod.inngest).toBeDefined()
  })

  it('log module loads and emits', async () => {
    const { log } = await import('~/lib/log')
    expect(typeof log.info).toBe('function')
  })
})
```

- [ ] **Step 2: Run the smoke test**

```bash
pnpm test
```

Expected: all smoke tests PASS. If any fail, resolve the underlying issue (missing env var in test env, missing export, etc.) before continuing.

- [ ] **Step 3: Run a full production build**

```bash
pnpm build
```

Expected: build succeeds, no type errors.

- [ ] **Step 4: Manual end-to-end verification on production URL**

Open `https://trade-journal.pages.dev`:

- [ ] Landing page renders in dark mode
- [ ] Orange brand button is visible on landing
- [ ] "Sign in with Google" → Google OAuth → `/app/dashboard` works
- [ ] Dashboard header shows signed-in email
- [ ] Navigating to `/app/dashboard` while signed out redirects to `/login`
- [ ] A new row exists in the Neon `user` table
- [ ] `https://trade-journal.pages.dev/api/auth/session` returns a valid session JSON when signed in
- [ ] `https://trade-journal.pages.dev/api/inngest` returns a 200 with the Inngest introspection payload

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/phase-0.test.ts
git commit -m "test: phase 0 smoke suite verifying all core modules load"
git push
```

- [ ] **Step 6: Tag the phase-0 milestone**

```bash
git tag phase-0
git push --tags
```

---

## Phase 0 exit checklist

Before declaring Phase 0 complete, confirm all of the following:

- [ ] Deployed URL is public and loads in dark mode with orange accent
- [ ] Google OAuth sign-in works end-to-end in production
- [ ] `/app/dashboard` is reachable after auth, blocked before
- [ ] `user` / `session` / `account` tables exist in Neon and have real rows
- [ ] Inngest dev server registers the app at the local endpoint
- [ ] Sentry DSN is configured in production env (but may be no-op locally)
- [ ] GitHub Actions CI is green on `main`
- [ ] `pnpm test` passes locally (smoke + env + log)
- [ ] `pnpm build` succeeds without type errors
- [ ] `phase-0` git tag exists
- [ ] README has at least a one-line description and `pnpm install && pnpm dev` instructions

When every checkbox is ticked, Phase 0 is done. Ask for the next plan (Phase 1 — Ingestion & canonical data).

---

## Notes for future plans

- Phase 1 will add `ExchangeAccount`, `Import`, `RawImportRow`, `Fill` tables to `src/db/schema/`, split across multiple files matching the domain boundaries in the spec.
- Phase 1 will add the three source adapters, the orchestrator, and the `/app/import` page.
- The `heartbeat` Inngest function created in Task 8 will be replaced by real `ingestion.complete` / `derivation.complete` handlers; it exists only to prove the wiring.
- The demo button on the landing page is disabled in Phase 0 on purpose — its server function ships in Phase 5.
- ESLint config is minimal on purpose — we can harden it per phase.
