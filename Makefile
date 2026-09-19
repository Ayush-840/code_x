.PHONY: infra migrate seed dev typecheck build

infra:
	docker compose -f docker/docker-compose.yml up -d

migrate:
	pnpm db:generate
	pnpm db:migrate
	pnpm db:seed

dev:
	pnpm --filter @vibe-coder/api dev

typecheck:
	pnpm -r typecheck

build:
	pnpm -r build