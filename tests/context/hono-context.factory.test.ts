import { describe, expect, it } from 'vitest';
import { createIdentity } from 'apcore-js';
import {
  HonoContextFactory,
  defaultContextFactory,
  toHeaders,
} from '../../src/context/hono-context.factory.js';

const factory = new HonoContextFactory();

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('toHeaders', () => {
  it('passes a Headers instance through', () => {
    const headers = new Headers({ a: '1' });
    expect(toHeaders(headers)).toBe(headers);
  });

  it('reads a Request', () => {
    const request = new Request('http://x/', { headers: { 'x-user-id': 'u1' } });
    expect(toHeaders(request).get('x-user-id')).toBe('u1');
  });

  it('reads a Hono context shape', () => {
    const request = new Request('http://x/', { headers: { 'x-user-id': 'u2' } });
    expect(toHeaders({ req: { raw: request } }).get('x-user-id')).toBe('u2');
  });

  it('reads a Headers-bearing object', () => {
    const headers = new Headers({ 'x-user-id': 'u3' });
    expect(toHeaders({ headers }).get('x-user-id')).toBe('u3');
  });

  it('reads a Node-style plain header record', () => {
    const headers = toHeaders({
      headers: { 'x-user-id': 'u4', 'x-roles': ['admin', 'ignored'], missing: undefined },
    });
    expect(headers.get('x-user-id')).toBe('u4');
    expect(headers.get('x-roles')).toBe('admin');
    expect(headers.get('missing')).toBeNull();
  });
});

describe('HonoContextFactory identity', () => {
  it('prefers x-user-id', () => {
    const context = factory.createContext(new Headers({ 'x-user-id': 'alice' }));
    expect(context.identity?.id).toBe('alice');
    expect(context.identity?.type).toBe('user');
  });

  it('falls back to a bearer token', () => {
    const context = factory.createContext(new Headers({ authorization: 'Bearer abc' }));
    expect(context.identity?.id).toBe('bearer');
    expect(context.identity?.type).toBe('api_key');
  });

  it('is case-insensitive about the Bearer scheme', () => {
    const context = factory.createContext(new Headers({ authorization: 'bearer abc' }));
    expect(context.identity?.id).toBe('bearer');
  });

  it('treats a bare x-roles header as a roled demo user', () => {
    const context = factory.createContext(new Headers({ 'x-roles': 'admin, ops' }));
    expect(context.identity?.id).toBe('u1');
    expect(context.identity?.roles).toEqual(['admin', 'ops']);
  });

  it('falls back to anonymous', () => {
    const context = factory.createContext(new Headers());
    expect(context.identity?.id).toBe('anonymous');
    expect(context.identity?.type).toBe('anonymous');
  });

  it('attaches roles to an identified caller', () => {
    const context = factory.createContext(
      new Headers({ 'x-user-id': 'alice', 'x-roles': 'admin' }),
    );
    expect(context.identity?.roles).toEqual(['admin']);
  });

  it('ignores an empty x-roles header', () => {
    const context = factory.createContext(new Headers({ 'x-user-id': 'a', 'x-roles': ' , ' }));
    expect(context.identity?.roles).toEqual([]);
  });

  it('lets a custom resolver win', () => {
    const custom = new HonoContextFactory({
      resolveIdentity: () => createIdentity('svc', 'service', ['admin']),
    });
    const context = custom.createContext(new Headers({ 'x-user-id': 'alice' }));
    expect(context.identity?.id).toBe('svc');
  });

  it('falls back to the headers when the resolver returns null', () => {
    const custom = new HonoContextFactory({ resolveIdentity: () => null });
    const context = custom.createContext(new Headers({ 'x-user-id': 'alice' }));
    expect(context.identity?.id).toBe('alice');
  });
});

describe('HonoContextFactory trace and data', () => {
  it('adopts the inbound traceparent trace id', () => {
    const context = factory.createContext(new Headers({ traceparent: TRACEPARENT }));
    expect(context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('starts a fresh trace when no traceparent is present', () => {
    const context = factory.createContext(new Headers());
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('copies x-correlation-id into context data', () => {
    const context = factory.createContext(new Headers({ 'x-correlation-id': 'abc' }));
    expect(context.data['x-correlation-id']).toBe('abc');
  });

  it('accepts x-request-id as the correlation id', () => {
    const context = factory.createContext(new Headers({ 'x-request-id': 'req-1' }));
    expect(context.data['x-correlation-id']).toBe('req-1');
  });

  it('merges custom data entries', () => {
    const custom = new HonoContextFactory({
      data: (headers) => ({ tenant: headers.get('x-tenant') }),
    });
    const context = custom.createContext(new Headers({ 'x-tenant': 'acme' }));
    expect(context.data['tenant']).toBe('acme');
  });

  it('exposes a shared default factory', () => {
    expect(defaultContextFactory).toBeInstanceOf(HonoContextFactory);
  });
});
