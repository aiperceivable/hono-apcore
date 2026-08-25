export interface Todo {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
}

/**
 * Plain in-memory state with no apcore awareness at all.
 *
 * The point of the demo: one store, reached two ways — through the app's own
 * REST routes and through the AI tools — with no duplicated logic.
 */
export class TodoStore {
  private todos: Todo[] = [
    { id: 1, title: 'Try the hono-apcore demo', done: false, createdAt: new Date().toISOString() },
    { id: 2, title: 'Read the hono-apcore README', done: false, createdAt: new Date().toISOString() },
  ];
  private nextId = 3;

  list(done?: boolean): Todo[] {
    return done === undefined ? this.todos : this.todos.filter((todo) => todo.done === done);
  }

  get(id: number): Todo | undefined {
    return this.todos.find((todo) => todo.id === id);
  }

  add(title: string): Todo {
    const todo: Todo = {
      id: this.nextId++,
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    this.todos.push(todo);
    return todo;
  }

  update(id: number, done: boolean): Todo | undefined {
    const todo = this.get(id);
    if (todo) todo.done = done;
    return todo;
  }

  remove(id: number): boolean {
    const index = this.todos.findIndex((todo) => todo.id === id);
    if (index === -1) return false;
    this.todos.splice(index, 1);
    return true;
  }
}

export const todoStore = new TodoStore();
