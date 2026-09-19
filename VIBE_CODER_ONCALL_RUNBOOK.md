# Vibe Coder On-Call Runbook

## Incident Response, Troubleshooting & Operational Procedures

---

## 1. On-Call Rotation

### 1.1 Rotation Schedule

| Role | Schedule | Responsibilities |
|---|---|---|
| **Primary On-Call** | Monday 9 AM → Monday 9 AM (weekly) | First responder, triage, mitigate, communicate |
| **Secondary On-Call** | Same as primary | Backup if primary is unreachable, assist on P1/P2 |
| **Engineering Manager** | Escalation point | External comms, resource allocation, go/no-go on rollback |

**Rotation order:** The on-call schedule is maintained in PagerDuty. Shifts rotate every Monday at 9:00 AM UTC.

### 1.2 On-Call Expectations

- Respond to pages within **5 minutes** during business hours, **15 minutes** off-hours
- Acknowledge PagerDuty alerts within **2 minutes**
- Provide initial assessment within **15 minutes** of page
- Update status page within **30 minutes** for user-impacting incidents
- Complete incident within **2 hours** for P1, **4 hours** for P2

### 1.3 Contact Directory

| Role | Name | Phone | Slack | PagerDuty |
|---|---|---|---|---|
| Primary On-Call | (rotating) | — | #oncall | @oncall-primary |
| Secondary On-Call | (rotating) | — | #oncall | @oncall-secondary |
| Engineering Manager | (assigned) | (phone) | @eng-manager | @eng-manager |
| Infra Lead | (assigned) | (phone) | @infra-lead | — |
| DBA | (assigned) | (phone) | @dba | — |

### 1.4 Communication Channels

| Channel | Purpose |
|---|---|
| `#incidents` | Active incident coordination |
| `#oncall` | On-call handoffs, questions, non-urgent alerts |
| `#deployments` | Deployment notifications and rollbacks |
| `#status-page` | Updates for external status page |
| **PagerDuty** | P1/P2 alerting |
| **Email** | Stakeholder updates for P1 incidents |

---

## 2. Severity Levels

### 2.1 Classification Matrix

| Severity | Definition | Response Time | Update Cadence | Resolution Target |
|---|---|---|---|---|
| **P1 — Critical** | Complete service outage, data loss risk, security breach | 5 min | Every 30 min | 2 hours |
| **P2 — High** | Major feature degraded, significant user impact | 15 min | Every 1 hour | 4 hours |
| **P3 — Medium** | Minor feature degraded, workaround available | 30 min | Every 4 hours | 24 hours |
| **P4 — Low** | Cosmetic issue, no user impact, internal tooling | Next business day | Daily | 1 week |

### 2.2 Impact Assessment Criteria

**User Impact:**
- How many users are affected? (All / Many / Few / None)
- Can users complete core workflows? (No / Partially / Yes)
- Is data at risk? (Yes / No)
- Is revenue affected? (Yes / No)

**Service Impact:**
- Which services are affected?
- Is the issue intermittent or persistent?
- Is it a degradation or complete failure?
- Are downstream services also affected?

---

## 3. Incident Response Playbook

### 3.1 Standard Response Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    INCIDENT RESPONSE FLOW                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. DETECT                                                   │
│     ├─ Alert fires (PagerDuty / CloudWatch)                 │
│     ├─ User reports (support ticket / Slack)                │
│     └─ Monitoring dashboard anomaly                          │
│                                                              │
│  2. TRIAGE (within 5 minutes)                               │
│     ├─ Acknowledge alert                                    │
│     ├─ Assess severity (P1/P2/P3/P4)                       │
│     ├─ Create incident channel (#incidents-YYYY-MM-DD-slug) │
│     └─ Post initial assessment in channel                   │
│                                                              │
│  3. MITIGATE (within 15 minutes)                            │
│     ├─ Identify root cause (or narrow scope)                │
│     ├─ Apply immediate fix or workaround                    │
│     ├─ If no quick fix → rollback last deployment           │
│     └─ Verify mitigation is working                         │
│                                                              │
│  4. COMMUNICATE                                             │
│     ├─ Update status page (P1/P2 only)                      │
│     ├─ Notify stakeholders (P1 only)                        │
│     └─ Post in #incidents channel                           │
│                                                              │
│  5. RESOLVE                                                  │
│     ├─ Confirm service is fully restored                     │
│     ├─ Close incident channel (keep for post-mortem)        │
│     └─ Update status page to "All Systems Operational"      │
│                                                              │
│  6. POST-MORTEM (within 48 hours)                           │
│     ├─ Write incident report                                │
│     ├─ Identify root cause and contributing factors          │
│     ├─ Define action items to prevent recurrence             │
│     └─ Schedule review meeting                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Incident Channel Template

```
/incident create "Vibe Coder — [Brief Description]"

Channel topic: [P1/P2] — [Service] — [Symptom] — Status: [Investigating/Mitigating/Resolved]

Initial post:
🚨 **Incident Report**
- **Severity:** P1/P2/P3
- **Status:** Investigating
- **Started:** YYYY-MM-DD HH:MM UTC
- **Impact:** [Description of user impact]
- **Affected services:** [List]
- **On-call:** @yourname
- **Status page:** [link]

Updates will be posted every [30min/1hr].
```

### 3.3 Status Page Updates

**Investigating:**
```
We are investigating reports of [symptom]. Some users may experience [impact]. 
We will provide an update in [30 minutes].
```

**Identified:**
```
We have identified the issue as [root cause]. [Service] is currently [status]. 
We are working on a fix and will provide an update in [30 minutes].
```

**Monitoring:**
```
A fix has been deployed and we are monitoring the system. 
[Service] appears to be recovering. We will confirm resolution shortly.
```

**Resolved:**
```
The issue has been resolved. [Service] is now operating normally. 
We apologize for the inconvenience and will publish a post-mortem within 48 hours.
```

---

## 4. Common Incidents & Runbooks

### 4.1 API Service — High Error Rate (5xx)

**Symptoms:**
- CloudWatch alarm: `VibeCoder-HighErrorRate` fires
- Users report "Something went wrong" errors
- p99 latency spikes above 5 seconds

**Diagnosis:**

```bash
# 1. Check ECS service health
aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}'

# 2. Check recent task failures
aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api \
  --query 'services[0].events[:10].{time:createdAt,message:message}'

# 3. Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/vibecoder-prod-api-tg/ID \
  --query 'TargetHealthDescriptions[].{state:TargetHealth.State,reason:TargetHealth.Reason}'

# 4. Check API logs for errors
aws logs tail /ecs/vibecoder-production --since 15m --filter-pattern "ERROR" --format short

# 5. Check database connectivity
psql "$DATABASE_URL" -c "SELECT 1;" 2>&1

# 6. Check Redis connectivity
redis-cli -u "$REDIS_URL" PING 2>&1
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Database connection pool exhaustion | `timeout acquiring connection`, `ECONNREFUSED` | Restart API tasks, increase pool size, check for connection leaks |
| Memory pressure | OOM kills in ECS events | Increase task memory, check for memory leaks |
| Downstream service timeout | `ETIMEDOUT`, `ECONNRESET` | Check dependency health, implement circuit breaker |
| Bad deployment | Errors correlate with deploy time | Rollback to previous task definition |
| GitHub API rate limit | `403 rate limit exceeded`, GitHub-related endpoints failing | Wait for rate limit reset, switch to cached data |

**Immediate mitigation:**
```bash
# Rollback to previous task definition
PREV_TASK_DEF=$(aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api \
  --query 'services[0].taskDefinition' \
  --output text | sed 's/:.*//')

aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-api \
  --task-definition $PREV_TASK_DEF

# Wait for rollback
aws ecs wait services-stable \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api
```

---

### 4.2 Database — Connection Failures

**Symptoms:**
- API returning 503 errors
- `ECONNREFUSED` or `connection timeout` in logs
- Application logs show `Prisma error: Can't reach database server`

**Diagnosis:**

```bash
# 1. Check RDS instance status
aws rds describe-db-instances \
  --db-instance-identifier vibecoder-production-postgres-0 \
  --query 'DBInstances[0].{status:DBInstanceStatus,cpu:ProcessorFeatures,endpoints:Endpoint}'

# 2. Check CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=vibecoder-production-postgres-0 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average

# 3. Check connection count
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=vibecoder-production-postgres-0 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Maximum

# 4. Check for long-running queries
psql "$DATABASE_URL" -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC
  LIMIT 10;
"

# 5. Check for locks
psql "$DATABASE_URL" -c "
  SELECT blocked.pid AS blocked_pid,
         blocked.query AS blocked_query,
         blocking.pid AS blocking_pid,
         blocking.query AS blocking_query
  FROM pg_stat_activity AS blocked
  JOIN pg_locks AS bl ON bl.pid = blocked.pid
  JOIN pg_locks AS kl ON kl.locktype = bl.locktype
    AND kl.relation = bl.relation
    AND kl.pid != bl.pid
  JOIN pg_stat_activity AS blocking ON blocking.pid = kl.pid
  WHERE NOT bl.granted;
"
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Connection pool exhaustion | All connections in use, new connections timeout | Kill idle connections, increase `max_connections`, check for leaked connections |
| Long-running query | High CPU, connections blocked | Kill the offending query (`SELECT pg_terminate_backend(pid)`), add missing index |
| RDS failover | Brief connectivity loss during Multi-AZ failover | Wait 30s for automatic recovery, verify application reconnects |
| Security group misconfiguration | `ECONNREFUSED` from new service | Verify ECS security group has access to RDS port 5432 |

**Immediate mitigation:**
```bash
# Kill long-running queries (> 5 minutes)
psql "$DATABASE_URL" -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state != 'idle'
    AND query_start < now() - interval '5 minutes'
    AND pid != pg_backend_pid();
"

# Restart API services to reset connection pools
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-api \
  --force-new-deployment
```

---

### 4.3 Redis — Memory or Connection Issues

**Symptoms:**
- `OOM command not allowed` errors in application logs
- Session/refresh token operations failing
- WebSocket connections dropping

**Diagnosis:**

```bash
# 1. Check Redis memory usage
redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human

# 2. Check connected clients
redis-cli -u "$REDIS_URL" INFO clients | grep connected_clients

# 3. Check for slow commands
redis-cli -u "$REDIS_URL" SLOWLOG GET 10

# 4. Check eviction policy
redis-cli -u "$REDIS_URL" CONFIG GET maxmemory-policy

# 5. Check ElastiCache metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ElastiCache \
  --metric-name DatabaseMemoryUsagePercentage \
  --dimensions Name=CacheClusterId,Value=vibecoder-production-redis-001 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average Maximum
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Memory exhaustion | `OOM` errors, evictions increasing | Flush expired keys, increase `maxmemory`, scale to larger node type |
| Too many connections | `max clients reached` | Increase `maxclients`, check for connection leaks in application |
| Slow commands | High latency, CPU spikes | Identify slow commands via SLOWLOG, optimize or remove |
| Network partition | Intermittent connection failures | Check VPC peering, security groups, NAT gateway |

**Immediate mitigation:**
```bash
# Flush expired keys (safe operation)
redis-cli -u "$REDIS_URL" --scan --pattern "session:*" --count 100 | xargs -L 1 redis-cli -u "$REDIS_URL" DEL

# Check and flush stale refresh tokens
redis-cli -u "$REDIS_URL" --scan --pattern "refresh:*" --count 100 | head -20
```

---

### 4.4 Analysis Pipeline — Job Failures

**Symptoms:**
- Analysis jobs stuck in `cloning`, `parsing`, or `indexing` status
- Users report "Analysis failed" notifications
- Worker pool queue depth increasing

**Diagnosis:**

```bash
# 1. Check worker pool status
aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-worker \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}'

# 2. Check recent failed jobs
psql "$DATABASE_URL" -c "
  SELECT id, repo_id, status, error_message, created_at
  FROM analysis_jobs
  WHERE status = 'failed'
    AND created_at > now() - interval '1 hour'
  ORDER BY created_at DESC
  LIMIT 10;
"

# 3. Check jobs stuck in progress
psql "$DATABASE_URL" -c "
  SELECT id, repo_id, status, started_at,
         now() - started_at AS elapsed
  FROM analysis_jobs
  WHERE status IN ('cloning', 'parsing', 'indexing', 'generating')
    AND started_at < now() - interval '30 minutes'
  ORDER BY started_at;
"

# 4. Check BullMQ queues (via Redis)
redis-cli -u "$REDIS_URL" LLEN "bull:analysis:waiting"
redis-cli -u "$REDIS_URL" LLEN "bull:analysis:active"
redis-cli -u "$REDIS_URL" LLEN "bull:analysis:failed"

# 5. Check worker logs
aws logs tail /ecs/vibecoder-production --since 30m --filter-pattern "worker" --format short | tail -50
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| GitHub clone failure | Jobs stuck in `cloning` | Check GitHub token validity, verify repo access, check GitHub API status |
| AST parser crash | Jobs stuck in `parsing` | Restart parser service, check for unsupported file types |
| Embedding API rate limit | Jobs stuck in `indexing` | Check OpenAI rate limits, implement backoff, reduce parallelism |
| LLM API timeout | Jobs stuck in `generating` | Check OpenAI status, increase timeout, switch to fallback model |
| Queue backlog | `waiting` count high | Scale up worker replicas, check for stuck jobs |

**Immediate mitigation:**
```bash
# Reset stuck jobs (older than 30 minutes)
psql "$DATABASE_URL" -c "
  UPDATE analysis_jobs
  SET status = 'queued', worker_id = NULL, started_at = NULL
  WHERE status IN ('cloning', 'parsing', 'indexing', 'generating')
    AND started_at < now() - interval '30 minutes';
"

# Scale up workers
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-worker \
  --desired-count 10

# Clear failed job queue
redis-cli -u "$REDIS_URL" DEL "bull:analysis:failed"
```

---

### 4.5 WebSocket — Connection Drops

**Symptoms:**
- Users report chat sessions disconnecting
- Mock interview sessions losing connection
- WebSocket connection count dropping in CloudWatch

**Diagnosis:**

```bash
# 1. Check WebSocket service health
aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-websocket \
  --query 'services[0].{status:status,runningCount:runningCount}'

# 2. Check ALB target health for WebSocket
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/vibecoder-prod-ws-tg/ID \
  --query 'TargetHealthDescriptions[].{state:TargetHealth.State}'

# 3. Check active WebSocket connections
curl -s https://api.vibecoder.com/health | jq '.websocketConnections'

# 4. Check Redis pub/sub health (for multi-server WebSocket)
redis-cli -u "$REDIS_URL" PUBSUB NUMSUB chat:notifications

# 5. Check for SSL/TLS issues
openssl s_client -connect api.vibecoder.com:443 -brief 2>&1 | head -5
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| ALB idle timeout | Connections drop after 60s of inactivity | Increase ALB idle timeout to 4000s, implement ping/pong |
| Server restart | All connections drop simultaneously | Verify rolling deployment, check task health |
| Redis pub/sub failure | Multi-server messages not delivered | Check Redis connectivity, verify adapter config |
| Memory pressure | Connections dropped under load | Increase task memory, scale WebSocket replicas |

**Immediate mitigation:**
```bash
# Force redeployment with rolling update
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-websocket \
  --force-new-deployment \
  --deployment-configuration "minimumHealthyPercent=50,maxPercent=200"

# Check and increase ALB idle timeout
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:loadbalancer/app/vibecoder-prod/ID \
  --attributes Key=idle_timeout.timeout_seconds,Value=4000
```

---

### 4.6 Retrieval Engine — Quality Degradation

**Symptoms:**
- Evaluation benchmark scores dropping
- Users report "answers seem off" or "citations are wrong"
- Retrieval precision@3 dropping below 0.85

**Diagnosis:**

```bash
# 1. Run spot-check evaluation
python eval/run_benchmark.py \
  --benchmark eval/benchmarks/ret_bench_v1.json \
  --config eval/configs/quick.yaml \
  --output eval/results/spot-check/

# 2. Check Pinecone index stats
curl -s "https://controller.${PINECONE_ENV}.pinecone.io/databases/${PINCEONE_INDEX}/stats" \
  -H "Api-Key: ${PINECONE_API_KEY}" | jq '.dimension, .totalVectorCount'

# 3. Check OpenSearch index health
curl -s "https://${OPENSEARCH_ENDPOINT}/_cluster/health" | jq '.status, .number_of_nodes'

# 4. Check embedding model availability
curl -s "https://api.openai.com/v1/models" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" | jq '.data[] | select(.id | contains("embedding"))'

# 5. Check recent retrieval latency
aws cloudwatch get-metric-statistics \
  --namespace VibeCoder \
  --metric-name RetrievalLatency \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics p50 p95 p99
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Embedding model changed | Sudden quality drop across all queries | Verify embedding model version, re-embed if needed |
| Index corruption | Specific queries failing | Rebuild affected index segments |
| RRF parameter drift | Ranking quality degraded | Check RRF k-value, revert to last known-good config |
| New code not indexed | Recent changes not reflected | Trigger re-analysis of affected repositories |

**Immediate mitigation:**
```bash
# Re-run evaluation with previous config
python eval/run_benchmark.py \
  --benchmark eval/benchmarks/ret_bench_v1.json \
  --config eval/configs/previous.yaml \
  --output eval/results/comparison/

# If comparison shows regression, roll back retrieval config
git checkout HEAD~1 -- packages/retrieval/config/
pnpm run build --filter=@vibe-coder/retrieval
# Deploy updated retrieval service
```

---

### 4.7 Cost Anomaly — Unexpected API Spend

**Symptoms:**
- Daily OpenAI API cost exceeds $300 alert fires
- Token consumption rate higher than expected
- LLM costs growing faster than user growth

**Diagnosis:**

```bash
# 1. Check OpenAI usage dashboard
# Visit: https://platform.openai.com/usage

# 2. Check token consumption by service
psql "$DATABASE_URL" -c "
  SELECT
    DATE(created_at) as day,
    model_used,
    SUM(tokens_used) as total_tokens,
    COUNT(*) as message_count
  FROM chat_messages
  WHERE created_at > now() - interval '7 days'
    AND role = 'assistant'
  GROUP BY DATE(created_at), model_used
  ORDER BY day DESC, total_tokens DESC;
"

# 3. Check for excessive retrieval chunking
psql "$DATABASE_URL" -c "
  SELECT
    repo_id,
    COUNT(*) as chunk_count,
    AVG(token_count) as avg_tokens_per_chunk,
    SUM(token_count) as total_tokens
  FROM code_chunks
  GROUP BY repo_id
  ORDER BY total_tokens DESC
  LIMIT 10;
"

# 4. Check for retry storms
aws logs tail /ecs/vibecoder-production --since 1h \
  --filter-pattern "retry" --format short | wc -l

# 5. Check worker queue depth
redis-cli -u "$REDIS_URL" LLEN "bull:analysis:waiting"
```

**Common causes and fixes:**

| Cause | Symptoms | Fix |
|---|---|---|
| Retry storm | Exponential token growth | Check retry configuration, implement circuit breaker |
| Chunks too large | High tokens per query | Reduce chunk size, implement token budget |
| Wrong model used | Using GPT-4 for classification | Check model routing, use GPT-4o-mini for simple tasks |
| Cache misses | Re-embedding same queries | Check embedding cache hit rate, increase TTL |

**Immediate mitigation:**
```bash
# Temporarily reduce analysis parallelism
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-worker \
  --desired-count 2

# Switch to cheaper model for non-critical paths
# Update environment variable:
aws ssm put-parameter \
  --name /vibecoder/production/LLM_MODEL_ROUTING \
  --value '{"classification":"gpt-4o-mini","chat":"gpt-4o","analysis":"gpt-4o"}' \
  --type String \
  --overwrite
```

---

### 4.8 Security — Suspicious Activity

**Symptoms:**
- Unusual login patterns (many failed attempts)
- API key leaked in public repository
- Unauthorized access to user data
- Unexpected GitHub API usage

**Diagnosis:**

```bash
# 1. Check for failed login attempts
psql "$DATABASE_URL" -c "
  SELECT ip_address, COUNT(*) as attempts,
         MAX(created_at) as last_attempt
  FROM usage_events
  WHERE event_type = 'login_failed'
    AND created_at > now() - interval '1 hour'
  GROUP BY ip_address
  HAVING COUNT(*) > 5
  ORDER BY attempts DESC;
"

# 2. Check for suspicious API usage
psql "$DATABASE_URL" -c "
  SELECT user_id, COUNT(*) as request_count,
         COUNT(DISTINCT ip_address) as unique_ips
  FROM usage_events
  WHERE created_at > now() - interval '1 hour'
  GROUP BY user_id
  HAVING COUNT(*) > 100
  ORDER BY request_count DESC;
"

# 3. Check for token reuse across IPs
psql "$DATABASE_URL" -c "
  SELECT DISTINCT
    cm.session_id,
    cs.user_id,
    ue.ip_address,
    cm.created_at
  FROM chat_messages cm
  JOIN chat_sessions cs ON cs.id = cm.session_id
  JOIN usage_events ue ON ue.user_id = cs.user_id
  WHERE cm.created_at > now() - interval '1 hour'
    AND ue.event_type = 'chat_message'
  ORDER BY cm.created_at DESC
  LIMIT 20;
"

# 4. Check GitHub token scope
curl -s -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user | jq '.plan, .permissions'
```

**Immediate response:**

```bash
# If API key leaked:
# 1. Revoke the compromised key immediately
# 2. Rotate to new key
# 3. Update Secrets Manager
aws secretsmanager update-secret \
  --secret-id vibecoder/production/openai \
  --secret-string '{"openai_api_key": "NEW_KEY_HERE"}'

# If suspicious user activity:
# 1. Disable the user account
psql "$DATABASE_URL" -c "UPDATE users SET plan_tier = 'disabled' WHERE id = 'SUSPICIOUS_USER_ID';"

# 2. Invalidate all their sessions
psql "$DATABASE_URL" -c "DELETE FROM chat_sessions WHERE user_id = 'SUSPICIOUS_USER_ID';"

# 3. Block the IP at ALB level
aws wafv2 update-web-acl \
  --name vibecoder-production-waf \
  --scope REGIONAL \
  --default-action Allow={} \
  --rules '[{
    "Name": "BlockSuspiciousIP",
    "Priority": 1,
    "Action": {"Block": {}},
    "Statement": {"IPSetReferenceStatement": {"ARN": "arn:aws:wafv2:..."}},
    "VisibilityConfig": {"SampledRequestsEnabled": true}
  }]'
```

---

## 5. Deployment Procedures

### 5.1 Standard Deployment

```bash
# 1. Verify CI passes
gh run list --branch main --limit 5

# 2. Pull latest
git pull origin main

# 3. Run local tests
pnpm test

# 4. Build Docker images
docker build -t vibecoder/api:latest -f apps/api/Dockerfile .
docker build -t vibecoder/websocket:latest -f apps/websocket/Dockerfile .
docker build -t vibecoder/worker:latest -f apps/worker/Dockerfile .

# 5. Push to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/vibecoder/api:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/vibecoder/websocket:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/vibecoder/worker:latest

# 6. Run database migrations
docker run --rm \
  -e DATABASE_URL=$DATABASE_URL \
  ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/vibecoder/worker:latest \
  npx prisma migrate deploy

# 7. Update services (rolling deployment)
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-api \
  --force-new-deployment

aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-websocket \
  --force-new-deployment

aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-worker \
  --force-new-deployment

# 8. Wait for stability
aws ecs wait services-stable \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api vibecoder-production-websocket vibecoder-production-worker

# 9. Verify health
curl -sf https://api.vibecoder.com/health | jq .

# 10. Run smoke tests
pnpm run test:smoke
```

### 5.2 Emergency Rollback

```bash
# 1. Identify current and previous task definitions
CURRENT=$(aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api \
  --query 'services[0].taskDefinition' --output text)

PREV=$(aws ecs list-task-definitions \
  --family-prefix vibecoder-production-api \
  --sort DESC \
  --query 'taskDefinitionArns[1]' --output text)

echo "Rolling back: $CURRENT → $PREV"

# 2. Rollback API
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-api \
  --task-definition $PREV

# 3. Rollback WebSocket
PREV_WS=$(aws ecs list-task-definitions \
  --family-prefix vibecoder-production-websocket \
  --sort DESC \
  --query 'taskDefinitionArns[1]' --output text)

aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-websocket \
  --task-definition $PREV_WS

# 4. Rollback Workers
PREV_WORKER=$(aws ecs list-task-definitions \
  --family-prefix vibecoder-production-worker \
  --sort DESC \
  --query 'taskDefinitionArns[1]' --output text)

aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-worker \
  --task-definition $PREV_WORKER

# 5. Wait for rollback to complete
aws ecs wait services-stable \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api vibecoder-production-websocket vibecoder-production-worker

# 6. Verify rollback
curl -sf https://api.vibecoder.com/health | jq .
```

### 5.3 Database Rollback

```bash
# ⚠️ DANGER: Only use for schema migrations that caused data issues

# 1. Identify the problematic migration
psql "$DATABASE_URL" -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# 2. If safe to revert (no data loss):
pnpm prisma migrate dev --create-only --name revert-descriptive-name

# 3. If migration corrupted data, restore from snapshot:
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier vibecoder-production-postgres \
  --query 'DBClusterSnapshots[:5].{id:DBClusterSnapshotIdentifier,created:SnapshotCreateTime}'

aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier vibecoder-production-postgres-rollback \
  --snapshot-identifier <SNAPSHOT_ID>

# 4. Update application to point to rollback cluster
# 5. Verify data integrity
# 6. Swap DNS to rollback cluster
```

---

## 6. Scheduled Maintenance

### 6.1 Weekly Tasks

| Task | Command | Owner |
|---|---|---|
| Review error rates | Check CloudWatch dashboard | On-call |
| Check disk usage | `aws rds describe-db-instances --query '...storageAllocated'` | On-call |
| Review slow queries | `pg_stat_statements` top 10 | On-call |
| Clean up old S3 objects | Verify lifecycle policies working | On-call |
| Review cost anomalies | Check OpenAI + AWS billing | Engineering |

### 6.2 Monthly Tasks

| Task | Command | Owner |
|---|---|---|
| Rotate GitHub tokens | Revoke and re-issue | Security |
| Review security group rules | `aws ec2 describe-security-groups` | Infra |
| Update dependencies | `pnpm update` + test | Engineering |
| Run full benchmark suite | `python eval/run_benchmark.py --config full.yaml` | ML team |
| Review capacity planning | Check auto-scaling metrics | Infra |

### 6.3 Quarterly Tasks

| Task | Command | Owner |
|---|---|---|
| Chaos engineering test | Simulate service failures | SRE |
| Disaster recovery drill | Restore from backup | Infra |
| Security audit | Penetration testing | Security |
| Cost optimization review | Right-size instances | Infra |

---

## 7. Monitoring Quick Reference

### 7.1 Key Dashboards

| Dashboard | URL | Purpose |
|---|---|---|
| Production Overview | CloudWatch → VibeCoder-Production | High-level health |
| API Metrics | CloudWatch → VibeCoder-API | Request rate, latency, errors |
| Database | CloudWatch → VibeCoder-RDS | Connections, CPU, storage |
| Retrieval Quality | Grafana → VibeCoder-Quality | Precision, faithfulness, latency |
| Cost | AWS Billing → VibeCoder | API spend, infrastructure cost |

### 7.2 Alert Thresholds

| Alert | Threshold | Action |
|---|---|---|
| API 5xx rate > 0.5% | 5 min window | P1 — investigate immediately |
| p99 latency > 5s | 5 min window | P2 — check downstream services |
| DB connections > 160 | 5 min window | P2 — check for connection leaks |
| Redis memory > 80% | 15 min window | P3 — flush stale data |
| Analysis failure rate > 5% | 1 hour window | P2 — check worker health |
| Daily API cost > $300 | Daily | P2 — investigate token consumption |
| Hallucination rate > 0 | Any occurrence | P1 — halt deployment, investigate |
| Retrieval precision@3 < 0.75 | Weekly benchmark | P1 — regression, investigate |

### 7.3 Useful One-Liners

```bash
# Quick health check
curl -sf https://api.vibecoder.com/health | jq '{api: .api, db: .database, redis: .redis}'

# Count active chat sessions
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM chat_sessions WHERE updated_at > now() - interval '5 minutes';"

# Count active mock interviews
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM mock_interview_sessions WHERE status = 'active';"

# Top 10 repositories by analysis count
psql "$DATABASE_URL" -c "SELECT full_name, analysis_count FROM repositories ORDER BY analysis_count DESC LIMIT 10;"

# Worker queue depth
redis-cli -u "$REDIS_URL" LLEN "bull:analysis:waiting"

# Recent errors
aws logs tail /ecs/vibecoder-production --since 15m --filter-pattern "ERROR" --format short | tail -20

# ECS service status
aws ecs describe-services --cluster vibecoder-production-cluster \
  --services vibecoder-production-api vibecoder-production-websocket vibecoder-production-worker \
  --query 'services[].{name:serviceName,status:status,desired:desiredCount,running:runningCount}'

# Disk usage on RDS
aws cloudwatch get-metric-statistics --namespace AWS/RDS \
  --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=vibecoder-production-postgres-0 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 --statistics Average \
  --query 'Datapoints[0].Average' --output text | awk '{print $1/1024/1024/1024 " GB free"}'
```

---

## 8. Post-Mortem Template

```markdown
# Incident Post-Mortem

## Summary
- **Date:** YYYY-MM-DD
- **Duration:** X hours Y minutes
- **Severity:** P1/P2/P3
- **Impact:** [Description of user impact]
- **Root Cause:** [Brief description]

## Timeline (UTC)
| Time | Event |
|---|---|
| HH:MM | Alert fired / Issue detected |
| HH:MM | On-call acknowledged |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Incident closed |

## What went well
- [List things that worked well during the response]

## What went wrong
- [List things that didn't work well]

## Root Cause Analysis
[Detailed description of what caused the incident]

## Contributing Factors
- [List any contributing factors]

## Action Items
| Priority | Action | Owner | Due Date | Status |
|---|---|---|---|---|
| P0 | [Immediate fix] | [Name] | [Date] | [Status] |
| P1 | [Prevent recurrence] | [Name] | [Date] | [Status] |
| P2 | [Improve detection] | [Name] | [Date] | [Status] |

## Lessons Learned
- [Key takeaways from this incident]

## Detection Gap
- How was it detected? (Alert / User report / Manual)
- How long before detection? (TTD)
- How long from detection to mitigation? (TTM)
- Could it have been detected earlier? How?
```

---

*This runbook is a living document. Update it after every incident and during quarterly reviews. The goal is to make every on-call shift predictable and every incident response faster than the last.*
