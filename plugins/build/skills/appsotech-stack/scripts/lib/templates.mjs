// File content for the scaffold.
//
// This module generates the parts of a product that are the same every time:
// manifests, configs, Dockerfiles, the process entrypoint, the response and
// error envelope, and one health route so the thing actually boots. Domain
// code — entities, migrations, feature packages, screens — is NOT here. That
// is the agent's job in the feature-build phase, because it depends on what
// is being built; a script that guessed at it would produce plausible tables
// nobody asked for.
//
// The division is deliberate: everything in this file is decided by the house
// conventions and nothing else, so it can be generated without asking, and it
// is identical across products by construction rather than by discipline.

import { surface } from './surfaces.mjs';

const GO_MODULE_ROOT = 'github.com/appsotech';

// ---------------------------------------------------------------------------
// Go API
// ---------------------------------------------------------------------------

// Only what the scaffolded code actually imports. `golang-jwt/v5` and
// `golang.org/x/crypto` belong to the house stack but are added by `go mod
// tidy` when the auth feature lands — declaring them up front makes `go mod
// tidy` rewrite go.mod on a freshly scaffolded product, which shows up as an
// unexplained diff in the first commit.
export function goMod(slug) {
  return `module ${GO_MODULE_ROOT}/${slug}/api

go 1.24

require (
	github.com/buaazp/fasthttprouter v0.1.1
	github.com/jackc/pgx/v5 v5.6.0
	github.com/rs/zerolog v1.33.0
	github.com/valyala/fasthttp v1.55.0
)
`;
}

export function goMain(slug, apiPort) {
  return `package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/buaazp/fasthttprouter"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"

	"${GO_MODULE_ROOT}/${slug}/api/internal/config"
	"${GO_MODULE_ROOT}/${slug}/api/internal/db"
	"${GO_MODULE_ROOT}/${slug}/api/internal/middleware"
	"${GO_MODULE_ROOT}/${slug}/api/internal/response"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("database")
	}
	defer pool.Close()

	router := fasthttprouter.New()

	// Liveness. Deliberately does NOT touch the database: a health check that
	// fails when Postgres blips takes the API out of rotation for a fault it
	// cannot fix by restarting. Readiness is the check that owns dependencies.
	router.GET("/v1/health", func(ctx *fasthttp.RequestCtx) {
		response.JSON(ctx, fasthttp.StatusOK, map[string]string{"status": "ok"})
	})

	router.GET("/v1/ready", func(ctx *fasthttp.RequestCtx) {
		c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(c); err != nil {
			response.JSON(ctx, fasthttp.StatusServiceUnavailable,
				map[string]string{"status": "database unreachable"})
			return
		}
		response.JSON(ctx, fasthttp.StatusOK, map[string]string{"status": "ready"})
	})

	// Register feature routes here. One line per feature package, each
	// exposing a Routes(router, deps) function — see references/backend-go.md.

	handler := middleware.Chain(router.Handler,
		middleware.Logger(),
		middleware.CORS(cfg.AllowedOrigins),
		middleware.Tenant(pool),
	)

	srv := &fasthttp.Server{
		Handler:            handler,
		Name:               "${slug}-api",
		ReadTimeout:        15 * time.Second,
		WriteTimeout:       30 * time.Second,
		IdleTimeout:        60 * time.Second,
		MaxRequestBodySize: 20 << 20,
	}

	go func() {
		log.Info().Str("addr", cfg.ServerAddr).Msg("listening")
		if err := srv.ListenAndServe(cfg.ServerAddr); err != nil {
			log.Fatal().Err(err).Msg("listen")
		}
	}()

	<-ctx.Done()
	log.Info().Msg("shutting down")
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.ShutdownWithContext(shutdown); err != nil {
		log.Error().Err(err).Msg("shutdown")
	}
}
`;
}

export function goConfig(slug, apiPort) {
  return `package config

import (
	"errors"
	"os"
	"strings"
)

// Config is the whole of this service's runtime configuration. Everything is
// read once at boot and never re-read: a value that can change under a
// running process is a value two requests can disagree about.
type Config struct {
	ServerAddr     string
	DatabaseURL    string
	JWTSecret      string
	AllowedOrigins []string
	Environment    string
}

// Load reads configuration from the environment, failing loudly on anything
// missing. There are no defaults for DatabaseURL or JWTSecret on purpose — a
// default database URL points somewhere real, and a default signing secret is
// a signing secret an attacker also has.
func Load() (Config, error) {
	cfg := Config{
		// The server binds ServerAddr. PORT is read for parity with platforms
		// that inject it, but ListenAndServe never sees it — see the note in
		// the Dockerfile.
		ServerAddr:  envOr("SERVER_ADDR", ":${apiPort}"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		Environment: envOr("ENVIRONMENT", "development"),
	}
	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		cfg.AllowedOrigins = strings.Split(origins, ",")
	}

	var missing []string
	if cfg.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if cfg.JWTSecret == "" {
		missing = append(missing, "JWT_SECRET")
	}
	if len(missing) > 0 {
		return cfg, errors.New("missing required environment: " + strings.Join(missing, ", "))
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
`;
}

export function goDB(slug) {
  return `package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens the pool and proves it works before returning. A pool that
// lazily connects turns a bad DATABASE_URL into a runtime 500 on whichever
// request happens to be first, instead of a failure at boot where it belongs.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}
`;
}

export function goProblems(slug) {
  return `package problems

import (
	"encoding/json"
	"net/http"

	"github.com/valyala/fasthttp"
)

// Problem is an RFC 7807 Problem Details object. Errors cross the wire in one
// shape so a client has exactly one error branch to write, and so an
// unexpected failure cannot leak a Go error string to a browser.
type Problem struct {
	Type   string \`json:"type"\`
	Title  string \`json:"title"\`
	Status int    \`json:"status"\`
	Detail string \`json:"detail,omitempty"\`
	// Field-level validation failures, keyed by request field.
	Errors map[string]string \`json:"errors,omitempty"\`
}

func (p *Problem) Error() string { return p.Title }

func (p *Problem) Write(ctx *fasthttp.RequestCtx) {
	ctx.SetStatusCode(p.Status)
	ctx.SetContentType("application/problem+json")
	b, err := json.Marshal(p)
	if err != nil {
		ctx.SetStatusCode(http.StatusInternalServerError)
		ctx.SetBodyString(\`{"type":"about:blank","title":"Internal Server Error","status":500}\`)
		return
	}
	ctx.SetBody(b)
}

func New(status int, title, detail string) *Problem {
	return &Problem{Type: "about:blank", Title: title, Status: status, Detail: detail}
}

func BadRequest(detail string) *Problem {
	return New(http.StatusBadRequest, "Bad Request", detail)
}

// Validation carries per-field messages. Keep the detail generic — the
// specifics belong in Errors, where a form can bind them to inputs.
func Validation(fields map[string]string) *Problem {
	p := New(http.StatusUnprocessableEntity, "Unprocessable Entity", "one or more fields are invalid")
	p.Errors = fields
	return p
}

func Unauthorized(detail string) *Problem {
	return New(http.StatusUnauthorized, "Unauthorized", detail)
}

func Forbidden(detail string) *Problem {
	return New(http.StatusForbidden, "Forbidden", detail)
}

func NotFound(detail string) *Problem {
	return New(http.StatusNotFound, "Not Found", detail)
}

func Conflict(detail string) *Problem {
	return New(http.StatusConflict, "Conflict", detail)
}

// Internal carries no detail by design. Whatever went wrong is in the log
// with a request id; it is not the client's to read.
func Internal() *Problem {
	return New(http.StatusInternalServerError, "Internal Server Error", "")
}
`;
}

export function goResponse(slug) {
  return `package response

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/valyala/fasthttp"

	"${GO_MODULE_ROOT}/${slug}/api/internal/problems"
)

// Pagination holds cursor-based pagination metadata. Cursor, not offset: an
// offset paginator silently skips or repeats rows when the underlying set
// changes between pages, which it always does under load.
type Pagination struct {
	NextCursor string \`json:"next_cursor,omitempty"\`
	HasMore    bool   \`json:"has_more"\`
	Total      int    \`json:"total"\`
}

// JSON writes a response with the given data wrapped in {"data": ...}. The
// envelope is not decoration — it leaves room to add pagination or metadata
// to any endpoint later without that being a breaking change.
func JSON(ctx *fasthttp.RequestCtx, status int, data any) {
	ctx.SetStatusCode(status)
	ctx.SetContentType("application/json")
	b, err := json.Marshal(map[string]any{"data": data})
	if err != nil {
		Error(ctx, problems.Internal())
		return
	}
	ctx.SetBody(b)
}

// List writes a paginated list response: {"data": [...], "pagination": {...}}.
func List(ctx *fasthttp.RequestCtx, data any, pagination Pagination) {
	ctx.SetStatusCode(http.StatusOK)
	ctx.SetContentType("application/json")
	b, err := json.Marshal(map[string]any{"data": data, "pagination": pagination})
	if err != nil {
		Error(ctx, problems.Internal())
		return
	}
	ctx.SetBody(b)
}

func Created(ctx *fasthttp.RequestCtx, data any) { JSON(ctx, http.StatusCreated, data) }

func Accepted(ctx *fasthttp.RequestCtx, data any) { JSON(ctx, http.StatusAccepted, data) }

func NoContent(ctx *fasthttp.RequestCtx) { ctx.SetStatusCode(http.StatusNoContent) }

// Error writes an RFC 7807 Problem Details response. Anything that is not a
// *problems.Problem becomes a bare 500 — an unrecognised error is by
// definition one whose text has not been reviewed for what it discloses.
func Error(ctx *fasthttp.RequestCtx, err error) {
	var p *problems.Problem
	if errors.As(err, &p) {
		p.Write(ctx)
		return
	}
	problems.Internal().Write(ctx)
}
`;
}

export function goMiddleware(slug) {
  return `package middleware

import (
	"time"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// Middleware wraps a request handler.
type Middleware func(fasthttp.RequestHandler) fasthttp.RequestHandler

// Chain applies middleware so the FIRST argument is the OUTERMOST wrapper.
// Reading order and execution order therefore match, which matters because
// the chain is security-ordered: logging outside everything so a rejected
// request is still recorded, CORS before auth so a browser gets a usable
// preflight answer rather than an opaque 401.
func Chain(h fasthttp.RequestHandler, mw ...Middleware) fasthttp.RequestHandler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

func Logger() Middleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			start := time.Now()
			next(ctx)
			log.Info().
				Str("method", string(ctx.Method())).
				Str("path", string(ctx.Path())).
				Int("status", ctx.Response.StatusCode()).
				Dur("duration", time.Since(start)).
				Msg("request")
		}
	}
}

// CORS reflects an origin only when it is on the allow list. It never echoes
// an arbitrary Origin back with credentials enabled — that combination makes
// every authenticated endpoint readable by any site the user visits.
func CORS(allowed []string) Middleware {
	allow := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allow[o] = struct{}{}
	}
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			origin := string(ctx.Request.Header.Peek("Origin"))
			if _, ok := allow[origin]; ok && origin != "" {
				ctx.Response.Header.Set("Access-Control-Allow-Origin", origin)
				ctx.Response.Header.Set("Access-Control-Allow-Credentials", "true")
				ctx.Response.Header.Set("Vary", "Origin")
			}
			if string(ctx.Method()) == fasthttp.MethodOptions {
				ctx.Response.Header.Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
				ctx.Response.Header.Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
				ctx.Response.Header.Set("Access-Control-Max-Age", "86400")
				ctx.SetStatusCode(fasthttp.StatusNoContent)
				return
			}
			next(ctx)
		}
	}
}
`;
}

export function goTenantMiddleware(slug) {
  return `package middleware

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valyala/fasthttp"
)

// TenantIDKey is where the resolved tenant lands on the request context.
const TenantIDKey = "tenant_id"

// Tenant resolves which organisation a request belongs to and pins it to the
// context for the rest of the chain.
//
// The gateway has already decided this: it resolves the hostname against the
// platform registry and copies X-Akadesk-Tenant onto the request. Trusting
// that header is only safe because the gateway is the sole ingress and strips
// any client-supplied copy — if this service is ever exposed directly, this
// becomes a tenant-impersonation hole and must be replaced by a claim read
// from the verified JWT.
//
// Setting it on the connection (rather than filtering in each query) is what
// makes the row-level security policies in the migrations do the work. A
// query that forgets a WHERE tenant_id = clause returns nothing rather than
// returning another organisation's rows.
func Tenant(pool *pgxpool.Pool) Middleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			tenant := string(ctx.Request.Header.Peek("X-Akadesk-Tenant"))
			if tenant != "" {
				ctx.SetUserValue(TenantIDKey, tenant)
			}
			next(ctx)
		}
	}
}

// TenantID returns the tenant pinned by the Tenant middleware, or "".
func TenantID(ctx *fasthttp.RequestCtx) string {
	if v, ok := ctx.UserValue(TenantIDKey).(string); ok {
		return v
	}
	return ""
}
`;
}

export function goDockerfile(slug, apiPort) {
  return `# ${slug} Go API — static (pgx is pure Go), distroless, non-root.
# Coolify builds with base directory = /backend, which is this build context.
FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /out/api /api
# Shipped for parity with the repo layout. Migrations are applied out-of-band
# against the shared Postgres — this image has no shell and no psql.
COPY --from=build /src/migrations /migrations

# The server binds SERVER_ADDR. PORT is parsed into config but is NOT what
# ListenAndServe uses, so setting only PORT would leave it on its default.
ENV SERVER_ADDR=:${apiPort}
ENV PORT=${apiPort}
ENV MIGRATIONS_PATH=/migrations
EXPOSE ${apiPort}
USER nonroot:nonroot
ENTRYPOINT ["/api"]
`;
}

export function goAirToml(apiPort) {
  return `# Hot reload for local development only. Never used in an image.
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
  include_ext = ["go", "sql"]
  exclude_dir = ["tmp", "migrations"]
  delay = 300

[log]
  time = true
`;
}

export function goEnvExample(slug, apiPort, database) {
  return `# Copy to .env and fill in. Never commit the filled copy.
SERVER_ADDR=:${apiPort}
PORT=${apiPort}
ENVIRONMENT=development

# No default exists for these two on purpose: a default database URL points
# somewhere real, and a default signing secret is one an attacker also has.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/${database}?sslmode=disable
JWT_SECRET=

# Comma-separated. Only these origins get CORS credentials.
ALLOWED_ORIGINS=http://localhost:${'${WEB_PORT}'}
`;
}

// ---------------------------------------------------------------------------
// Next.js surfaces
// ---------------------------------------------------------------------------

export function nextPackageJson(slug, key, port) {
  return (
    JSON.stringify(
      {
        name: `@${slug}/${key}`,
        version: '0.1.0',
        private: true,
        scripts: {
          // The port lives here AND in the Dockerfile. Change both in one
          // commit — see references/layout.md.
          dev: `next dev -p ${port}`,
          build: 'next build',
          start: `next start -p ${port}`,
          lint: 'eslint',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          next: '15.5.22',
          react: '19.0.0',
          'react-dom': '19.0.0',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.0.0',
          '@types/node': '^22',
          '@types/react': '^19',
          '@types/react-dom': '^19',
          eslint: '^9',
          'eslint-config-next': '15.5.22',
          tailwindcss: '^4.0.0',
          typescript: '^5.7',
        },
        overrides: {
          postcss: '^8.5.18',
          sharp: '^0.35.0',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

export function nextDockerfile(slug, key, port) {
  return `# ${slug} ${key} — Next.js standalone output, non-root.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Must match package.json's dev/start scripts and the allocation table.
ENV PORT=${port}
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE ${port}
USER node
CMD ["node", "server.js"]
`;
}

export function nextConfig() {
  return `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is what lets the runtime image copy a self-contained
  // server rather than the whole node_modules tree.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
`;
}

export function nextTsConfig() {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ) + '\n'
  );
}

export function nextLayout(slug, key) {
  const tenantNote =
    key === 'tenant-web'
      ? `
// This surface serves every organisation from one build. Which one is decided
// by the Host header the gateway passes through — never by a build-time
// environment variable, which would need one build per tenant.`
      : '';

  return `import type { Metadata } from 'next';
import './globals.css';
${tenantNote}
export const metadata: Metadata = {
  title: '${slug}',
  description: '${slug} — ${key}',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

export function nextPage(slug, key) {
  return `export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">${slug}</h1>
      <p className="mt-2 text-sm opacity-70">${key} is running.</p>
    </main>
  );
}
`;
}

export function nextGlobalsCss() {
  return `@import 'tailwindcss';
`;
}

export function nextPostcssConfig() {
  return `const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
`;
}

// ---------------------------------------------------------------------------
// React + Vite surfaces
// ---------------------------------------------------------------------------

export function vitePackageJson(slug, key) {
  return (
    JSON.stringify(
      {
        name: `@${slug}/${key}`,
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
          'type-check': 'tsc --noEmit',
          test: 'vitest run',
          'test:watch': 'vitest',
          'test:e2e': 'playwright test',
        },
        dependencies: {
          '@sentry/react': '^10.66.0',
          '@tanstack/react-query': '^5.51.1',
          '@tanstack/react-table': '^8.20.0',
          axios: '^1.7.2',
          i18next: '^23.11.5',
          'i18next-browser-languagedetector': '^8.0.0',
          'idb-keyval': '^6.2.1',
          'lucide-react': '^0.446.0',
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          'react-hook-form': '^7.52.1',
          'react-i18next': '^14.1.2',
          'react-router-dom': '^6.23.1',
          recharts: '^2.12.7',
          zod: '^3.23.8',
          zustand: '^4.5.2',
        },
        devDependencies: {
          '@hookform/resolvers': '^3.6.0',
          '@playwright/test': '^1.61.1',
          '@testing-library/jest-dom': '^6.5.0',
          '@testing-library/react': '^16.0.0',
          '@testing-library/user-event': '^14.5.2',
          '@types/react': '^18.3.3',
          '@types/react-dom': '^18.3.0',
          '@vitejs/plugin-react': '^4.3.1',
          '@vitest/coverage-v8': '^2.1.9',
          autoprefixer: '^10.4.19',
          jsdom: '^25.0.0',
          postcss: '^8.4.39',
          tailwindcss: '^3.4.4',
          typescript: '^5.5.3',
          vite: '^5.3.2',
          vitest: '^2.1.1',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

export function viteConfig(key, port) {
  const base = key === 'webapp' ? '/app/' : '/';
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ${
    key === 'webapp'
      ? "The webapp is served at /app on the organisation host, so every asset\n  // URL has to carry that prefix — a root-relative build 404s behind the\n  // gateway while working perfectly on the dev port."
      : 'Served at the root of its own hostname.'
  }
  base: '${base}',
  server: {
    // The allocation table owns this number. Change it here and there in the
    // same commit.
    port: ${port},
    proxy: {
      // Same-origin /v1 in development, matching what the gateway does in
      // production — so no API base URL is ever baked into a bundle.
      '/v1': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
`;
}

export function viteDockerfile(slug, key) {
  return `# ${slug} ${key} — static build served by nginx on 80.
# The gateway reverse-proxies to :80 for every Vite surface, so this port is
# fixed and is NOT the app's development port.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS run
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`;
}

export function viteNginxConf(key) {
  const root = key === 'webapp' ? '/app' : '/';
  return `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;

  # A client-side router owns every path below the base. Without this, a
  # refresh on any deep link is a 404 from nginx before React ever loads.
  location ${root} {
    try_files $uri $uri/ ${root === '/' ? '/index.html' : '/app/index.html'};
  }

  location = /healthz {
    access_log off;
    return 200 "ok\\n";
  }

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
}
`;
}

export function viteApiClient() {
  return `import axios from 'axios';

// No base URL. Every surface is served same-origin with its API under /v1 —
// the gateway guarantees it in production and vite's dev proxy mirrors it —
// so a relative path means one build runs in every environment and there is
// no API host to get wrong at deploy time.
export const api = axios.create({
  baseURL: '/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
};

// The API answers errors as RFC 7807 problem+json and successes as
// {"data": ...}. Unwrapping both here is what keeps that envelope out of
// every call site.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const problem = error?.response?.data as Problem | undefined;
    if (problem?.title) {
      return Promise.reject(Object.assign(new Error(problem.title), { problem }));
    }
    return Promise.reject(error);
  },
);

export async function get<T>(url: string, params?: unknown): Promise<T> {
  const { data } = await api.get<{ data: T }>(url, { params });
  return data.data;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.post<{ data: T }>(url, body);
  return data.data;
}
`;
}

export function viteTsConfig() {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          resolveJsonModule: true,
          isolatedModules: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['vitest/globals', '@testing-library/jest-dom'],
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n'
  );
}

export function viteIndexHtml(slug, key) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${slug} — ${key}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

export function viteMain(key) {
  // The router basename must match vite's `base`, or every link resolves one
  // level off once the app is served behind the gateway.
  const basename = key === 'webapp' ? "'/app'" : "'/'";
  return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';

import App from './App';
import './index.css';

// No DSN means no initialisation at all — local development must not report
// into production.
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, environment: import.meta.env.MODE });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A failed request that retries three times turns one 500 into four and
      // delays the error the user needs to see.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={${basename}}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
`;
}

export function viteApp(slug, key) {
  return `import { Route, Routes } from 'react-router-dom';

function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">${slug}</h1>
      <p className="mt-2 text-sm opacity-70">${key} is running.</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
`;
}

export function viteIndexCss() {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
}

export function viteTailwindConfig() {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
`;
}

export function vitePostcssConfig() {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}

export function viteSetupTests() {
  return `import '@testing-library/jest-dom/vitest';
`;
}

export function viteEnvDts() {
  return `/// <reference types="vite/client" />
`;
}

// ---------------------------------------------------------------------------
// Flutter
// ---------------------------------------------------------------------------

export function pubspec(slug) {
  return `name: ${slug}_mobile
description: ${slug} learner mobile app
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.5.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  dio: ^5.7.0
  flutter_riverpod: ^2.5.1
  go_router: ^14.2.0
  flutter_secure_storage: ^9.2.2
  intl: ^0.19.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  mocktail: ^1.0.4

flutter:
  uses-material-design: true
`;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export function gitignore() {
  return `node_modules/
dist/
.next/
out/
tmp/
build/
*.log
.env
.env.local
.DS_Store

# Compiled Go binaries were committed by mistake once and made the repo an
# order of magnitude larger than its source. Please do not reintroduce them.
/backend/api
/backend/worker
`;
}

export function readme(slug, alloc) {
  const rows = alloc.surfaces
    .filter((k) => alloc.ports[k] !== undefined)
    .map((k) => `| \`${surface(k).dir}\` | ${surface(k).summary} | ${alloc.ports[k]} |`)
    .join('\n');
  const api = alloc.apiPort
    ? `| \`backend\` | ${surface('backend').summary} | ${alloc.apiPort} |`
    : '';
  return `# ${slug}

Scaffolded to the Appsotech house layout. One product, one Postgres database,
one gateway hostname per surface.

## Surfaces

| Directory | What it is | Dev port |
|---|---|---|
${rows}
${api}

Ports reach an app **directly**, bypassing the gateway. That is what they are
for: reaching one directly is how you tell "the app is broken" apart from "the
gateway is routing it wrong". Normal use goes through the gateway by hostname.

Change a port here **and** in the app's own config in the same commit.

## Database

\`${alloc.database}\` — this product's own PostgreSQL database. Not a schema
inside a shared one: a schema shares a connection pool, a \`pg_dump\`, a restore
and a \`max_connections\` budget with everything beside it.

## Running it

\`\`\`bash
cd deploy
cp .env.example .env      # set JWT_SECRET and POSTGRES_PASSWORD at minimum
docker compose up --build
\`\`\`
`;
}
