import { Type } from '@sinclair/typebox';
import { getCurrentIdentity } from 'apcore-mcp';
import { defineToolset } from 'hono-apcore';
import { todoStore } from './todo.store.js';

const TODO = Type.Object({
  id: Type.Number(),
  title: Type.String(),
  done: Type.Boolean(),
  createdAt: Type.String(),
});

/** The MCP caller's identity id, or "anonymous" when unauthenticated. */
function caller(): string {
  return getCurrentIdentity()?.id ?? 'anonymous';
}

/**
 * Todo tools declared with `defineToolset` — the Hono counterpart to NestJS's
 * `@ApModule` + `@ApTool` decorators.
 *
 * Every tool returns a `caller` field so the identity chain stays visible:
 *   JWT token -> JWTAuthenticator -> identity.id -> getCurrentIdentity()
 *
 * ACL demo (see acl.yaml + apcore.yaml):
 *   anonymous  -> todo.list, todo.get only (read-only)
 *   bearer JWT -> todo.*    (full access)
 */
export const todoTools = defineToolset({
  namespace: 'todo',
  description: 'Todo list management',
  tags: ['todo'],
  tools: {
    // ── Read tools (anonymous + bearer) ─────────────────────────────────────
    list: {
      description: 'List all todos, optionally filtered by completion status',
      inputSchema: Type.Object({
        done: Type.Optional(
          Type.Boolean({ description: 'true=completed, false=pending, omit=all' }),
        ),
      }),
      outputSchema: Type.Object({
        todos: Type.Array(TODO),
        count: Type.Number(),
        caller: Type.String({ description: 'Caller identity — "anonymous" or the JWT subject' }),
      }),
      annotations: { readonly: true, idempotent: true },
      tags: ['todo', 'query'],
      handler: (inputs) => {
        const todos = todoStore.list(inputs.done as boolean | undefined);
        return { todos, count: todos.length, caller: caller() };
      },
    },

    get: {
      description: 'Get a single todo by ID',
      inputSchema: Type.Object({ id: Type.Number({ description: 'Todo ID' }) }),
      outputSchema: Type.Object({
        todo: Type.Optional(TODO),
        error: Type.Optional(Type.String()),
        caller: Type.String(),
      }),
      annotations: { readonly: true, idempotent: true },
      tags: ['todo', 'query'],
      handler: (inputs) => {
        const todo = todoStore.get(Number(inputs.id));
        return todo ? { todo, caller: caller() } : { error: 'Todo not found', caller: caller() };
      },
    },

    // ── Write tools (bearer only — anonymous blocked by the ACL) ────────────
    add: {
      description: 'Add a new todo item',
      inputSchema: Type.Object({
        title: Type.String({ description: 'What needs to be done' }),
      }),
      outputSchema: Type.Object({
        todo: TODO,
        caller: Type.String({ description: 'Who created this todo' }),
      }),
      annotations: { readonly: false, destructive: false },
      tags: ['todo', 'mutate'],
      handler: (inputs) => ({ todo: todoStore.add(String(inputs.title)), caller: caller() }),
    },

    update: {
      description: 'Mark a todo as done or undone',
      inputSchema: Type.Object({
        id: Type.Number({ description: 'Todo ID' }),
        done: Type.Boolean({ description: 'New completion status' }),
      }),
      outputSchema: Type.Object({
        todo: Type.Optional(TODO),
        error: Type.Optional(Type.String()),
        caller: Type.String(),
      }),
      annotations: { readonly: false, idempotent: true },
      tags: ['todo', 'mutate'],
      handler: (inputs) => {
        const todo = todoStore.update(Number(inputs.id), Boolean(inputs.done));
        return todo ? { todo, caller: caller() } : { error: 'Todo not found', caller: caller() };
      },
    },

    delete: {
      description: 'Delete a todo by ID — restricted to authenticated callers (bearer)',
      inputSchema: Type.Object({ id: Type.Number({ description: 'Todo ID to delete' }) }),
      outputSchema: Type.Object({
        deleted: Type.Boolean(),
        id: Type.Number(),
        caller: Type.String({ description: 'Who performed the deletion' }),
      }),
      annotations: { readonly: false, destructive: true, idempotent: true },
      tags: ['todo', 'mutate', 'destructive'],
      handler: (inputs) => ({
        deleted: todoStore.remove(Number(inputs.id)),
        id: Number(inputs.id),
        caller: caller(),
      }),
    },
  },
});
