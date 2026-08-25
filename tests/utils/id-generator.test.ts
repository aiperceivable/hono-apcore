import { describe, expect, it } from 'vitest';
import {
  applyModulePrefix,
  generateModuleId,
  normalizeMethodName,
  normalizeName,
  toSnakeCase,
} from '../../src/utils/id-generator.js';

describe('toSnakeCase', () => {
  it('splits camelCase and PascalCase', () => {
    expect(toSnakeCase('sendEmail')).toBe('send_email');
    expect(toSnakeCase('TodoList')).toBe('todo_list');
  });

  it('keeps acronym runs readable', () => {
    expect(toSnakeCase('HTTPClient')).toBe('http_client');
    expect(toSnakeCase('parseHTML')).toBe('parse_html');
  });

  it('normalises spaces and hyphens', () => {
    expect(toSnakeCase('list all-todos')).toBe('list_all_todos');
  });

  it('leaves an already snake_case name alone', () => {
    expect(toSnakeCase('send_email')).toBe('send_email');
  });
});

describe('normalizeName', () => {
  it('strips a trailing service-style suffix', () => {
    expect(normalizeName('TodoService')).toBe('todo');
    expect(normalizeName('WeatherRoutes')).toBe('weather');
    expect(normalizeName('OrdersController')).toBe('orders');
  });

  it('keeps a name that is only a suffix', () => {
    expect(normalizeName('Service')).toBe('service');
  });

  it('leaves a plain name alone', () => {
    expect(normalizeName('todo')).toBe('todo');
  });
});

describe('normalizeMethodName', () => {
  it('snake-cases method names', () => {
    expect(normalizeMethodName('batchSend')).toBe('batch_send');
    expect(normalizeMethodName('send')).toBe('send');
  });
});

describe('generateModuleId', () => {
  it('joins namespace and name', () => {
    expect(generateModuleId('todo', 'list')).toBe('todo.list');
  });

  it('normalises both segments when asked', () => {
    expect(generateModuleId('TodoService', 'listAll', true)).toBe('todo.list_all');
  });

  it('returns an explicit id verbatim', () => {
    expect(generateModuleId('a', 'b', true, 'custom.override')).toBe('custom.override');
  });

  it('drops the dot when the namespace is empty', () => {
    expect(generateModuleId('', 'list')).toBe('list');
  });
});

describe('applyModulePrefix', () => {
  it('returns the id unchanged without a prefix', () => {
    expect(applyModulePrefix('todo.list')).toBe('todo.list');
    expect(applyModulePrefix('todo.list', '')).toBe('todo.list');
  });

  it('inserts the separating dot', () => {
    expect(applyModulePrefix('todo.list', 'svc')).toBe('svc.todo.list');
  });

  it('does not double the dot', () => {
    expect(applyModulePrefix('todo.list', 'svc.')).toBe('svc.todo.list');
  });
});
