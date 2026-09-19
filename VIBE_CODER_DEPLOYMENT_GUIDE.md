# Vibe Coder Deployment Guide

## Docker Containerization & AWS Infrastructure

---

## 1. Prerequisites

### 1.1 Required Accounts & Tools

| Tool / Account | Version | Purpose |
|---|---|---|
| Docker Desktop | 4.24+ | Container builds |
| AWS CLI | 2.x | Infrastructure management |
| Terraform | 1.6+ | Infrastructure as code |
| Node.js | 20.x LTS | Local builds |
| Python | 3.11+ | Local builds |
| Rust + Cargo | 1.73+ | AST parser service |
| pnpm | 8.x | Package management |
| GitHub account | — | CI/CD source |
| AWS account | — | Deployment target |
| Stripe account | — | Billing |
| OpenAI account | — | LLM API access |
| Pinecone account | — | Vector database |

### 1.2 AWS IAM Setup

Create a deployment user with the following policies:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:*",
        "ec2:*",
        "elasticloadbalancing:*",
        "rds:*",
        "elasticache:*",
        "opensearch:*",
        "s3:*",
        "cloudfront:*",
        "logs:*",
        "cloudwatch:*",
        "secretsmanager:*",
        "ssm:*",
        "ecr:*",
        "iam:PassRole",
        "route53:*",
        "acm:*",
        "wafv2:*",
        "shield:*"
      ],
      "Resource": "*"
    }
  ]
}
```

```bash
# Configure AWS CLI
aws configure --profile vibecoder-deploy
# Enter: Access Key, Secret Key, Region (us-east-1), Output format (json)
```

---

## 2. Project Structure

```
vibe-coder/
├── apps/
│   ├── web/                          # Next.js frontend
│   │   ├── Dockerfile
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   └── src/
│   ├── api/                          # REST API server
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   ├── websocket/                    # WebSocket server
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   ├── worker/                       # Analysis worker pool
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   └── mock-interview/               # Mock interview engine
│       ├── Dockerfile
│       ├── Dockerfile                # Python-based
│       ├── requirements.txt
│       └── src/
├── packages/
│   ├── ast-parser/                   # Rust AST parser service
│   │   ├── Dockerfile
│   │   ├── Cargo.toml
│   │   └── src/
│   ├── retrieval/                    # Python retrieval engine
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── src/
│   ├── shared/                       # Shared TypeScript types
│   │   └── src/
│   └── database/                     # Prisma schema & migrations
│       ├── prisma/
│       │   └── schema.prisma
│       └── migrations/
├── infra/
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── modules/
│   │   │   ├── vpc/
│   │   │   ├── ecs/
│   │   │   ├── rds/
│   │   │   ├── elasticache/
│   │   │   ├── opensearch/
│   │   │   ├── s3/
│   │   │   └── alb/
│   │   └── environments/
│   │       ├── staging/
│   │       └── production/
│   └── scripts/
│       ├── setup.sh
│       ├── migrate.sh
│       └── seed.sh
├── docker/
│   ├── docker-compose.yml            # Local development
│   ├── docker-compose.prod.yml       # Production-like local
│   └── nginx/
│       └── nginx.conf
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-staging.yml
│       └── deploy-production.yml
├── Makefile
└── README.md
```

---

## 3. Docker Configuration

### 3.1 Base Image — Node.js Services

```dockerfile
# docker/Dockerfile.node-base
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat git
WORKDIR /app
RUN npm install -g pnpm@8

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/websocket/package.json ./apps/websocket/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile

# --- Builder ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/pnpm-lock.yaml ./
COPY apps ./apps
RUN pnpm run build --filter=@vibe-coder/$SERVICE_NAME

# --- Runner ---
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder /app/apps/$SERVICE_NAME/dist ./dist
COPY --from=builder /app/apps/$SERVICE_NAME/package.json ./
COPY --from=deps /app/apps/$SERVICE_NAME/node_modules ./node_modules

USER appuser
EXPOSE $PORT
CMD ["node", "dist/index.js"]
```

### 3.2 Web Application (Next.js)

```dockerfile
# apps/web/Dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm install -g pnpm@8
RUN pnpm install --frozen-lockfile

# --- Builder ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web
COPY packages ./packages
COPY pnpm-lock.yaml ./
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm build

# --- Runner ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

### 3.3 API Server

```dockerfile
# apps/api/Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@8

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api ./apps/api
COPY packages ./packages
COPY pnpm-lock.yaml ./
RUN pnpm run build --filter=@vibe-coder/api

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=deps /app/apps/api/node_modules ./node_modules
COPY --from=deps /app/packages/database ./packages/database

USER appuser
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

### 3.4 Rust AST Parser

```dockerfile
# packages/ast-parser/Dockerfile

# --- Builder ---
FROM rust:1.73-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN touch src/main.rs && cargo build --release

# --- Runner ---
FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN adduser --disabled-password --gecos '' appuser

COPY --from=builder /app/target/release/ast-parser /usr/local/bin/ast-parser

USER appuser
EXPOSE 8081
CMD ["ast-parser"]
```

### 3.5 Python Retrieval Engine

```dockerfile
# packages/retrieval/Dockerfile

# --- Builder ---
FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir poetry==1.7.0
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.create false && poetry install --no-dev
COPY . .

# --- Runner ---
FROM python:3.11-slim AS runner
WORKDIR /app

RUN adduser --disabled-password --gecos '' appuser
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/src ./src

USER appuser
EXPOSE 8082
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8082", "--workers", "4"]
```

### 3.6 Mock Interview Engine (Python)

```dockerfile
# apps/mock-interview/Dockerfile

FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

FROM python:3.11-slim AS runner
WORKDIR /app
RUN adduser --disabled-password --gecos '' appuser
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/src ./src

USER appuser
EXPOSE 8083
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8083", "--workers", "2"]
```

### 3.7 Docker Compose — Local Development

```yaml
# docker/docker-compose.yml
version: "3.9"

services:
  # --- Infrastructure ---
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: vibecoder_dev
      POSTGRES_USER: vibecoder
      POSTGRES_PASSWORD: dev_password_123
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vibecoder"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    ports: ["9200:9200"]
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    volumes:
      - es_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  # --- Application Services ---
  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    ports: ["4000:4000"]
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://vibecoder:dev_password_123@postgres:5432/vibecoder_dev
      REDIS_URL: redis://redis:6379
      ELASTICSEARCH_URL: http://elasticsearch:9200
      JWT_SECRET: local-dev-jwt-secret-min-32-chars-long!!
      JWT_REFRESH_SECRET: local-dev-refresh-secret-min-32-chars!
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      PINECONE_API_KEY: ${PINECONE_API_KEY}
      PINECONE_INDEX: vibecoder-staging
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      PORT: 4000
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      elasticsearch: { condition: service_healthy }
    volumes:
      - ../packages:/app/packages
      - ../apps/api/src:/app/apps/api/src

  websocket:
    build:
      context: ..
      dockerfile: apps/websocket/Dockerfile
    ports: ["8080:8080"]
    environment:
      NODE_ENV: development
      REDIS_URL: redis://redis:6379
      JWT_SECRET: local-dev-jwt-secret-min-32-chars-long!!
      PORT: 8080
    depends_on:
      redis: { condition: service_healthy }

  worker:
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://vibecoder:dev_password_123@postgres:5432/vibecoder_dev
      REDIS_URL: redis://redis:6379
      ELASTICSEARCH_URL: http://elasticsearch:9200
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      PINECONE_API_KEY: ${PINECONE_API_KEY}
      PINECONE_INDEX: vibecoder-staging
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      elasticsearch: { condition: service_healthy }
    deploy:
      replicas: 2

  ast-parser:
    build:
      context: ..
      dockerfile: packages/ast-parser/Dockerfile
    ports: ["8081:8081"]
    environment:
      RUST_LOG: info

  retrieval:
    build:
      context: ..
      dockerfile: packages/retrieval/Dockerfile
    ports: ["8082:8082"]
    environment:
      DATABASE_URL: postgresql://vibecoder:dev_password_123@postgres:5432/vibecoder_dev
      ELASTICSEARCH_URL: http://elasticsearch:9200
      PINECONE_API_KEY: ${PINECONE_API_KEY}
      PINECONE_INDEX: vibecoder-staging
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      postgres: { condition: service_healthy }
      elasticsearch: { condition: service_healthy }

  mock-interview:
    build:
      context: ..
      dockerfile: apps/mock-interview/Dockerfile
    ports: ["8083:8083"]
    environment:
      DATABASE_URL: postgresql://vibecoder:dev_password_123@postgres:5432/vibecoder_dev
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:4000
      NEXT_PUBLIC_WS_URL: ws://localhost:8080
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
  es_data:
```

### 3.8 Docker Compose — Production-Like (Local Testing)

```yaml
# docker/docker-compose.prod.yml
version: "3.9"

services:
  nginx:
    image: nginx:1.25-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - web
      - api
      - websocket

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: https://api.vibecoder.com
      NEXT_PUBLIC_WS_URL: wss://api.vibecoder.com

  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    environment:
      NODE_ENV: production
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
        reservations:
          cpus: "0.5"
          memory: 512M

  worker:
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    environment:
      NODE_ENV: production
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "2.0"
          memory: 2G
        reservations:
          cpus: "1.0"
          memory: 1G
```

---

## 4. Terraform Infrastructure

### 4.1 Main Configuration

```hcl
# infra/terraform/main.tf
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "vibecoder-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "vibecoder"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix = "vibecoder-${var.environment}"

  common_tags = {
    Project     = "vibecoder"
    Environment = var.environment
  }
}
```

### 4.2 Variables

```hcl
# infra/terraform/variables.tf
variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.large"
}

variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "domain_name" {
  description = "Route53 domain name"
  type        = string
  default     = "vibecoder.com"
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "github_client_id" {
  description = "GitHub OAuth client ID"
  type        = string
}

variable "github_client_secret" {
  description = "GitHub OAuth client secret"
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "pinecone_api_key" {
  description = "Pinecone API key"
  type        = string
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe secret key"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret"
  type        = string
  sensitive   = true
}
```

### 4.3 VPC Module

```hcl
# infra/terraform/modules/vpc/main.tf
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpc" })
}

# --- Public Subnets ---
resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- Private Subnets ---
resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_eip" "nat" {
  count  = 3
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.name_prefix}-nat-eip-${count.index + 1}" })
}

resource "aws_nat_gateway" "main" {
  count         = 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(var.tags, { Name = "${var.name_prefix}-nat-${count.index + 1}" })
}

resource "aws_route_table" "private" {
  count  = 3
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-private-rt-${count.index + 1}" })
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# --- Security Groups ---
resource "aws_security_group" "alb" {
  name_prefix = "${var.name_prefix}-alb-"
  vpc_id      = aws_vpc.main.id
  description = "ALB security group"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (redirect to HTTPS)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-sg" })
}

resource "aws_security_group" "ecs" {
  name_prefix = "${var.name_prefix}-ecs-"
  vpc_id      = aws_vpc.main.id
  description = "ECS tasks security group"

  ingress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    security_groups = [aws_security_group.alb.id]
    description     = "Allow from ALB"
  }

  ingress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    self            = true
    description     = "Allow inter-service communication"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-sg" })
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.name_prefix}-rds-"
  vpc_id      = aws_vpc.main.id
  description = "RDS security group"

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "PostgreSQL from ECS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-rds-sg" })
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.name_prefix}-redis-"
  vpc_id      = aws_vpc.main.id
  description = "Redis security group"

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "Redis from ECS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis-sg" })
}

resource "aws_security_group" "opensearch" {
  name_prefix = "${var.name_prefix}-opensearch-"
  vpc_id      = aws_vpc.main.id
  description = "OpenSearch security group"

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "OpenSearch from ECS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-opensearch-sg" })
}

data "aws_availability_zones" "available" {
  state = "available"
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}

output "opensearch_security_group_id" {
  value = aws_security_group.opensearch.id
}
```

### 4.4 ECS Fargate Cluster

```hcl
# infra/terraform/modules/ecs/main.tf
resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs.name
      }
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = 30
  tags              = var.tags
}

# --- Task Definitions ---
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.ecr_repository_url}/api:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 4000
          hostPort      = 4000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "4000" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_url.arn}:database_url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_url.arn}:redis_url::" },
        { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt_secret.arn}:jwt_secret::" },
        { name = "GITHUB_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.github.arn}:github_client_id::" },
        { name = "GITHUB_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.github.arn}:github_client_secret::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai.arn}:openai_api_key::" },
        { name = "PINECONE_API_KEY", valueFrom = "${aws_secretsmanager_secret.pinecone.arn}:pinecone_api_key::" },
        { name = "STRIPE_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.stripe.arn}:stripe_secret_key::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:4000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "websocket" {
  family                   = "${var.name_prefix}-websocket"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "websocket"
      image     = "${var.ecr_repository_url}/websocket:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "8080" },
      ]

      secrets = [
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_url.arn}:redis_url::" },
        { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt_secret.arn}:jwt_secret::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "websocket"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${var.ecr_repository_url}/worker:${var.image_tag}"
      essential = true

      environment = [
        { name = "NODE_ENV", value = "production" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_url.arn}:database_url::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.redis_url.arn}:redis_url::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai.arn}:openai_api_key::" },
        { name = "PINECONE_API_KEY", valueFrom = "${aws_secretsmanager_secret.pinecone.arn}:pinecone_api_key::" },
        { name = "GITHUB_TOKEN", valueFrom = "${aws_secretsmanager_secret.github_token.arn}:github_token::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "ast_parser" {
  family                   = "${var.name_prefix}-ast-parser"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "ast-parser"
      image     = "${var.ecr_repository_url}/ast-parser:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 8081
          hostPort      = 8081
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "RUST_LOG", value = "info" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ast-parser"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "retrieval" {
  family                   = "${var.name_prefix}-retrieval"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "retrieval"
      image     = "${var.ecr_repository_url}/retrieval:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 8082
          hostPort      = 8082
          protocol      = "tcp"
        }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db_url.arn}:database_url::" },
        { name = "PINECONE_API_KEY", valueFrom = "${aws_secretsmanager_secret.pinecone.arn}:pinecone_api_key::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai.arn}:openai_api_key::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "retrieval"
        }
      }
    }
  ])

  tags = var.tags
}

# --- ECS Services ---
resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.environment == "production" ? 3 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = 4000
  }

  depends_on = [var.alb_listener_https]

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_ecs_service" "websocket" {
  name            = "${var.name_prefix}-websocket"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.websocket.arn
  desired_count   = var.environment == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.ws_target_group_arn
    container_name   = "websocket"
    container_port   = 8080
  }

  depends_on = [var.alb_listener_https]
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name_prefix}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.environment == "production" ? 3 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  # No load balancer — workers consume from queue
}

resource "aws_ecs_service" "ast_parser" {
  name            = "${var.name_prefix}-ast-parser"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ast_parser.arn
  desired_count   = var.environment == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.ast_parser.arn
  }
}

resource "aws_ecs_service" "retrieval" {
  name            = "${var.name_prefix}-retrieval"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.retrieval.arn
  desired_count   = var.environment == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.retrieval.arn
  }
}

# --- Auto Scaling ---
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name_prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${var.name_prefix}-api-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 50
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "${var.name_prefix}-worker-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 65.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 30
  }
}

# --- IAM Roles ---
resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${var.name_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${var.s3_bucket_arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.ecs.arn}:*"
      },
    ]
  })
}

# --- Service Discovery ---
resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.name_prefix}.local"
  description = "Service discovery namespace for Vibe Coder"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "ast_parser" {
  name = "ast-parser"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "retrieval" {
  name = "retrieval"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# --- Secrets Manager ---
resource "aws_secretsmanager_secret" "db_url" {
  name = "${var.name_prefix}/database-url"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name = "${var.name_prefix}/redis-url"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "${var.name_prefix}/jwt-secret"
}

resource "aws_secretsmanager_secret" "github" {
  name = "${var.name_prefix}/github-oauth"
}

resource "aws_secretsmanager_secret" "github_token" {
  name = "${var.name_prefix}/github-token"
}

resource "aws_secretsmanager_secret" "openai" {
  name = "${var.name_prefix}/openai"
}

resource "aws_secretsmanager_secret" "pinecone" {
  name = "${var.name_prefix}/pinecone"
}

resource "aws_secretsmanager_secret" "stripe" {
  name = "${var.name_prefix}/stripe"
}

resource "aws_secretsmanager_secret_version" "github" {
  secret_id = aws_secretsmanager_secret.github.id
  secret_string = jsonencode({
    github_client_id     = var.github_client_id
    github_client_secret = var.github_client_secret
  })
}
```

### 4.5 RDS PostgreSQL

```hcl
# infra/terraform/modules/rds/main.tf
resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, { Name = "${var.name_prefix}-db-subnet-group" })
}

resource "aws_rds_cluster" "main" {
  cluster_identifier     = "${var.name_prefix}-postgres"
  engine                 = "aurora-postgresql"
  engine_version         = "16.1"
  database_name          = "vibecoder"
  master_username        = "vibecoder_admin"
  master_password        = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_security_group_id]
  storage_encrypted      = true
  skip_final_snapshot    = var.environment != "production"

  final_snapshot_identifier = var.environment == "production" ? "${var.name_prefix}-final-snapshot" : null
  backup_retention_period   = var.environment == "production" ? 30 : 7

  tags = var.tags
}

resource "aws_rds_cluster_instance" "main" {
  count              = var.environment == "production" ? 2 : 1
  identifier         = "${var.name_prefix}-postgres-${count.index}"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = var.db_instance_class
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  performance_insights_enabled = true

  tags = var.tags
}

resource "aws_rds_cluster_parameter_group" "main" {
  name   = "${var.name_prefix}-pg16"
  family = "aurora-postgresql16"

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

# --- Read Replicas (Production) ---
resource "aws_rds_cluster_instance" "read_replica" {
  count              = var.environment == "production" ? 1 : 0
  identifier         = "${var.name_prefix}-postgres-read-1"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = var.db_instance_class
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  performance_insights_enabled = true

  tags = var.tags
}

output "cluster_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "reader_endpoint" {
  value = aws_rds_cluster.main.reader_endpoint
}

output "cluster_id" {
  value = aws_rds_cluster.main.id
}
```

### 4.6 ElastiCache Redis

```hcl
# infra/terraform/modules/elasticache/main.tf
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Redis cluster for Vibe Coder"

  node_type            = var.redis_node_type
  num_cache_clusters   = var.environment == "production" ? 3 : 2
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.redis_security_group_id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  automatic_failover_enabled = true
  multi_az_enabled           = var.environment == "production"

  snapshot_retention_limit = var.environment == "production" ? 7 : 1
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "redis" {
  name              = "/elasticache/${var.name_prefix}"
  retention_in_days = 14
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "reader_endpoint" {
  value = aws_elasticache_replication_group.main.reader_endpoint_address
}
```

### 4.7 OpenSearch

```hcl
# infra/terraform/modules/opensearch/main.tf
resource "aws_opensearch_domain" "main" {
  domain_name    = "${var.name_prefix}-search"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type            = "m6g.large.search"
    instance_count           = var.environment == "production" ? 3 : 2
    dedicated_master_enabled = var.environment == "production"
    dedicated_master_type    = "m6g.large.search"
    dedicated_master_count   = 3
    zone_awareness_enabled   = var.environment == "production"
  }

  vpc_options {
    subnet_ids         = [var.private_subnet_ids[0]]
    security_group_ids = [var.opensearch_security_group_id]
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = 100
  }

  encryption_at_rest_enabled    = true
  node_to_node_encryption_enabled = true

  domain_endpoint_options {
    enforce_https = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = var.ecs_task_role_arn
        }
        Action   = "es:*"
        Resource = "arn:aws:es:${var.aws_region}:${var.aws_account_id}:domain/${var.name_prefix}-search/*"
      }
    ]
  })

  tags = var.tags
}

output "domain_endpoint" {
  value = aws_opensearch_domain.main.endpoint
}

output "kibana_endpoint" {
  value = aws_opensearch_domain.main.kibana_endpoint
}
```

### 4.8 S3 & CloudFront

```hcl
# infra/terraform/modules/s3/main.tf
resource "aws_s3_bucket" "main" {
  bucket = "${var.name_prefix}-artifacts"
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "expire-clones"
    status = "Enabled"

    filter {
      prefix = "repo-clones/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "transition-artifacts"
    status = "Enabled"

    filter {
      prefix = "analysis-artifacts/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }
  }
}

# --- CloudFront Distribution ---
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  aliases             = ["vibecoder.com", "www.vibecoder.com"]
  price_class         = "PriceClass_100"

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    domain_name = aws_s3_bucket.main.bucket_regional_domain_name
    origin_id   = "s3"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "alb"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Accept", "Content-Type"]

      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
  }

  # Static assets cache
  ordered_cache_behavior {
    path_pattern     = "/_next/static/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "alb"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 86400
    default_ttl            = 604800
    max_ttl                = 31536000
    compress               = true
  }

  # Analysis artifacts from S3
  ordered_cache_behavior {
    path_pattern     = "/artifacts/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 3600
    default_ttl            = 86400
    max_ttl                = 604800
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_cloudfront_origin_access_identity" "main" {
  comment = "OAI for ${var.name_prefix}"
}
```

---

## 5. CI/CD Pipeline (GitHub Actions)

### 5.1 CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: "20"
  PYTHON_VERSION: "3.11"
  RUST_VERSION: "1.73"

jobs:
  # --- Lint & Type Check ---
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck

  # --- Unit Tests ---
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test:unit -- --coverage
      - uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  # --- Integration Tests ---
  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: vibecoder_test
          POSTGRES_USER: vibecoder
          POSTGRES_PASSWORD: test_password
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U vibecoder"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test:integration
        env:
          DATABASE_URL: postgresql://vibecoder:test_password@localhost:5432/vibecoder_test
          REDIS_URL: redis://localhost:6379

  # --- AST Parser Tests (Rust) ---
  test-ast-parser:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/ast-parser
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test
      - run: cargo clippy -- -D warnings

  # --- Python Tests ---
  test-python:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/retrieval
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v4
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install poetry==1.7.0
      - run: poetry install --no-dev
      - run: poetry run pytest --cov=src --cov-report=xml
      - uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: packages/retrieval/coverage.xml

  # --- Docker Build Test ---
  docker-build:
    runs-on: ubuntu-latest
    needs: [lint, test-unit]
    strategy:
      matrix:
        service: [api, websocket, worker, web]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/${{ matrix.service }}/Dockerfile
          push: false
          tags: vibecoder/${{ matrix.service }}:test
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 5.2 Deploy to Staging

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches: [develop]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: vibecoder
  ECS_CLUSTER: vibecoder-staging-cluster
  ECS_SERVICE: vibecoder-staging-api
  CONTAINER_NAME: api

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set ECR Repository URLs
        run: |
          echo "ECR_REGISTRY=${{ steps.login-ecr.outputs.registry }}" >> $GITHUB_ENV

      - name: Build, tag, and push images
        run: |
          COMMIT_SHA=${{ github.sha }}
          SERVICES=("api" "websocket" "worker")

          for SERVICE in "${SERVICES[@]}"; do
            echo "Building $SERVICE..."
            docker build \
              -t $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:$COMMIT_SHA \
              -t $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:staging-latest \
              -f apps/$SERVICE/Dockerfile .
            docker push $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:$COMMIT_SHA
            docker push $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:staging-latest
          done

      - name: Run database migrations
        run: |
          docker run --rm \
            -e DATABASE_URL=${{ secrets.STAGING_DATABASE_URL }} \
            $ECR_REGISTRY/$ECR_REPOSITORY/worker:staging-latest \
            npx prisma migrate deploy

      - name: Deploy to ECS (API)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-staging-api \
            --force-new-deployment

      - name: Deploy to ECS (WebSocket)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-staging-websocket \
            --force-new-deployment

      - name: Deploy to ECS (Workers)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-staging-worker \
            --force-new-deployment

      - name: Wait for deployment stability
        run: |
          aws ecs wait services-stable \
            --cluster $ECS_CLUSTER \
            --services vibecoder-staging-api vibecoder-staging-websocket vibecoder-staging-worker

      - name: Run smoke tests
        run: |
          sleep 30
          curl -sf https://staging-api.vibecoder.com/health || exit 1
          echo "Health check passed!"

      - name: Notify on success
        if: success()
        run: |
          echo "✅ Staging deployment successful"
          echo "Commit: ${{ github.sha }}"
```

### 5.3 Deploy to Production

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  workflow_dispatch:
    inputs:
      commit_sha:
        description: "Commit SHA to deploy"
        required: true

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: vibecoder
  ECS_CLUSTER: vibecoder-production-cluster

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit_sha }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set variables
        run: |
          echo "ECR_REGISTRY=${{ steps.login-ecr.outputs.registry }}" >> $GITHUB_ENV
          echo "IMAGE_TAG=${{ inputs.commit_sha }}" >> $GITHUB_ENV

      - name: Build and push images
        run: |
          SERVICES=("api" "websocket" "worker")
          for SERVICE in "${SERVICES[@]}"; do
            echo "Building $SERVICE..."
            docker build \
              -t $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:$IMAGE_TAG \
              -t $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:production-latest \
              -f apps/$SERVICE/Dockerfile .
            docker push $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:$IMAGE_TAG
            docker push $ECR_REGISTRY/$ECR_REPOSITORY/$SERVICE:production-latest
          done

      - name: Run database migrations
        run: |
          docker run --rm \
            -e DATABASE_URL=${{ secrets.PRODUCTION_DATABASE_URL }} \
            $ECR_REGISTRY/$ECR_REPOSITORY/worker:$IMAGE_TAG \
            npx prisma migrate deploy

      - name: Deploy API (rolling update)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-api \
            --task-definition vibecoder-production-api:$IMAGE_TAG \
            --force-new-deployment

      - name: Deploy WebSocket (rolling update)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-websocket \
            --task-definition vibecoder-production-websocket:$IMAGE_TAG \
            --force-new-deployment

      - name: Deploy Workers (rolling update)
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-worker \
            --task-definition vibecoder-production-worker:$IMAGE_TAG \
            --force-new-deployment

      - name: Wait for deployment stability
        run: |
          aws ecs wait services-stable \
            --cluster $ECS_CLUSTER \
            --services vibecoder-production-api vibecoder-production-websocket vibecoder-production-worker

      - name: Verify deployment
        run: |
          sleep 30
          curl -sf https://api.vibecoder.com/health || exit 1
          echo "Production health check passed!"

      - name: Rollback on failure
        if: failure()
        run: |
          echo "⚠️ Deployment failed, rolling back..."
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-api \
            --force-new-deployment
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-websocket \
            --force-new-deployment
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service vibecoder-production-worker \
            --force-new-deployment
```

---

## 6. Initial Deployment Steps

### 6.1 One-Time Setup

```bash
# 1. Clone and configure
git clone https://github.com/your-org/vibe-coder.git
cd vibe-coder

# 2. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# 3. Initialize Terraform state backend
cd infra/terraform
aws s3 mb s3://vibecoder-terraform-state --region us-east-1
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 4. Create ECR repositories
aws ecr create-repository --repository-name vibecoder/api
aws ecr create-repository --repository-name vibecoder/websocket
aws ecr create-repository --repository-name vibecoder/worker
aws ecr create-repository --repository-name vibecoder/web
aws ecr create-repository --repository-name vibecoder/ast-parser
aws ecr create-repository --repository-name vibecoder/retrieval
aws ecr create-repository --repository-name vibecoder/mock-interview

# 5. Deploy infrastructure
cd infra/terraform/environments/production
terraform init
terraform plan -var-file="terraform.tfvars" -out=plan.out
terraform apply plan.out

# 6. Run initial database migration
cd ../../..
docker compose -f docker/docker-compose.prod.yml run --rm api npx prisma migrate deploy

# 7. Seed initial data (optional)
docker compose -f docker/docker-compose.prod.yml run --rm api npx prisma db seed
```

### 6.2 Environment Variables Reference

```bash
# .env.example

# --- GitHub OAuth ---
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# --- Database ---
DATABASE_URL=postgresql://vibecoder:password@localhost:5432/vibecoder_dev

# --- Redis ---
REDIS_URL=redis://localhost:6379

# --- Elasticsearch ---
ELASTICSEARCH_URL=http://localhost:9200

# --- Authentication ---
JWT_SECRET=min-32-characters-long-random-secret-key-here!
JWT_REFRESH_SECRET=min-32-characters-long-different-secret-key!

# --- AI Services ---
OPENAI_API_KEY=sk-your-openai-api-key
VOYAGE_API_KEY=your-voyage-api-key

# --- Vector Database ---
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=vibecoder-staging
PINECONE_ENV=us-east1-gcp

# --- Payments ---
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key

# --- Email (optional) ---
SENDGRID_API_KEY=SG.your_sendgrid_key
EMAIL_FROM=noreply@vibecoder.com

# --- App Config ---
NODE_ENV=development
PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

---

## 7. Monitoring & Post-Deployment

### 7.1 Health Check Endpoints

```typescript
// apps/api/src/routes/health.ts
import { Router } from 'express';
import { prisma } from '@vibe-coder/database';
import Redis from 'ioredis';

const router = Router();

router.get('/health', async (req, res) => {
  const checks = {
    api: 'ok',
    database: 'unknown',
    redis: 'unknown',
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  try {
    const redis = new Redis(process.env.REDIS_URL!);
    await redis.ping();
    await redis.quit();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const healthy = checks.database === 'ok' && checks.redis === 'ok';
  res.status(healthy ? 200 : 503).json(checks);
});

export default router;
```

### 7.2 CloudWatch Dashboard

```bash
# Create monitoring dashboard
aws cloudwatch put-dashboard \
  --dashboard-name "VibeCoder-Production" \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "x": 0, "y": 0, "width": 12, "height": 6,
        "properties": {
          "title": "ECS CPU Utilization",
          "metrics": [
            ["AWS/ECS", "CPUUtilization", "ClusterName", "vibecoder-production-cluster", "ServiceName", "vibecoder-production-api"],
            ["...", "vibecoder-production-websocket"],
            ["...", "vibecoder-production-worker"]
          ],
          "period": 60,
          "stat": "Average",
          "region": "us-east-1"
        }
      },
      {
        "type": "metric",
        "x": 12, "y": 0, "width": 12, "height": 6,
        "properties": {
          "title": "Request Count",
          "metrics": [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "app/vibecoder-prod-alb/..."]
          ],
          "period": 60,
          "stat": "Sum"
        }
      },
      {
        "type": "metric",
        "x": 0, "y": 6, "width": 12, "height": 6,
        "properties": {
          "title": "RDS Connections",
          "metrics": [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "vibecoder-production-postgres-0"]
          ],
          "period": 60,
          "stat": "Average"
        }
      },
      {
        "type": "metric",
        "x": 12, "y": 6, "width": 12, "height": 6,
        "properties": {
          "title": "Redis Memory",
          "metrics": [
            ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "CacheClusterId", "vibecoder-prod-redis-..."]
          ],
          "period": 300,
          "stat": "Average"
        }
      }
    ]
  }'
```

### 7.3 Alerting Rules

```bash
# High error rate alert
aws cloudwatch put-metric-alarm \
  --alarm-name "VibeCoder-HighErrorRate" \
  --alarm-description "API 5xx error rate exceeds 5%" \
  --metric-name "HTTPCode_Target_5XX_Count" \
  --namespace "AWS/ApplicationELB" \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --dimensions "Name=LoadBalancer,Value=app/vibecoder-prod-alb/..." \
  --alarm-actions "arn:aws:sns:us-east-1:ACCOUNT:PagerDuty" \
  --treat-missing-data notBreaching

# High latency alert
aws cloudwatch put-metric-alarm \
  --alarm-name "VibeCoder-HighLatency" \
  --alarm-description "API p99 latency exceeds 5 seconds" \
  --metric-name "TargetResponseTime" \
  --namespace "AWS/ApplicationELB" \
  --extended-statistic "p99" \
  --period 300 \
  --evaluation-periods 3 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions "Name=TargetGroup,Value=targetgroup/vibecoder-prod-api-tg/..." \
  --alarm-actions "arn:aws:sns:us-east-1:ACCOUNT:Slack-Alerts"

# Database connection pool exhaustion
aws cloudwatch put-metric-alarm \
  --alarm-name "VibeCoder-DBConnectionPool" \
  --alarm-description "RDS connections exceed 80% of pool" \
  --metric-name "DatabaseConnections" \
  --namespace "AWS/RDS" \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 160 \
  --comparison-operator GreaterThanThreshold \
  --dimensions "Name=DBInstanceIdentifier,Value=vibecoder-production-postgres-0" \
  --alarm-actions "arn:aws:sns:us-east-1:ACCOUNT:PagerDuty"
```

---

## 8. Rollback Procedure

```bash
# Emergency rollback — revert to previous known-good image
# 1. Find the previous working image tag
aws ecs describe-services \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api \
  --query 'services[0].taskDefinition'

# 2. Update to previous task definition
aws ecs update-service \
  --cluster vibecoder-production-cluster \
  --service vibecoder-production-api \
  --task-definition vibecoder-production-api:<previous-revision>

# 3. Wait for stability
aws ecs wait services-stable \
  --cluster vibecoder-production-cluster \
  --services vibecoder-production-api

# 4. Repeat for websocket and worker services
# 5. If database migration needs rollback:
npx prisma migrate reset  # CAUTION: destructive
# Or restore from RDS snapshot:
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier vibecoder-production-postgres-rollback \
  --snapshot-identifier vibecoder-final-snapshot-<timestamp>
```

---

## 9. Local Development Quickstart

```bash
# 1. Clone the repo
git clone https://github.com/your-org/vibe-coder.git
cd vibe-coder

# 2. Copy environment file
cp .env.example .env.local

# 3. Start infrastructure
docker compose -f docker/docker-compose.yml up -d postgres redis elasticsearch

# 4. Wait for services to be healthy
docker compose -f docker/docker-compose.yml ps

# 5. Run database migrations
pnpm run db:migrate

# 6. Seed development data
pnpm run db:seed

# 7. Start all services
pnpm run dev

# 8. Open browser
open http://localhost:3000

# Services will be available at:
# - Frontend:  http://localhost:3000
# - API:       http://localhost:4000
# - WebSocket: ws://localhost:8080
# - AST:       http://localhost:8081
# - Retrieval: http://localhost:8082
# - Mock:      http://localhost:8083
```

---

*This guide covers the complete deployment lifecycle from local development through production. For infrastructure cost optimization and scaling decisions, refer to the Technical Specification document.*
