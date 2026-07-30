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
export function goMod(
  slug,
  { redis = false, realtime = [], storage = false, mail = false } = {},
) {
  const deps = [
    'github.com/buaazp/fasthttprouter v0.1.1',
    'github.com/jackc/pgx/v5 v5.6.0',
    'github.com/rs/zerolog v1.33.0',
    'github.com/valyala/fasthttp v1.55.0',
  ];
  if (redis) deps.push('github.com/redis/go-redis/v9 v9.7.0');
  // fasthttp's own websocket upgrader, not gorilla — the handler chain is
  // fasthttp, and mixing net/http upgrade paths means running two servers.
  if (realtime.includes('chat')) deps.push('github.com/fasthttp/websocket v1.5.10');
  if (realtime.includes('video')) deps.push('github.com/livekit/protocol v1.27.0');
  if (storage) {
    // R2 speaks the S3 API, so this is the S3 client pointed at an R2
    // endpoint — there is no Cloudflare-specific SDK involved.
    deps.push('github.com/aws/aws-sdk-go-v2 v1.32.6');
    deps.push('github.com/aws/aws-sdk-go-v2/credentials v1.17.47');
    deps.push('github.com/aws/aws-sdk-go-v2/service/s3 v1.71.0');
  }
  // mail uses net/smtp from the standard library, so it adds no dependency.
  void mail;
  deps.sort();

  return `module ${GO_MODULE_ROOT}/${slug}/api

go 1.24

require (
${deps.map((d) => `\t${d}`).join('\n')}
)
`;
}

export function goMain(slug, apiPort, caps = {}) {
  const { redis = false, realtime = [], storage = false, mail = false } = caps;
  const mod = `${GO_MODULE_ROOT}/${slug}/api`;

  const imports = [];
  if (redis) imports.push(`\t"${mod}/internal/cache"`);
  if (mail) imports.push(`\t"${mod}/internal/mail"`);
  if (realtime.length) imports.push(`\t"${mod}/internal/realtime"`);
  if (storage) imports.push(`\t"${mod}/internal/storage"`);

  const setup = [];
  if (redis) {
    setup.push(
      '',
      '\tredisCache, err := cache.New(ctx, cfg.RedisURL)',
      '\tif err != nil {',
      '\t\tlog.Fatal().Err(err).Msg("redis")',
      '\t}',
      '\tdefer redisCache.Close()',
    );
  }
  if (storage) {
    setup.push(
      '',
      '\tfiles, err := storage.New(ctx, storage.Config{',
      '\t\tAccountID:       cfg.R2AccountID,',
      '\t\tAccessKeyID:     cfg.R2AccessKey,',
      '\t\tSecretAccessKey: cfg.R2SecretKey,',
      '\t\tBucket:          cfg.R2Bucket,',
      '\t\tPublicBase:      cfg.R2PublicBase,',
      '\t})',
      '\tif err != nil {',
      '\t\tlog.Fatal().Err(err).Msg("r2")',
      '\t}',
      '\t_ = files',
    );
  }
  if (mail) {
    setup.push(
      '',
      '\tmailer, err := mail.New(mail.Config{',
      '\t\tHost:     cfg.SMTPHost,',
      '\t\tPort:     cfg.SMTPPort,',
      '\t\tUsername: cfg.SMTPUsername,',
      '\t\tPassword: cfg.SMTPPassword,',
      '\t\tFrom:     cfg.SMTPFrom,',
      '\t\tFromName: cfg.SMTPFromName,',
      '\t})',
      '\tif err != nil {',
      '\t\tlog.Fatal().Err(err).Msg("mail")',
      '\t}',
      '\t_ = mailer',
    );
  }
  if (realtime.includes('chat')) {
    setup.push(
      '',
      '\thub := realtime.NewHub(redisCache.Client())',
      '\t// One subscription per process, for the life of the process. Every',
      '\t// replica receives every message and delivers to its own connections.',
      '\tgo hub.Subscribe(ctx)',
      '\t_ = hub',
    );
  }
  if (realtime.includes('video')) {
    setup.push(
      '',
      '\tcalls, err := realtime.NewLiveKit(cfg.LiveKitHost, cfg.LiveKitKey, cfg.LiveKitSecret)',
      '\tif err != nil {',
      '\t\tlog.Fatal().Err(err).Msg("livekit")',
      '\t}',
      '\t_ = calls',
    );
  }

  const extraImports = imports.length ? '\n' + imports.sort().join('\n') : '';
  const extraSetup = setup.length ? setup.join('\n') + '\n' : '';

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

	"${mod}/internal/config"
	"${mod}/internal/db"
	"${mod}/internal/middleware"
	"${mod}/internal/response"${extraImports}
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
${extraSetup}
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

export function goConfig(slug, apiPort, caps = {}) {
  const { redis = false, realtime = [], storage = false, mail = false } = caps;

  const fields = [];
  const loads = [];
  const required = [];

  if (redis) {
    fields.push('\tRedisURL       string');
    loads.push('\t\tRedisURL:    envOr("REDIS_URL", "redis://localhost:6379/0"),');
  }
  if (storage) {
    fields.push(
      '\tR2AccountID    string',
      '\tR2AccessKey    string',
      '\tR2SecretKey    string',
      '\tR2Bucket       string',
      '\tR2PublicBase   string',
    );
    loads.push(
      '\t\tR2AccountID:  os.Getenv("R2_ACCOUNT_ID"),',
      '\t\tR2AccessKey:  os.Getenv("R2_ACCESS_KEY_ID"),',
      '\t\tR2SecretKey:  os.Getenv("R2_SECRET_ACCESS_KEY"),',
      '\t\tR2Bucket:     os.Getenv("R2_BUCKET"),',
      '\t\tR2PublicBase: os.Getenv("R2_PUBLIC_BASE"),',
    );
    required.push('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET');
  }
  if (mail) {
    fields.push(
      '\tSMTPHost       string',
      '\tSMTPPort       string',
      '\tSMTPUsername   string',
      '\tSMTPPassword   string',
      '\tSMTPFrom       string',
      '\tSMTPFromName   string',
    );
    loads.push(
      '\t\tSMTPHost:     envOr("SMTP_HOST", "smtp.zoho.com"),',
      '\t\tSMTPPort:     envOr("SMTP_PORT", "587"),',
      '\t\tSMTPUsername: os.Getenv("SMTP_USERNAME"),',
      '\t\tSMTPPassword: os.Getenv("SMTP_PASSWORD"),',
      '\t\tSMTPFrom:     os.Getenv("SMTP_FROM"),',
      '\t\tSMTPFromName: envOr("SMTP_FROM_NAME", "' + slug + '"),',
    );
    required.push('SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM');
  }
  if (realtime.includes('video')) {
    fields.push(
      '\tLiveKitHost    string',
      '\tLiveKitKey     string',
      '\tLiveKitSecret  string',
    );
    loads.push(
      '\t\tLiveKitHost:   os.Getenv("LIVEKIT_HOST"),',
      '\t\tLiveKitKey:    os.Getenv("LIVEKIT_API_KEY"),',
      '\t\tLiveKitSecret: os.Getenv("LIVEKIT_API_SECRET"),',
    );
    required.push('LIVEKIT_HOST', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET');
  }

  const extraFields = fields.length ? '\n' + fields.join('\n') : '';
  const extraLoads = loads.length ? '\n' + loads.join('\n') : '';
  const extraChecks = required.length
    ? '\n' +
      required
        .map(
          (name) =>
            `\tif os.Getenv("${name}") == "" {\n\t\tmissing = append(missing, "${name}")\n\t}`,
        )
        .join('\n')
    : '';

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
	Environment    string${extraFields}
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
		Environment: envOr("ENVIRONMENT", "development"),${extraLoads}
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
	}${extraChecks}
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

export function goCache(slug) {
  return `package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// Cache is a read-through cache in front of Postgres.
//
// THE TENANT RULE: every key is namespaced by tenant, and Key() is the only
// way to build one. A cache sits IN FRONT of the database, so row-level
// security cannot save you here — RLS never runs on a hit. A key that omits
// the tenant serves one organisation's data to another, and it does so
// intermittently, depending on who warmed the entry. That is the single most
// dangerous bug this package can have, which is why callers are not given a
// way to pass a raw key.
type Cache struct {
	rdb *redis.Client
}

func New(ctx context.Context, url string) (*Cache, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(opt)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &Cache{rdb: rdb}, nil
}

func (c *Cache) Close() error { return c.rdb.Close() }

// Key builds a tenant-namespaced cache key. There is no unnamespaced variant
// on purpose.
func Key(tenantID, entity, id string) string {
	return fmt.Sprintf("t:%s:%s:%s", tenantID, entity, id)
}

// Prefix builds the tenant-namespaced prefix for an entity, for invalidation.
func Prefix(tenantID, entity string) string {
	return fmt.Sprintf("t:%s:%s:*", tenantID, entity)
}

// GetJSON reads and decodes a value. A cache error is NOT returned to the
// caller: it logs and reports a miss, so an unavailable Redis degrades to
// hitting Postgres rather than taking the endpoint down. A cache that can
// cause an outage is worse than no cache.
func (c *Cache) GetJSON(ctx context.Context, key string, dst any) bool {
	b, err := c.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return false
	}
	if err != nil {
		log.Warn().Err(err).Str("key", key).Msg("cache read failed, falling through")
		return false
	}
	if err := json.Unmarshal(b, dst); err != nil {
		// A value that will not decode is a value written by an older shape of
		// the struct. Drop it rather than serving a zero value forever.
		log.Warn().Err(err).Str("key", key).Msg("cache decode failed, evicting")
		c.rdb.Del(ctx, key)
		return false
	}
	return true
}

// SetJSON writes a value with a TTL. Never call it without one: an entry with
// no expiry is an entry that outlives the row it describes.
func (c *Cache) SetJSON(ctx context.Context, key string, v any, ttl time.Duration) {
	if ttl <= 0 {
		log.Error().Str("key", key).Msg("refusing to cache without a TTL")
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		log.Warn().Err(err).Str("key", key).Msg("cache encode failed")
		return
	}
	if err := c.rdb.Set(ctx, key, b, ttl).Err(); err != nil {
		log.Warn().Err(err).Str("key", key).Msg("cache write failed")
	}
}

func (c *Cache) Del(ctx context.Context, keys ...string) {
	if len(keys) == 0 {
		return
	}
	if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
		log.Warn().Err(err).Msg("cache delete failed")
	}
}

// Invalidate removes every key for one entity within one tenant. It scans
// rather than using KEYS — KEYS blocks the whole server for the duration, and
// on a shared Redis that is every product's latency, not just this one's.
func (c *Cache) Invalidate(ctx context.Context, tenantID, entity string) {
	iter := c.rdb.Scan(ctx, 0, Prefix(tenantID, entity), 100).Iterator()
	var batch []string
	for iter.Next(ctx) {
		batch = append(batch, iter.Val())
		if len(batch) >= 100 {
			c.Del(ctx, batch...)
			batch = batch[:0]
		}
	}
	if err := iter.Err(); err != nil {
		log.Warn().Err(err).Msg("cache scan failed")
	}
	c.Del(ctx, batch...)
}

// Client exposes the underlying client for pub/sub and rate limiting, which
// need commands this wrapper deliberately does not proxy.
func (c *Cache) Client() *redis.Client { return c.rdb }
`;
}

export function goRateLimit(slug) {
  return `package cache

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
)

// Allow reports whether an action is within its rate limit, using a fixed
// window. The counter and its expiry are set in one round trip so a crash
// between them cannot leave a key that never expires and locks the subject
// out permanently.
//
// Unlike the read cache, this FAILS CLOSED when Redis is unavailable: a rate
// limiter that opens under failure is a rate limiter that disappears exactly
// when something is hammering it. Callers that would rather serve traffic
// than enforce the limit must opt into that explicitly.
func (c *Cache) Allow(ctx context.Context, subject string, limit int, window time.Duration) bool {
	key := "rl:" + subject
	pipe := c.rdb.TxPipeline()
	count := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Error().Err(err).Str("subject", subject).Msg("rate limiter unavailable, denying")
		return false
	}
	return count.Val() <= int64(limit)
}
`;
}

export function goRealtimeChat(slug) {
  return `package realtime

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"

	"${GO_MODULE_ROOT}/${slug}/api/internal/middleware"
)

// Hub fans messages out to connected clients.
//
// The local map only ever holds connections THIS replica is serving. Two
// users on the same conversation routinely land on different replicas, so
// delivery goes through Redis pub/sub and comes back to every replica —
// including this one, which is why publish does not also write locally. A hub
// that skips the bus works perfectly with one replica and silently drops half
// the messages the moment a second one starts.
type Hub struct {
	rdb   *redis.Client
	mu    sync.RWMutex
	rooms map[string]map[*conn]struct{}
}

type conn struct {
	ws   *websocket.Conn
	send chan []byte
}

type Envelope struct {
	Room     string          \`json:"room"\`
	TenantID string          \`json:"tenant_id"\`
	Kind     string          \`json:"kind"\`
	Payload  json.RawMessage \`json:"payload"\`
}

// Rooms are tenant-namespaced for the same reason cache keys are: a room id
// chosen by one organisation must never collide with another's.
func roomKey(tenantID, room string) string { return "rt:" + tenantID + ":" + room }

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{rdb: rdb, rooms: make(map[string]map[*conn]struct{})}
}

var upgrader = websocket.FastHTTPUpgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// The gateway is same-origin, so a cross-origin upgrade is not a case that
	// should succeed. Returning true here would make every authenticated
	// socket reachable from any site the user visits.
	CheckOrigin: func(ctx *fasthttp.RequestCtx) bool {
		origin := string(ctx.Request.Header.Peek("Origin"))
		host := string(ctx.Host())
		return origin == "" || origin == "https://"+host || origin == "http://"+host
	},
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 50 * time.Second // must stay below pongWait
)

// Handle upgrades a request and joins it to a room.
func (h *Hub) Handle(ctx *fasthttp.RequestCtx, room string) {
	tenantID := middleware.TenantID(ctx)
	if tenantID == "" {
		ctx.SetStatusCode(fasthttp.StatusForbidden)
		return
	}
	key := roomKey(tenantID, room)

	err := upgrader.Upgrade(ctx, func(ws *websocket.Conn) {
		c := &conn{ws: ws, send: make(chan []byte, 32)}
		h.join(key, c)
		defer h.leave(key, c)

		go c.writeLoop()
		c.readLoop()
	})
	if err != nil {
		log.Warn().Err(err).Msg("websocket upgrade failed")
	}
}

func (h *Hub) join(key string, c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[key] == nil {
		h.rooms[key] = make(map[*conn]struct{})
	}
	h.rooms[key][c] = struct{}{}
}

func (h *Hub) leave(key string, c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[key]; ok {
		delete(room, c)
		if len(room) == 0 {
			delete(h.rooms, key)
		}
	}
	close(c.send)
}

// Publish sends a message to every replica, which each deliver it to their own
// connections. It does NOT write to the local room directly — that would
// double-deliver to senders on this replica when the subscription echoes back.
func (h *Hub) Publish(ctx context.Context, env Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, roomKey(env.TenantID, env.Room), b).Err()
}

// Subscribe runs for the life of the process, delivering bus messages to local
// connections.
func (h *Hub) Subscribe(ctx context.Context) {
	sub := h.rdb.PSubscribe(ctx, "rt:*")
	defer sub.Close()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-sub.Channel():
			if !ok {
				return
			}
			h.deliver(msg.Channel, []byte(msg.Payload))
		}
	}
}

func (h *Hub) deliver(key string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.rooms[key] {
		select {
		case c.send <- payload:
		default:
			// A client that cannot keep up is dropped rather than allowed to
			// block delivery for everyone else in the room.
			log.Warn().Str("room", key).Msg("slow client, dropping message")
		}
	}
}

func (c *conn) readLoop() {
	defer c.ws.Close()
	c.ws.SetReadLimit(64 << 10)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := c.ws.ReadMessage(); err != nil {
			return
		}
		// Inbound frames are not echoed to the room here. A message becomes
		// real by going through the service layer — validated, authorised and
		// persisted — and reaches the room via Publish. Broadcasting straight
		// from the socket skips every one of those.
	}
}

func (c *conn) writeLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.ws.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			// Without pings, an idle socket is reaped by an intermediary with
			// no close frame, and neither end notices until the next send.
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
`;
}

export function goRealtimeVideo(slug) {
  return `package realtime

import (
	"fmt"
	"time"

	"github.com/livekit/protocol/auth"
)

// LiveKit handles voice and video. The API never proxies media — it only
// mints access tokens, and clients connect to LiveKit directly. Putting media
// through the API would make every call a sustained load on a service sized
// for JSON requests.
type LiveKit struct {
	host      string
	apiKey    string
	apiSecret string
}

func NewLiveKit(host, apiKey, apiSecret string) (*LiveKit, error) {
	if host == "" || apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("livekit: host, key and secret are all required")
	}
	return &LiveKit{host: host, apiKey: apiKey, apiSecret: apiSecret}, nil
}

// Room names are tenant-namespaced. Without that, two organisations that both
// name a room "assembly" join the same call.
func RoomName(tenantID, room string) string { return tenantID + ":" + room }

// Token mints a join token for one identity in one room.
//
// The TTL is short on purpose. This grants entry to a live call, so a token
// that leaks should stop working in minutes, not days — clients refresh
// rather than holding a long-lived credential.
func (l *LiveKit) Token(tenantID, room, identity, name string, canPublish bool) (string, error) {
	at := auth.NewAccessToken(l.apiKey, l.apiSecret)
	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         RoomName(tenantID, room),
		CanPublish:   &canPublish,
		CanSubscribe: boolPtr(true),
	}
	at.AddGrant(grant).
		SetIdentity(identity).
		SetName(name).
		SetValidFor(15 * time.Minute)
	return at.ToJWT()
}

func boolPtr(b bool) *bool { return &b }

func (l *LiveKit) Host() string { return l.host }
`;
}

export function goStorage(slug) {
  return `package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Cloudflare R2, through the S3 API.
//
// Two things differ from real S3 and both fail confusingly:
//
//   REGION MUST BE "auto". R2 has no regions. Passing eu-west-1 or anything
//   else produces a signature mismatch, which reads as a credentials problem
//   and is not one.
//
//   NO ACLs. R2 rejects ACL parameters outright, so public access is a bucket
//   setting or a public bucket URL — never an per-object ACL on upload.
type Storage struct {
	client *s3.Client
	bucket string
	// Presign has its own client because presigned URLs must be signed against
	// the account endpoint, while a custom public domain is only ever used for
	// reads.
	publicBase string
}

type Config struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	// Optional custom domain bound to the bucket, for public reads.
	PublicBase string
}

func New(ctx context.Context, cfg Config) (*Storage, error) {
	if cfg.AccountID == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || cfg.Bucket == "" {
		return nil, fmt.Errorf("r2: account id, key, secret and bucket are all required")
	}
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.AccountID)

	client := s3.New(s3.Options{
		// "auto" is not a placeholder. R2 requires this exact value.
		Region:       "auto",
		BaseEndpoint: aws.String(endpoint),
		Credentials: credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey, ""),
	})

	return &Storage{client: client, bucket: cfg.Bucket, publicBase: cfg.PublicBase}, nil
}

// Key builds a tenant-namespaced object key. Same rule as cache keys and room
// names: without the tenant prefix, one organisation's upload can overwrite
// another's by choosing the same filename.
func Key(tenantID, kind, name string) string {
	return fmt.Sprintf("%s/%s/%s", tenantID, kind, name)
}

// PresignPut returns a URL the client uploads to directly.
//
// Uploads never pass through the API. Proxying them would tie up a request
// worker for the whole transfer and cap file size at the server's body limit,
// for no benefit — the presigned URL already carries the authorisation.
func (s *Storage) PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	ps := s3.NewPresignClient(s.client)
	req, err := ps.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
		// No ACL field: R2 rejects it.
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign put: %w", err)
	}
	return req.URL, nil
}

// PresignGet returns a time-limited read URL for a private object.
func (s *Storage) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	ps := s3.NewPresignClient(s.client)
	req, err := ps.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return req.URL, nil
}

// PublicURL is only valid for a bucket exposed on a custom domain. It returns
// "" otherwise rather than inventing an r2.cloudflarestorage.com URL, which
// would 401 for anyone without credentials.
func (s *Storage) PublicURL(key string) string {
	if s.publicBase == "" {
		return ""
	}
	return s.publicBase + "/" + key
}

func (s *Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}
`;
}

export function goMailer(slug) {
  return `package mail

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// Transactional email over Zoho SMTP.
//
// Zoho specifics that are not guessable from a failure message:
//
//   The FROM address must be a real mailbox or a verified alias on the Zoho
//   account that authenticated. Zoho rejects a mismatch with a generic 553,
//   which reads like a syntax error in the address.
//
//   With two-factor auth on the account, the password here must be an
//   application-specific password. The account password fails with the same
//   535 as a wrong password.
//
//   Port 587 is STARTTLS. Port 465 is implicit TLS and needs a different dial
//   — do not point this at 465.
type Mailer struct {
	host     string
	port     string
	username string
	password string
	from     string
	fromName string
}

type Config struct {
	// smtp.zoho.com, or the regional host the account lives on —
	// smtp.zoho.eu and smtp.zoho.in are NOT interchangeable, and using the
	// wrong one fails authentication rather than routing.
	Host     string
	Port     string
	Username string
	Password string
	From     string
	FromName string
}

func New(cfg Config) (*Mailer, error) {
	var missing []string
	if cfg.Host == "" {
		missing = append(missing, "SMTP_HOST")
	}
	if cfg.Username == "" {
		missing = append(missing, "SMTP_USERNAME")
	}
	if cfg.Password == "" {
		missing = append(missing, "SMTP_PASSWORD")
	}
	if cfg.From == "" {
		missing = append(missing, "SMTP_FROM")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("mail: missing %s", strings.Join(missing, ", "))
	}
	port := cfg.Port
	if port == "" {
		port = "587"
	}
	return &Mailer{
		host: cfg.Host, port: port,
		username: cfg.Username, password: cfg.Password,
		from: cfg.From, fromName: cfg.FromName,
	}, nil
}

type Message struct {
	To      []string
	Subject string
	HTML    string
	Text    string
}

// Send delivers one message synchronously.
//
// Call this from a job, not from a request handler. Zoho throttles, a
// handshake plus delivery routinely takes seconds, and a user waiting on a
// signup response should not also be waiting on someone else's mail server.
func (m *Mailer) Send(ctx context.Context, msg Message) error {
	if len(msg.To) == 0 {
		return fmt.Errorf("mail: no recipients")
	}
	addr := m.host + ":" + m.port

	d := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	// STARTTLS is not optional. Without it the credentials below cross the
	// network in plain text.
	if err := c.StartTLS(&tls.Config{ServerName: m.host, MinVersion: tls.VersionTLS12}); err != nil {
		return fmt.Errorf("starttls: %w", err)
	}
	if err := c.Auth(smtp.PlainAuth("", m.username, m.password, m.host)); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := c.Mail(m.from); err != nil {
		return fmt.Errorf("smtp from: %w", err)
	}
	for _, to := range msg.To {
		if err := c.Rcpt(to); err != nil {
			return fmt.Errorf("smtp rcpt %s: %w", to, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(m.build(msg)); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close: %w", err)
	}
	return c.Quit()
}

// build renders a multipart/alternative message. Both parts are sent because
// a text/html-only mail scores badly with spam filters and is unreadable in
// clients that refuse HTML.
func (m *Mailer) build(msg Message) []byte {
	boundary := "mixed-boundary-appsotech"
	from := m.from
	if m.fromName != "" {
		from = fmt.Sprintf("%s <%s>", m.fromName, m.from)
	}
	text := msg.Text
	if text == "" {
		text = "This message requires an HTML-capable mail client."
	}

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\\r\\n", from)
	fmt.Fprintf(&b, "To: %s\\r\\n", strings.Join(msg.To, ", "))
	fmt.Fprintf(&b, "Subject: %s\\r\\n", msg.Subject)
	b.WriteString("MIME-Version: 1.0\\r\\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%s\\r\\n\\r\\n", boundary)

	fmt.Fprintf(&b, "--%s\\r\\n", boundary)
	b.WriteString("Content-Type: text/plain; charset=UTF-8\\r\\n\\r\\n")
	b.WriteString(text + "\\r\\n\\r\\n")

	fmt.Fprintf(&b, "--%s\\r\\n", boundary)
	b.WriteString("Content-Type: text/html; charset=UTF-8\\r\\n\\r\\n")
	b.WriteString(msg.HTML + "\\r\\n\\r\\n")

	fmt.Fprintf(&b, "--%s--\\r\\n", boundary)
	return []byte(b.String())
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

export function goEnvExample(slug, apiPort, database, caps = {}) {
  const { redis = false, realtime = [], storage = false, mail = false } = caps;
  let out = `# Copy to .env and fill in. Never commit the filled copy.
SERVER_ADDR=:${apiPort}
PORT=${apiPort}
ENVIRONMENT=development

# No default exists for these two on purpose: a default database URL points
# somewhere real, and a default signing secret is one an attacker also has.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/${database}?sslmode=disable
JWT_SECRET=

# Comma-separated. Only these origins get CORS credentials.
ALLOWED_ORIGINS=http://localhost:3000
`;

  if (redis) {
    out += `
# Cache, and where chat is enabled the pub/sub bus between replicas.
REDIS_URL=redis://localhost:6379/0
`;
  }
  if (storage) {
    out += `
# Cloudflare R2. The endpoint is derived from the account id. The region is
# always "auto" and is not configurable — R2 has no regions, and any other
# value fails as a signature mismatch that reads like bad credentials.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=${slug}
# Optional custom domain bound to the bucket, for public reads. Without one,
# every read has to be a presigned URL.
R2_PUBLIC_BASE=
`;
  }
  if (mail) {
    out += `
# Zoho SMTP. 587 is STARTTLS; do not point this at 465, which is implicit TLS
# and needs a different dial. Regional hosts are not interchangeable —
# smtp.zoho.com, smtp.zoho.eu and smtp.zoho.in are separate homes.
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USERNAME=
# With two-factor auth on the Zoho account this must be an application-specific
# password. The account password fails with the same 535 as a wrong one.
SMTP_PASSWORD=
# Must be a real mailbox or verified alias on the authenticating account, or
# Zoho rejects the send with a generic 553.
SMTP_FROM=
SMTP_FROM_NAME=${slug}
`;
  }
  if (realtime.includes('video')) {
    out += `
# LiveKit. The API mints join tokens; media never passes through it.
LIVEKIT_HOST=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
`;
  }
  return out;
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
