# Vibe Coder — On-Call Runbook & Incident Response Procedures

---

## 1. On-Call Overview

### 1.1 On-Call Rotation

| Role | Responsibility | Hours | Escalation |
|---|---|---|---|
| **Primary On-Call** | First responder, triage, initial mitigation | 24/7 (1-week shifts) | Escalate after 30 min if unresolved |
| **Secondary On-Call** | Backup, assist with complex issues | 24/7 (1-week shifts) | Step in if Primary unavailable |
| **Engineering Manager** | Resource allocation, communication | Business hours + on-call escalation | Escalate after 1 hour |
| **VP of Engineering** | Executive decisions, external communication | Escalation only | Escalate for P1 incidents |

### 1.2 Communication Channels

| Channel | Purpose | When to Use |
|---|---|---|
| `#incident-active` (Slack) | Real-time incident coordination | All P1/P2 incidents |
| `#oncall-alerts` (Slack) | Automated alert delivery | All alerts |
| `#engineering` (Slack) | General engineering updates | P3 incidents, maintenance |
| PagerDuty | Pager escalation | P1 alerts, after-hours |
| StatusPage | Public status updates | P1 incidents affecting users |
| Bridge call | Voice coordination | Complex multi-service incidents |

### 1.3 Incident Severity Matrix

| Severity | Definition | Response Time | Resolution Target | Examples |
|---|---|---|---|---|
| **P1 — Critical** | Service completely down, data loss, security breach | 5 min | 1 hour | All users unable to log in; data breach confirmed; database corruption |
| **P2 — Major** | Core feature unavailable, significant degradation | 15 min | 4 hours | Analysis pipeline down; chat not working; payments failing |
| **P3 — Minor** | Feature degraded, workaround exists | 1 hour | 24 hours | Slow retrieval; occasional WebSocket disconnects; UI glitches |
| **P4 — Low** | Cosmetic issue, non-urgent | Next business day | 1 week | Typos; minor UI inconsistencies; non-critical log errors |

---

## 2. Quick Reference — Common Incidents

### 2.1 Alert → Runbook Quick Map

| Alert Name | Severity | Runbook Section | First Action |
|---|---|---|---|
| `AnalysisJobFailureRateHigh` | P2 | §3.2 | Check worker logs, verify queue depth |
| `APILatencyP95High` | P2 | §3.3 | Check database connections, Redis cache hit rate |
| `RetrievalLatencyHigh` | P2 | §3.4 | Check Elasticsearch/Pinecone health, index size |
| `LLMGenerationLatencyHigh` | P2 | §3.5 | Check OpenAI status, token usage, queue backlog |
| `WebSocketConnectionFailure` | P2 | §3.6 | Check Redis pub/sub, load balancer sticky sessions |
| `DatabaseConnectionPoolExhausted` | P1 | §3.7 | Check PgBouncer, kill long-running queries |
| `GitHubAPIRateLimitExceeded` | P3 | §3.8 | Check token pool, reduce analysis concurrency |
| `OpenAIQuotaExceeded` | P1 | §3.9 | Check billing, switch to fallback model |
| `DiskSpaceLow` | P2 | §3.10 | Clean old repo clones, check S3 lifecycle |
| `MemoryUsageCritical` | P2 | §3.11 | Identify leaky service, restart if needed |
| `ErrorRateSpike` | P1 | §3.12 | Check recent deployments, roll back if needed |
| `PaymentProcessingFailure` | P2 | §3.13 | Check Stripe status, verify webhook delivery |

---

## 3. Detailed Incident Procedures

### 3.1 General Incident Response Process

```
┌────────────────────────────────────────────────────────────┐
│              INCIDENT RESPONSE LIFECYCLE                     │
│                                                              │
│  ┌──────┐   ┌──────┐   ┌──────────┐   ┌──────────┐       │
│  │DETECT│──▶│TRIAGE│──▶│MITIGATE  │──▶│RESOLVE   │       │
│  └──────┘   └──────┘   └──────────┘   └──────────┘       │
│     │           │           │               │               │
│     │           │           │               ▼               │
│     │           │           │          ┌──────────┐        │
│     │           │           │          │ POST-    │        │
│     │           │           │          │MORTEM    │        │
│     │           │           │          └──────────┘        │
│     │           │           │                               │
│     ▼           ▼           ▼                               │
│  ┌──────────────────────────────────────────────┐          │
│  │  1. Alert fires → Acknowledge in PagerDuty   │          │
│  │  2. Assess severity → Set incident channel   │          │
│  │  3. Begin investigation → Update timeline    │          │
│  │  4. Mitigate → Restore service               │          │
│  │  5. Communicate → StatusPage + Slack         │          │
│  │  6. Resolve → Confirm recovery               │          │
│  │  7. Post-mortem → Within 48 hours            │          │
│  └──────────────────────────────────────────────┘          │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

**Step-by-step process:**

1. **Detect & Acknowledge** (0–5 min)
   - Acknowledge alert in PagerDuty
   - Open `#incident-active` Slack channel
   - Post: `🔴 INCIDENT: [Brief description] | Severity: P[X] | On-call: [Name] | Started: [Time]`

2. **Triage & Assess** (5–15 min)
   - Determine scope: How many users affected?
   - Check if issue is isolated or system-wide
   - Review recent deployments (last 2 hours)
   - Check external service status pages
   - Determine if mitigation is needed immediately

3. **Mitigate** (15–60 min)
   - Apply quick fix (rollback, scale up, feature flag)
   - Verify mitigation working
   - If unable to mitigate in target time → escalate

4. **Communicate**
   - Update `#incident-active` with progress every 15 min
   - Update StatusPage for P1 incidents
   - Notify stakeholders for P1/P2

5. **Resolve & Confirm**
   - Verify all metrics returned to normal
   - Confirm users can access affected features
   - Mark incident resolved in PagerDuty
   - Post resolution summary

6. **Post-Mortem**
   - Schedule within 48 hours
   - Blameless, focus on systems not individuals
   - Document root cause, timeline, action items

---

### 3.2 Analysis Pipeline Failures

**Symptoms:**
- `AnalysisJobFailureRateHigh` alert fires
- Users report "Analysis failed" or stuck at a stage
- Worker logs show errors

**Investigation:**

```bash
# 1. Check overall pipeline health
aws cloudwatch get-metric-statistics \
  --namespace "VibeCoder/Analysis" \
  --metric-name "JobFailureRate" \
  --period 300 \
  --statistics Average \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# 2. Check worker logs for recent failures
aws logs filter-log-events \
  --log-group-name "/aws/ecs/analysis-worker" \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '30 minutes ago' +%s000)

# 3. Check queue depth
redis-cli LLEN analysis:jobs:pending
redis-cli LLEN analysis:jobs:in_progress

# 4. Check specific failed job
# Get job ID from alert or user report
curl -s "http://api.internal:8000/api/v1/admin/jobs/${JOB_ID}" | jq .
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| GitHub clone failure | Jobs stuck at "cloning" stage | Check GitHub token validity, rate limits |
| AST parser OOM | Workers killed, SIGTERM in logs | Restart worker, increase memory limit |
| Invalid file encoding | Parse errors on specific files | Skip files with encoding errors (already handled) |
| OpenAI API timeout | Jobs stuck at "generating" stage | Check OpenAI status, retry job |
| Database connection exhausted | "too many connections" in logs | Restart PgBouncer, kill idle connections |

**Mitigation:**
1. If specific repo causing issues → Cancel that job: `POST /api/v1/admin/jobs/{id}/cancel`
2. If all workers stuck → Restart worker fleet: `aws ecs update-service --cluster vibecoder --service analysis-worker --force-new-deployment`
3. If queue backed up → Scale workers: `aws ecs update-service --cluster vibecoder --service analysis-worker --desired-count 10`

---

### 3.3 API Latency Degradation

**Symptoms:**
- `APILatencyP95High` alert fires
- Users report slow page loads or timeouts
- Dashboard shows elevated response times

**Investigation:**

```bash
# 1. Identify which endpoints are slow
# Check Grafana dashboard: API Latency by Endpoint

# 2. Check database performance
psql -h vibecoder-db.internal -U vibecoder -d vibecoder_prod -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC
  LIMIT 10;
"

# 3. Check for lock contention
psql -c "
  SELECT blocked_locks.pid AS blocked_pid,
         blocking_locks.pid AS blocking_pid,
         blocked_activity.query AS blocked_statement
  FROM pg_catalog.pg_locks blocked_locks
  JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
  JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  WHERE NOT blocked_locks.granted;
"

# 4. Check Redis cache hit rate
redis-cli INFO stats | grep keyspace

# 5. Check ECS service health
aws ecs describe-services --cluster vibecoder --services api-server
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Slow database queries | High DB CPU, connection pool saturation | Add missing indexes, optimize queries |
| Redis cache misses | High Redis miss rate | Verify cache keys, warm cache |
| Connection pool exhaustion | "timeout acquiring connection" | Increase pool size, check for leaks |
| CPU saturation | ECS CPU > 80% | Scale out API servers |
| External service slow | High latency in downstream calls | Add circuit breakers, timeouts |

**Mitigation:**
1. Scale API servers: `aws ecs update-service --cluster vibecoder --service api-server --desired-count [new_count]`
2. Enable query-level caching in Redis for slow endpoints
3. Add read replicas if DB is bottleneck: `aws rds create-db-instance-read-replica`

---

### 3.4 Retrieval Engine Issues

**Symptoms:**
- `RetrievalLatencyHigh` or `RetrievalPrecisionLow` alerts
- Chat responses are generic/unrelated to code
- "No relevant code found" when code exists

**Investigation:**

```bash
# 1. Check Elasticsearch health
curl -s "http://elasticsearch.internal:9200/_cluster/health?pretty"

# 2. Check index stats
curl -s "http://elasticsearch.internal:9200/code_chunks/_stats?pretty" | jq .indices.code_chunks.primaries.search

# 3. Check Pinecone index stats
curl -s "https://controller.${PINECONE_ENV}.pinecone.io/describe_index_stats" \
  -H "Api-Key: ${PINECONE_API_KEY}"

# 4. Test retrieval directly
curl -s -X POST "http://retrieval-engine.internal:8001/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "authentication middleware", "repo_id": "test-repo-id", "top_k": 10}'

# 5. Check embedding generation
curl -s "http://retrieval-engine.internal:8001/health" | jq .
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Stale index | Results from old code version | Re-index after re-analysis |
| Index corruption | Empty or garbled results | Rebuild index from scratch |
| Embedding model mismatch | Poor semantic matching | Ensure consistent embedding model |
| Elasticsearch memory pressure | Slow queries, circuit breaker trips | Increase JVM heap, add data nodes |
| Pinecone quota exceeded | Vector search failures | Upgrade plan or reduce index size |

**Mitigation:**
1. Re-index specific repo: `curl -X POST /api/v1/admin/repos/{id}/reindex`
2. Scale Elasticsearch: `curl -X PUT /_cluster/settings -d '{"transient":{"cluster.routing.allocation.enable":"all"}}'`
3. If Pinecone down → Fall back to Elasticsearch-only mode (feature flag: `RETRIEVAL_FALLBACK_MODE=true`)

---

### 3.5 LLM Generation Issues

**Symptoms:**
- `LLMGenerationLatencyHigh` or `OpenAIErrorRateHigh` alerts
- Chat responses are empty or malformed
- Citation counts drop significantly

**Investigation:**

```bash
# 1. Check OpenAI API status
curl -s "https://status.openai.com/api/v2/status.json"

# 2. Check token usage and costs
aws cloudwatch get-metric-statistics \
  --namespace "VibeCoder/LLM" \
  --metric-name "TokensUsed" \
  --period 3600 \
  --statistics Sum \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# 3. Check generation service logs
aws logs filter-log-events \
  --log-group-name "/aws/ecs/generation-service" \
  --filter-pattern "ERROR OR timeout OR rate_limit" \
  --start-time $(date -u -d '15 minutes ago' +%s000)

# 4. Check current API key quota
# Verify in Stripe dashboard or OpenAI dashboard

# 5. Test generation directly
curl -s -X POST "http://generation.internal:8002/generate" \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "context": [], "mode": "chat"}'
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| OpenAI rate limit hit | 429 errors in logs | Switch to backup model, queue requests |
| OpenAI quota exceeded | 429 with "insufficient_quota" | Update billing, or use fallback provider |
| Context too large | Generation timeout or error | Reduce context window, improve retrieval precision |
| Prompt injection attempts | Unexpected model behavior | Strengthen input sanitization |
| Model deprecation | Unexpected errors | Update model version in config |

**Mitigation:**
1. Enable fallback model: Set `LLM_FALLBACK_MODEL=gpt-3.5-turbo-16k` in environment
2. Reduce concurrent generations: Set `LLM_MAX_CONCURRENT=5`
3. If OpenAI fully down → Switch to Anthropic: `LLM_PROVIDER=anthropic`

---

### 3.6 WebSocket / Chat Issues

**Symptoms:**
- `WebSocketConnectionFailure` alert
- Users report chat messages not sending or receiving
- Streaming responses stuck or dropped

**Investigation:**

```bash
# 1. Check WebSocket server health
curl -s "http://websocket.internal:8080/health"

# 2. Check active connections
redis-cli GET "ws:connections:count"

# 3. Check Redis pub/sub health
redis-cli PUBSUB NUMSUB ws:broadcast

# 4. Check ALB target health for WebSocket service
aws elbv2 describe-target-health \
  --target-group-arn ${WS_TARGET_GROUP_ARN}

# 5. Check WebSocket server logs
aws logs filter-log-events \
  --log-group-name "/aws/ecs/websocket-server" \
  --filter-pattern "ERROR OR disconnect OR timeout" \
  --start-time $(date -u -d '15 minutes ago' +%s000)
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Redis pub/sub failure | Messages not broadcast | Check Redis health, restart if needed |
| Sticky session misconfiguration | Connections dropped on reconnect | Verify ALB stickiness settings |
| Memory leak in WS server | Gradual connection degradation | Restart affected instances |
| ALB idle timeout | Connections killed after inactivity | Increase ALB timeout to 3600s |
| Network partition | Partial message delivery | Check security groups, NACLs |

**Mitigation:**
1. Restart WebSocket servers: `aws ecs update-service --cluster vibecoder --service websocket-server --force-new-deployment`
2. Clear stale connections: `redis-cli DEL "ws:connections:*"`
3. Scale WebSocket servers: Increase desired count

---

### 3.7 Database Issues

**Symptoms:**
- `DatabaseConnectionPoolExhausted` or `DatabaseReplicationLag` alerts
- All API requests timing out
- "FATAL: too many connections" in logs

**Investigation:**

```bash
# 1. Check connection count
psql -c "SELECT count(*) FROM pg_stat_activity;"

# 2. Check connection by state
psql -c "
  SELECT state, count(*)
  FROM pg_stat_activity
  GROUP BY state;
"

# 3. Check long-running queries
psql -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';
"

# 4. Check replication lag (if using read replicas)
aws rds describe-db-instances \
  --db-instance-identifier vibecoder-replica-1 \
  --query 'DBInstances[0].StatusInfos'

# 5. Check disk usage
psql -c "SELECT pg_database_size('vibecoder_prod');"
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Connection leak | Connections grow unbounded | Identify leaking service, restart it |
| Long-running queries | Many active queries, locks | Kill queries, add indexes |
| Replication lag | Read-after-write inconsistency | Check replica load, optimize heavy writes |
| Disk space full | Writes failing | Archive old data, expand storage |
| Lock contention | Deadlocks, timeouts | Optimize transaction scope, retry logic |

**Mitigation:**
1. Kill long queries: `SELECT pg_terminate_backend(${PID});`
2. Restart PgBouncer: `systemctl restart pgbouncer` or restart ECS task
3. Scale up RDS: `aws rds modify-db-instance --db-instance-identifier vibecoder-db --db-instance-class db.r6g.xlarge`
4. Emergency: Switch all traffic to primary (disable read replicas): Set `DB_READ_REPLICAS_ENABLED=false`

---

### 3.8 GitHub API Issues

**Symptoms:**
- `GitHubAPIRateLimitExceeded` alert
- New repos cannot be connected
- Analysis jobs stuck at "cloning" stage

**Investigation:**

```bash
# 1. Check current rate limit status
curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
  "https://api.github.com/rate_limit" | jq .rate

# 2. Check token pool health
redis-cli SMEMBERS github:tokens:available | wc -l
redis-cli SMEMBERS github:tokens:exhausted | wc -l

# 3. Check recent API errors
aws logs filter-log-events \
  --log-group-name "/aws/ecs/repo-service" \
  --filter-pattern "403 OR rate_limit OR secondary_rate" \
  --start-time $(date -u -d '1 hour ago' +%s000)

# 4. Check for stuck clone operations
psql -c "SELECT id, status, created_at FROM analysis_jobs WHERE status = 'cloning' AND created_at < now() - interval '30 minutes';"
```

**Common Causes & Fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Token rate limit hit | 403 from GitHub API | Rotate to next token in pool |
| Token revoked | 401 from GitHub API | Remove from pool, prompt user re-auth |
| Large repo clone slow | Jobs stuck at cloning | Increase clone timeout, use shallow clone |
| GitHub API outage | All GitHub calls failing | Queue jobs, retry when API recovers |

**Mitigation:**
1. Manually rotate tokens: `redis-cli SMOVE github:tokens:exhausted github:tokens:available ${TOKEN_HASH}`
2. Reduce analysis concurrency: Set `ANALYSIS_MAX_CONCURRENT=3`
3. Enable shallow clones: Set `GIT_SHALLOW_CLONE=true`

---

### 3.9 OpenAI Quota / Billing Issues

**Symptoms:**
- `OpenAIQuotaExceeded` alert
- All LLM generation failing
- "insufficient_quota" errors in logs

**Investigation:**

```bash
# 1. Check current usage in OpenAI dashboard
# Navigate to: https://platform.openai.com/usage

# 2. Check billing status
# Navigate to: https://platform.openai.com/settings/organization/billing

# 3. Check token consumption trends
aws cloudwatch get-metric-statistics \
  --namespace "VibeCoder/LLM" \
  --metric-name "TokensUsed" \
  --period 86400 \
  --statistics Sum \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# 4. Check which models are being used
grep -o '"model":"[^"]*"' /var/log/generation-service/*.log | sort | uniq -c
```

**Mitigation:**
1. **Immediate:** Switch to cheaper model: `LLM_MODEL=gpt-3.5-turbo-16k`
2. **Immediate:** Enable cost guardrails: Set `LLM_MAX_TOKENS_PER_REQUEST=2000`
3. **Short-term:** Add OpenAI credits or upgrade billing tier
4. **Long-term:** Evaluate alternative providers (Anthropic, Cohere, self-hosted)

---

### 3.10 Disk Space Issues

**Symptoms:**
- `DiskSpaceLow` alert (ECS instances or S3)
- Repo clone failures
- Artifact storage failures

**Investigation:**

```bash
# 1. Check disk usage on ECS instances
# (via SSM or SSH to bastion)
df -h /data

# 2. Check S3 bucket usage
aws s3 ls s3://vibecoder-repo-clones --recursive --summarize | tail -2

# 3. Find largest files
find /data/repos -type f -size +100M -exec ls -lh {} \; | sort -k5 -h

# 4. Check old clones
find /data/repos -type d -maxdepth 1 -mtime +1 -exec du -sh {} \;
```

**Mitigation:**
1. **Immediate:** Delete old repo clones: `find /data/repos -type d -maxdepth 1 -mtime +1 -exec rm -rf {} \;`
2. **Immediate:** Clean up failed analysis artifacts
3. **Short-term:** Implement S3 lifecycle policy (auto-delete after 7 days)
4. **Long-term:** Move repo clones to ephemeral S3 storage instead of local disk

---

### 3.11 Memory Issues

**Symptoms:**
- `MemoryUsageCritical` alert
- Container OOM kills
- Gradual performance degradation

**Investigation:**

```bash
# 1. Check ECS task memory usage
aws cloudwatch get-metric-statistics \
  --namespace "ECS/ContainerInsights" \
  --metric-name "MemoryUtilized" \
  --dimensions Name=ServiceName,Value=analysis-worker \
  --period 300 \
  --statistics Average Maximum \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# 2. Check for OOM kills
aws logs filter-log-events \
  --log-group-name "/aws/ecs/analysis-worker" \
  --filter-pattern "OutOfMemory" \
  --start-time $(date -u -d '24 hours ago' +%s000)

# 3. Profile memory usage (if accessible)
# Connect to container and run heapdump
```

**Common Causes:**
- Memory leak in worker processes
- Large repo AST in memory
- Unbounded caching
- Connection pool leak

**Mitigation:**
1. Restart affected service: `aws ecs update-service --cluster vibecoder --service ${SERVICE} --force-new-deployment`
2. Increase memory limit: Update task definition with higher `memory` value
3. If persistent → Enable memory profiling, identify leak source

---

### 3.12 Error Rate Spike

**Symptoms:**
- `ErrorRateSpike` alert
- 5xx errors in API logs
- User-reported errors

**Investigation:**

```bash
# 1. Check error rate by service
aws cloudwatch get-metric-statistics \
  --namespace "VibeCoder/API" \
  --metric-name "5xxErrorRate" \
  --period 300 \
  --statistics Average \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)

# 2. Check recent deployments
aws ecs describe-services --cluster vibecoder --services api-server \
  --query 'services[0].deployments'

# 3. Check error logs
aws logs filter-log-events \
  --log-group-name "/aws/ecs/api-server" \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '30 minutes ago' +%s000) \
  --max-results 20

# 4. Check if correlated with deployment
# Compare error rate spike time with deployment completion time
```

**Common Causes:**
- Bad deployment (introduced bug)
- External service outage
- Configuration change
- Traffic spike overwhelming capacity

**Mitigation:**
1. **If recent deployment:** Roll back immediately:
   ```bash
   aws ecs update-service --cluster vibecoder --service api-server \
     --task-definition vibecoder-api:PREVIOUS_REVISION
   ```
2. **If external service:** Enable circuit breaker, switch to degraded mode
3. **If traffic spike:** Scale up: `aws ecs update-service --cluster vibecoder --service api-server --desired-count [higher]`

---

### 3.13 Payment Processing Issues

**Symptoms:**
- `PaymentProcessingFailure` alert
- Users unable to upgrade
- Webhook delivery failures

**Investigation:**

```bash
# 1. Check Stripe webhook delivery
curl -s "https://api.stripe.com/v1/events?type=checkout.session.completed&limit=5" \
  -u "${STRIPE_SECRET_KEY}:"

# 2. Check webhook endpoint health
curl -s "http://api.internal:8000/api/v1/billing/health"

# 3. Check failed webhook events
curl -s "https://api.stripe.com/v1/events?delivery_status=failed&limit=10" \
  -u "${STRIPE_SECRET_KEY}:"

# 4. Verify Stripe status
curl -s "https://status.stripe.com/api/v2/summary.json"
```

**Mitigation:**
1. **Immediate:** Manually verify pending payments in Stripe dashboard
2. **Short-term:** Retry failed webhooks: `POST /api/v1/billing/webhooks/retry`
3. **Long-term:** Implement idempotent webhook handling, add dead letter queue

---

## 4. Deployment & Rollback Procedures

### 4.1 Standard Deployment

```bash
# 1. Deploy to staging
git push origin develop
# GitHub Actions runs CI → auto-deploys to staging

# 2. Verify staging
# Run smoke tests: curl -s https://staging.vibecoder.com/api/v1/health

# 3. Deploy to production (manual trigger)
# GitHub Actions: Actions → Deploy Production → Run workflow

# 4. Post-deploy verification
curl -s https://api.vibecoder.com/api/v1/health | jq .
# Verify: {"status":"healthy","version":"x.y.z","services":{...}}
```

### 4.2 Emergency Rollback

```bash
# 1. Identify last known good version
aws ecs describe-task-definition --task-definition vibecoder-api:PREVIOUS_REVISION

# 2. Rollback immediately
aws ecs update-service \
  --cluster vibecoder \
  --service api-server \
  --task-definition vibecoder-api:PREVIOUS_REVISION \
  --force-new-deployment

# 3. Verify rollback
aws ecs describe-services --cluster vibecoder --services api-server \
  --query 'services[0].deployments'

# 4. Communicate
# Post in #incident-active: "Emergency rollback completed to version X.Y.Z"
```

### 4.3 Database Migration Rollback

```bash
# ⚠️ DANGER: Only if migration is reversible

# 1. Check migration status
psql -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# 2. Rollback last migration
npx prisma migrate resolve --rolled-back ${MIGRATION_NAME}

# 3. If migration caused data loss → restore from backup
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier vibecoder-db \
  --target-db-instance-identifier vibecoder-db-restore \
  --restore-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
```

---

## 5. Monitoring & Alerting Configuration

### 5.1 Key Dashboards

| Dashboard | URL | Purpose |
|---|---|---|
| Service Health | Grafana → /d/service-health | Overview of all service metrics |
| API Performance | Grafana → /d/api-perf | Latency, throughput, error rates |
| Analysis Pipeline | Grafana → /d/analysis-pipeline | Job success rate, stage latency, queue depth |
| Database | Grafana → /d/database | Connections, query latency, replication lag |
| LLM Usage | Grafana → /d/llm-usage | Token consumption, cost, latency |
| WebSocket | Grafana → /d/websocket | Connections, message throughput, errors |
| Cost Tracker | Grafana → /d/costs | Daily/weekly cost breakdown by service |

### 5.2 Alert Rules Summary

| Alert | Condition | Severity | Channel |
|---|---|---|---|
| APIErrorRate > 1% | 5 min sustained | P1 | PagerDuty + Slack |
| APIErrorRate > 0.1% | 15 min sustained | P2 | Slack |
| APILatencyP95 > 2s | 5 min sustained | P2 | Slack |
| APILatencyP95 > 5s | 5 min sustained | P1 | PagerDuty |
| AnalysisFailureRate > 10% | 15 min | P2 | Slack |
| AnalysisFailureRate > 25% | 5 min | P1 | PagerDuty |
| DBConnectionPool > 80% | 5 min | P1 | PagerDuty |
| DBReplicationLag > 30s | 5 min | P2 | Slack |
| DiskSpace < 20% | 1 hour | P2 | Slack |
| DiskSpace < 10% | 15 min | P1 | PagerDuty |
| MemoryUtilization > 85% | 10 min | P2 | Slack |
| OpenAIQuota > 90% | Daily check | P2 | Slack |
| OpenAIErrorRate > 5% | 5 min | P1 | PagerDuty |
| GitHubRateLimit > 80% | 15 min | P3 | Slack |
| CostDaily > $300 | Daily check | P2 | Email + Slack |

---

## 6. Post-Incident Procedures

### 6.1 Post-Mortem Template

```markdown
# Incident Post-Mortem: [INCIDENT TITLE]

**Date:** YYYY-MM-DD
**Duration:** X hours Y minutes
**Severity:** P1 / P2 / P3
**Author:** [Name]
**Status:** Draft / Published

## Summary
One-paragraph description of what happened and its impact.

## Impact
- **Users affected:** [number or percentage]
- **Revenue impact:** $[amount] (if applicable)
- **Data impact:** [any data loss/corruption]
- **SLA impact:** [breach of which SLA]

## Timeline (UTC)
| Time | Event |
|---|---|
| HH:MM | Alert fired in PagerDuty |
| HH:MM | On-call acknowledged, investigation started |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Incident resolved |

## Root Cause
Detailed explanation of what caused the incident.

## Detection
How was the incident detected? Was it automated or user-reported?

## Mitigation
What steps were taken to restore service?

## Resolution
What permanently fixed the issue?

## What Went Well
- [List things that worked]

## What Didn't Go Well
- [List things that need improvement]

## Action Items
| Action | Owner | Priority | Due Date | Status |
|---|---|---|---|---|
| [Action item] | [Name] | P1/P2/P3 | YYYY-MM-DD | Open |

## Lessons Learned
Key takeaways for the team.
```

### 6.2 Action Item Tracking

- All action items from post-mortems tracked in GitHub Issues
- Labeled: `incident-action`, `P1`/`P2`/`P3`
- Assigned to owner with due date
- Reviewed in weekly engineering standup
- Completion rate tracked monthly

---

## 7. Runbook Maintenance

| Task | Frequency | Owner |
|---|---|---|
| Review and update runbook procedures | Monthly | On-Call Lead |
| Update alert thresholds based on SLA changes | Quarterly | SRE Team |
| Runbook review after each incident | After every P1/P2 | Incident Author |
| Add new runbook entries for new services/features | Per feature launch | Feature Team |
| Test runbook procedures (game day) | Quarterly | SRE Team |
| Update escalation contacts | Monthly | Engineering Manager |

---

*This runbook is a living document. After any incident, review and update the relevant sections to prevent future occurrences.*
