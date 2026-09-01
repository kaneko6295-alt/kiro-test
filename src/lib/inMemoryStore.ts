/**
 * In-memory todo store used when DATABASE_URL is not configured.
 * This is replaced by Prisma/Aurora in production.
 */

export type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

let todos: Todo[] = [
  {
    id: "1",
    title: "AWS CDKのセットアップ",
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "2",
    title: "ECS Fargateを学ぶ",
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let nextId = 3;

export function getAllTodos(): Todo[] {
  return [...todos];
}

export function getTodoById(id: string): Todo | undefined {
  return todos.find((t) => t.id === id);
}

export function createTodo(title: string): Todo {
  const now = new Date().toISOString();
  const todo: Todo = {
    id: String(nextId++),
    title,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  todos.push(todo);
  return todo;
}

export function updateTodo(
  id: string,
  data: Partial<Pick<Todo, "title" | "completed">>
): Todo | null {
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return null;
  todos[index] = {
    ...todos[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  return todos[index];
}

export function deleteTodo(id: string): boolean {
  const before = todos.length;
  todos = todos.filter((t) => t.id !== id);
  return todos.length < before;
}
