# J6 DB-local cleanup executor — unapplied candidate

## Decision and exact scope

A database-local **single top-level `CALL`** is a feasible alternative to supplying an external TS runner host. It is **not installed, scheduled, granted, selected as the live executor, or equivalent to the TS wall+monotonic-clock contract**. The candidate only adds two private helper functions and one invoker procedure to the frozen 8066 schema. It never changes total/consumed, chooses policy durations, installs a generation, accesses proof keys, invokes a provider, or enables admission.

Source baseline: QA `8066e8ffc03aec9c1491208f11f54e56a0bf339a`, tree `b8930ba43b3d57a211417cc52a86c684efe58391`. The baseline implementation is unchanged. Repository-relative candidate paths are listed below.

PostgreSQL 17.6 and pg_cron 1.6.4 are the version-pinned source-comparison targets in this document, not claims about any deployment. Before installation, verify the exact target and its versions using nonsecret metadata. **Extension presence does not establish the actual cron username, worker mode, connection authentication, routine grants, active timer, scheduling accuracy or a running job.** Target-runtime equivalence remains unverified by this source-only candidate.

## Official constraints, not guessed transaction semantics

- PostgreSQL permits transaction control in top-level CALL/DO, but not through a function/SELECT stack or inside an active EXCEPTION subtransaction. COMMIT releases locks; the second phase must lock and recheck. [PG 17 transaction management](https://www.postgresql.org/docs/17/plpgsql-transactions.html)
- A SECURITY DEFINER procedure **cannot COMMIT**. A procedure having a CREATE PROCEDURE SET clause also cannot COMMIT, including a seemingly protective `SET search_path`. The outer driver is therefore SECURITY INVOKER, with no SET clause; its fixed helper names are qualified. Definer helper functions can retain `SET search_path=''` because they themselves never commit. [PG 17 CREATE PROCEDURE](https://www.postgresql.org/docs/17/sql-createprocedure.html)
- A CALL inside an explicit BEGIN transaction cannot perform its internal commits. The installation transaction is separate from later runtime CALL. [PG 17 CALL](https://www.postgresql.org/docs/17/sql-call.html)
- In pg_cron 1.6.4's background-worker source, a single parsed command is top-level; its command execution supports internal transaction control. The worker arms an already configured StatementTimeout before command execution. This supports exactly one CALL, **not `SET …; CALL …`**, as the proposed job body. This is source interpretation, not proof of the managed deployment's launch mode or patched binary. [Pinned pg_cron 1.6.4 source](https://raw.githubusercontent.com/citusdata/pg_cron/v1.6.4/src/pg_cron.c)

## Minimum executor contract and privilege choices

| Concern | Existing injected TS runner | DB-local candidate |
|---|---|---|
| Host | An externally hosted runner and injected driver are still needed | A verified existing DB-local cron launch path may suffice; no HTTP job or app-secret endpoint |
| Time | Paired wall/monotonic observations plus one original Q timer | DB wall-clock observations plus original statement start, finite stored deadline and already configured statement timeout; no independent monotonic equivalence |
| Privileged capability | Fixed begin/finalize SQL execute capability | Fixed invoker CALL, two narrow definer helpers and schema USAGE; no arbitrary SQL interface |
| Durable phases | Driver awaits begin commit before finalize | CALL explicitly commits begin/purge/closed state, then separately finalizes and commits |
| Policy OFF | Maintenance independent of provider/admission flags | Same; unarmed/faulted configurations can purge but cannot certify |
| Schedule | Persisted nominal due + generation, no now-based rearm | Reads the same persisted due and generation; no automatic initialization, catch-up or reset |
| Uncertainty | Local abort/unknown does not prove DB rollback | Commit failure/ack loss/job failure does not prove previously committed state rolled back |

There are two bounded installation choices, neither authorized here:

1. **Existing administrative execution identity:** if its verified local cron launch path and existing privileges permit the fixed CALL, a new external credential might not be needed. Do not call that identity least-privilege simply because the command is fixed. Existing broad authority remains broad.
2. **Dedicated executor identity:** a separately reviewed role/ownership/grant design can limit it to the driver and narrow helpers. Creating LOGIN/NOLOGIN roles or giving grants is an actual security installation, not accomplished by this candidate. It is not a new prerequisite imposed on choice 1.

pg_cron normally opens a local libpq connection; authentication can require server-side configuration/password handling. Its background-worker alternative differs. It runs jobs with the scheduling identity's permissions, serializes instances of one job and can queue late runs. Thus installed pg_cron alone does **not** prove “no new credential needed” or bounded start delay. [Pinned pg_cron README](https://github.com/citusdata/pg_cron/blob/v1.6.4/README.md)

The SQL ends with revocations from public/API roles, not grants, followed by inherited-effective EXECUTE postconditions. Unexpected API access aborts the whole installation instead of repairing memberships or default privileges. The invoker requires access to the two helper routines because its helper calls execute as the invoker until entering each definer helper. Existing API caller permissions stay unchanged. Installer ownership and future executor identity need explicit installation review, not disclosure of secret values.

## Two committed phases

1. Private begin helper locks policy then health, reads the fixed policy hash/generation/next nominal due, and calls frozen `maintenance_begin`. It closes admission before the isolated purge. Ordinary purge failure leaves closed work eligible to commit. Wrong/unconfigured/faulted schedules only attempt a private purge and return no lease.
2. The driver leaves the nested exception block, **COMMIT 1**, then checks whether there is a lease. No token or user metadata is emitted. A failure is a generic unconfirmed status, not an invented successful heartbeat.
3. Private finalize validates exact lease shape and a bounded DB-clock contract; the frozen finalize rechecks current policy/generation/token/due and deadline under locks. It never accepts a caller-supplied `healthy=true` through this wrapper.
4. The driver leaves the second exception block, **COMMIT 2**. The finite certificate is no later than `nominalDue + I + J + Q`, never `now + I + J + Q`. Generic unconfirmed status is raised after durable work when appropriate.

The helpers' existence is not an authorization credential. Access is controlled by routine/schema privileges. A new generation still requires explicit policy linkage. Tokens fence concurrent attempts; they are not login or provider secrets.

## Timer and clock limits

`clock_timestamp()` is changing wall time; `statement_timestamp()` represents command receipt, while `now()` is transaction-start time. None is a SQL monotonic-clock promise. The candidate rejects observed backwards time and late stored deadlines, but cannot detect every unobserved wall-clock jump. [PG date/time semantics](https://www.postgresql.org/docs/17/functions-datetime.html)

The helper requires a positive, pre-existing statement timeout no larger than Q and elapsed statement wall time below Q. It **does not configure** that timeout. A per-lock timeout or per-transaction timeout is not a replacement for the whole two-phase command budget. Zero disables statement timeout. [PG timeout settings](https://www.postgresql.org/docs/17/runtime-config-client.html)

The timer value read from `pg_settings` is configuration metadata, not proof that a particular hosted worker armed the timer. PG 17.6 SPI source shows procedure COMMIT ends and starts transactions internally, which is why assuming every internal COMMIT creates a new top-level CALL budget is incorrect. Actual cancellation across both phases, locks and commit stalls still needs a matching PG/pg_cron execution check before a live time-bound claim. [PG 17.6 SPI source](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/executor/spi.c)

No physical commit-completion SLA is claimed. Cancellation/clock/Q checks can occur before final commit; a delayed or uncertain commit may leave a finite certificate, possibly already expired. Ready/consume re-evaluate stored validity with DB time; a late success never extends its nominal limit. A reviewed DB-only clock/executor artifact would be bound through the existing policy review hash, not silently substituted for TS evidence. No extra activation flag or live policy value is created here.

## Failure and retention boundaries

| Event | Honest result |
|---|---|
| Failure/cancellation before COMMIT 1 | The entire current transaction can roll back, leaving a prior finite lease; do not promise instantaneous universal close |
| Ordinary purge error handled inside frozen begin | Begin's outer close can commit; receipt remains for a later cleanup attempt; no refund |
| Failure after COMMIT 1, before successful final commit | No newly certified health; purge/closed admission already durable; state may be running but has no usable healthy lease |
| Successful final commit, acknowledgement lost | A finite certificate may exist despite local/job uncertainty; no inferred rollback and no blind retry |
| Job never starts / no app traffic / worker stopped | No application traffic is needed by a running cron job, but a stopped job does not delete; lease eventually fails readiness, and late deletion is possible |
| Queued/duplicate/early/missed run | Frozen due and one-shot token checks deny inappropriate certification; a late due is not shifted to now; cleanup still attempted |
| Worker restart | Reads stored generation/due; restart is not permission to reset or rearm |
| Old generation / policy change | Cannot certify a new generation; cleanup remains separable from admission |
| Account hard deletion | Existing FK/trigger behavior only; after prior owner detachment, account deletion is not a general schedule/log purge trigger |
| Restore/PITR | Database rollback can restore historical budget/schedule data; original 1-use guarantee across disaster recovery needs its separate preservation procedure, not a claim this executor solves |

Conditional deletion target remains **TTL plus I+J+Q only while the chosen executor actually starts within J and finishes within Q, clocks and database are healthy, and its job continues**. The candidate installs no TTL, I/J/Q or authorization-window values; defaults remain unconfigured. Test values (120/60/10/5) are synthetic, not approvals. Failed/stopped execution can exceed the target; health closure prevents new trials, not magical deletion of existing rows.

The fixed CALL has no owner/audio/score/token arguments or success notice. Generic ordinary-error output reduces leakage but is **not** a claim to suppress all PostgreSQL/cron/system logs. Cron run history, server logs and backups have separate retention; `cron.job_run_details` is not automatically cleaned by the extension. No live logs were inspected or changed. The remaining schedule metadata has no direct identifying fields, but is not certified anonymous.

## Evidence and next check

- Auxiliary pure/static model: 12/12 cases passed; an initial assertion matched the word “provider” in a comment, and the corrected assertion strips comments. This is separate model evidence, not additional actual SQL coverage.
- `lib/speech-retention-db-executor.test.ts`: portable repository test candidate; **14/14 actual PGlite tests passed in the coordinated serial run**. This checks actual candidate SQL locally, not pg_cron or hosted PG17.6 multi-session/cancellation semantics.
- No whole CI, browser, live DB, cron install, role/grant, environment/key/Vault, network provider or deployment operation occurred.
- Before an authorized real installation: resolve existing actor/launch mode and actual routine permissions, bind the selected clock/executor contract to the review artifact, choose approved policy/schedule values, perform a matching isolated runtime check, then install/schedule only under the separate approval. Do not merely fill values and label this live-ready.

Repository candidate paths: `docs/azure-pronunciation-usage/retention-db-executor-candidate.sql`, `retention-db-executor-candidate.md`, and `lib/speech-retention-db-executor.test.ts`. The preserved standalone model/mjs artifacts are separate evidence, not additional product test requirements.

The portable TS test adds two bounded cases beyond the preserved mjs: post-final-commit acknowledgement loss (finite certificate retained) and phase-two SQLSTATE 57014 cancellation (not caught by OTHERS, phase-one committed purge remains). It also uses millisecond-normalized timestamp comparison. The actual portable count is 13 subtests plus parent = **14 passed**, not the old 12-case mjs result. The initial combined run passed 33/33 (19 transfer + 14 executor); the final combined run passed **34/34 (20 transfer + 14 executor)** after one combined-install case was added. The two runs are not added together, and the two parent containers are included in those counts. Synthetic cancellation is not proof of hosted timer firing.
