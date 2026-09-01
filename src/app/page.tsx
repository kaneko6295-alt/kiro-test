"use client";

import { useState, useEffect, useCallback } from "react";

type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function HomePage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTodos = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/todos");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Todo[] = await res.json();
      setTodos(data);
    } catch (err) {
      setError("Todoの取得に失敗しました。");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const todo: Todo = await res.json();
      setTodos((prev) => [todo, ...prev]);
      setNewTitle("");
    } catch (err) {
      setError("Todoの追加に失敗しました。");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (todo: Todo) => {
    // Optimistic update
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todo.id ? { ...t, completed: !t.completed } : t
      )
    );
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !todo.completed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Todo = await res.json();
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      // Rollback
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? todo : t))
      );
      setError("Todoの更新に失敗しました。");
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = todos;
    setTodos((t) => t.filter((todo) => todo.id !== id));
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setTodos(prev);
      setError("Todoの削除に失敗しました。");
      console.error(err);
    }
  };

  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <main className="container">
      <div className="header">
        <h1>📝 AWS Todo App</h1>
        <p>Next.js + ECS Fargate + Aurora Serverless v2</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="form" onSubmit={handleAdd}>
        <input
          className="input"
          type="text"
          placeholder="新しいTodoを入力..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          disabled={submitting}
          aria-label="新しいTodoのタイトル"
          maxLength={200}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={submitting || !newTitle.trim()}
          aria-label="Todoを追加"
        >
          {submitting ? "追加中..." : "追加"}
        </button>
      </form>

      {loading ? (
        <div className="empty">
          <p>読み込み中...</p>
        </div>
      ) : todos.length === 0 ? (
        <div className="empty">
          <p>まだTodoがありません。上のフォームから追加してください。</p>
        </div>
      ) : (
        <ul className="todo-list" aria-label="Todoリスト">
          {todos.map((todo) => (
            <li key={todo.id} className="todo-item">
              <input
                type="checkbox"
                className="todo-checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
                aria-label={`${todo.title} を完了にする`}
              />
              <span
                className={`todo-title${todo.completed ? " completed" : ""}`}
              >
                {todo.title}
              </span>
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(todo.id)}
                aria-label={`${todo.title} を削除`}
                title="削除"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && todos.length > 0 && (
        <p className="stats">
          {completedCount} / {todos.length} 件完了
        </p>
      )}
    </main>
  );
}
