# Build context: the hono-apcore repo root (two levels up from this file).
# Usage:
#   docker compose up --build                                          (from examples/demo/)
#   docker build -t hono-apcore-demo -f examples/demo/Dockerfile ..     (from the repo root)

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace/hono-apcore

# ---- Build the hono-apcore library ----
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src/ ./src/
COPY tsconfig*.json ./
RUN pnpm run build

# ---- Install the demo's dependencies ----
COPY examples/demo/package.json ./demo/
WORKDIR /workspace/hono-apcore/demo
RUN pnpm install

# ---- Copy the demo ----
COPY examples/demo/src/ ./src/
COPY examples/demo/tsconfig.json examples/demo/apcore.yaml examples/demo/acl.yaml ./

EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "src/main.ts"]
