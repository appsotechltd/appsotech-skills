# The Go API

fasthttp + fasthttprouter, pgx/v5 straight to Postgres, zerolog, golang-jwt/v5.
No ORM, no framework, no code generation.

## The feature package

One package per domain concept under `internal/`, and every one has the same
four files. Not three, not five.

```
internal/student/
├── model.go      # the types, and nothing else
├── queries.go    # SQL, and nothing else
├── service.go    # the rules
└── handler.go    # HTTP in, HTTP out
```

The split is what makes each layer testable without the one below it, and it
puts SQL where it can be read as SQL rather than assembled across a call chain.

### `model.go`

Types and their JSON tags. No behaviour, no database, no HTTP.

```go
package student

import "time"

type Student struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"-"`
	FirstName  string     `json:"first_name"`
	MiddleName *string    `json:"middle_name,omitempty"`
	LastName   string     `json:"last_name"`
	EnrolledAt time.Time  `json:"enrolled_at"`
	CreatedAt  time.Time  `json:"created_at"`
}
```

`TenantID` is `json:"-"` on purpose. It is never a client's to send — it comes
from the request context — and never a client's to read.

### `queries.go`

SQL and the code that runs it. Every query is a named constant so it can be
read whole and pasted into `psql` unchanged.

```go
const selectStudentByID = `
SELECT id, tenant_id, first_name, middle_name, last_name, enrolled_at, created_at
FROM students
WHERE id = $1 AND tenant_id = $2`

func (s *Store) ByID(ctx context.Context, id, tenantID string) (*Student, error) {
	row := s.pool.QueryRow(ctx, selectStudentByID, id, tenantID)
	var st Student
	err := row.Scan(&st.ID, &st.TenantID, &st.FirstName, &st.MiddleName,
		&st.LastName, &st.EnrolledAt, &st.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, problems.NotFound("student not found")
	}
	if err != nil {
		return nil, fmt.Errorf("select student: %w", err)
	}
	return &st, nil
}
```

**Always parameterised, never formatted.** `fmt.Sprintf` into a query is how
SQL injection gets in; there is no case where it is needed.

**`tenant_id` in the WHERE clause even though RLS also enforces it.** Belt and
braces on purpose: RLS is the guarantee that a forgotten clause fails closed,
and the explicit clause is what makes the index usable and the intent legible.

Cursor pagination, never offset. An offset paginator silently skips or repeats
rows whenever the underlying set changes between pages, which under load it
always does.

### `service.go`

The rules. Validation, authorisation, orchestration, transactions. This is
where the domain lives and it takes no `fasthttp` import — that is what makes
it testable without a server.

```go
func (s *Service) Enrol(ctx context.Context, in EnrolInput, actor Actor) (*Student, error) {
	if fields := in.Validate(); len(fields) > 0 {
		return nil, problems.Validation(fields)
	}
	if !actor.Can("student:create") {
		return nil, problems.Forbidden("cannot enrol students")
	}
	// ...
}
```

Authorisation lives here, not in the handler. A rule in a handler is a rule a
background job and a CLI command both skip.

### `handler.go`

Decode, call the service, write the response. Nothing else — no SQL, no rules,
no branching on anything but the error.

```go
func (h *Handler) Create(ctx *fasthttp.RequestCtx) {
	var in EnrolInput
	if err := json.Unmarshal(ctx.PostBody(), &in); err != nil {
		response.Error(ctx, problems.BadRequest("malformed JSON"))
		return
	}
	st, err := h.svc.Enrol(ctx, in, actorFrom(ctx))
	if err != nil {
		response.Error(ctx, err)
		return
	}
	response.Created(ctx, st)
}
```

`response.Error` unwraps a `*problems.Problem` and turns anything else into a
bare 500. An unrecognised error is by definition one whose text has not been
reviewed for what it discloses.

### Routes

Each feature package exposes one function, called from `cmd/api/main.go`:

```go
func Routes(r *fasthttprouter.Router, h *Handler) {
	r.GET("/v1/students", h.List)
	r.POST("/v1/students", h.Create)
	r.GET("/v1/students/:id", h.Get)
	r.PATCH("/v1/students/:id", h.Update)
	r.DELETE("/v1/students/:id", h.Delete)
}
```

## The wire contract

Success is `{"data": ...}`. A list is `{"data": [...], "pagination": {...}}`.
The envelope is not decoration — it leaves room to add metadata to any endpoint
later without that being a breaking change.

Errors are RFC 7807 `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "one or more fields are invalid",
  "errors": { "first_name": "required" }
}
```

One shape means a client has exactly one error branch to write, and `errors`
binds field messages straight onto form inputs.

## Middleware

`Chain` applies middleware so the **first argument is the outermost wrapper** —
reading order and execution order match. The order is security-ordered, not
alphabetical:

```go
middleware.Chain(router.Handler,
	middleware.Logger(),        // outermost: a rejected request is still logged
	middleware.CORS(origins),   // before auth: a browser gets a usable preflight
	middleware.Tenant(pool),    // pins the organisation
	middleware.Auth(secret),    // verifies the JWT
	middleware.RBAC(),          // needs the claims Auth produced
)
```

CORS reflects an origin only when it is on the allow list. Echoing an arbitrary
`Origin` back with credentials enabled makes every authenticated endpoint
readable by any site the user happens to visit.

## Migrations

Numbered pairs, applied in order, never edited once merged:

```
000001_base_tables.up.sql       000001_base_tables.down.sql
000002_students.up.sql          000002_students.down.sql
```

Editing a merged migration means two databases with the same version number and
different schemas, which is not a state anything can recover from. Fix forward
with a new pair.

Every table carries a tenant column and gets its RLS policy **in the same
migration that creates it**:

```sql
CREATE TABLE students (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every tenant-scoped lookup leads with tenant_id, so the index does too.
CREATE INDEX students_tenant_idx ON students (tenant_id, last_name);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

CREATE POLICY students_tenant_isolation ON students
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`FORCE ROW LEVEL SECURITY` matters: without it the table's owner bypasses the
policy, and the API very often connects as the owner.

`WITH CHECK` matters separately from `USING`. `USING` filters what can be read;
without `WITH CHECK`, a tenant can still *insert* a row belonging to another.

A separate migration granting a policy to a table added earlier is the pattern
to avoid — between the two, that table is readable across tenants.

## Testing

Table-driven, against a real Postgres. A mocked database does not have RLS, so
a mocked test cannot tell you whether the isolation you just wrote works — and
that is the property most worth testing.

```go
func TestEnrol(t *testing.T) {
	tests := []struct {
		name    string
		input   EnrolInput
		wantErr int
	}{
		{"valid", EnrolInput{FirstName: "Ada", LastName: "Lovelace"}, 0},
		{"missing surname", EnrolInput{FirstName: "Ada"}, 422},
	}
	// ...
}
```

Test the tenant boundary explicitly: create a row as tenant A, read it as
tenant B, assert nothing comes back. That test is the one that catches a
migration that forgot its policy.
