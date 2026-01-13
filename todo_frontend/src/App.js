import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const STORAGE_KEY = "kavia.todo.tasks.v1";

/**
 * Creates a compact random id (client-side only). Good enough for a demo app.
 * Avoids adding external dependencies.
 */
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Determines API base URL from environment variables.
 * Prefer REACT_APP_API_BASE, otherwise REACT_APP_BACKEND_URL.
 */
function getApiBaseUrl() {
  const raw =
    (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Thin API client that can gracefully fall back to localStorage when:
 * - API base URL is missing, OR
 * - API is unreachable / returns unexpected responses.
 *
 * Assumed backend endpoints (common REST shape):
 * - GET    /todos
 * - POST   /todos
 * - PUT    /todos/:id
 * - DELETE /todos/:id
 *
 * If backend differs, we still fall back without breaking the UI.
 */
function createTodoStore() {
  const apiBase = getApiBaseUrl();

  const local = {
    read() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    write(tasks) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    },
  };

  async function safeJson(resp) {
    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function apiFetch(path, options) {
    if (!apiBase) throw new Error("NO_API_BASE");
    const url = `${apiBase}${path.startsWith("/") ? "" : "/"}${path}`;
    const resp = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });
    if (!resp.ok) {
      const payload = await safeJson(resp);
      const message = payload?.message || payload?.detail || `HTTP ${resp.status}`;
      throw new Error(message);
    }
    return safeJson(resp);
  }

  const normalizeTask = (t) => {
    if (!t || typeof t !== "object") return null;
    const id = t.id ?? t._id ?? t.todo_id ?? t.uuid;
    const title = t.title ?? t.text ?? t.name ?? t.task ?? "";
    const completed = Boolean(t.completed ?? t.done ?? t.is_completed ?? false);
    const createdAt = t.createdAt ?? t.created_at ?? t.created ?? null;
    const updatedAt = t.updatedAt ?? t.updated_at ?? t.updated ?? null;

    if (!id || typeof title !== "string") return null;
    return {
      id: String(id),
      title: title,
      completed,
      createdAt: createdAt ? String(createdAt) : null,
      updatedAt: updatedAt ? String(updatedAt) : null,
    };
  };

  // PUBLIC_INTERFACE
  async function load() {
    /** Load tasks from backend if possible; otherwise localStorage. */
    // Prefer backend if configured.
    if (apiBase) {
      try {
        const data = await apiFetch("/todos", { method: "GET" });
        const list = Array.isArray(data) ? data : data?.items ?? data?.todos ?? [];
        const normalized = list.map(normalizeTask).filter(Boolean);
        // Mirror backend data into localStorage for offline fallback.
        local.write(normalized);
        return { tasks: normalized, mode: "api" };
      } catch {
        // Backend unreachable or incompatible response -> fallback.
        const tasks = local.read();
        return { tasks, mode: "local" };
      }
    }

    return { tasks: local.read(), mode: "local" };
  }

  // PUBLIC_INTERFACE
  async function create(title) {
    /** Create a task in backend if possible; otherwise localStorage. */
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Task title is required.");

    // Attempt backend create first if configured.
    if (apiBase) {
      try {
        const data = await apiFetch("/todos", {
          method: "POST",
          body: JSON.stringify({ title: trimmed, completed: false }),
        });
        const created = normalizeTask(data) || normalizeTask(data?.item) || normalizeTask(data?.todo);
        if (!created) throw new Error("Unexpected backend response.");
        const current = local.read();
        const next = [created, ...current];
        local.write(next);
        return { task: created, mode: "api" };
      } catch {
        // fallthrough to local
      }
    }

    const now = new Date().toISOString();
    const task = {
      id: createId(),
      title: trimmed,
      completed: false,
      createdAt: now,
      updatedAt: now,
    };
    const next = [task, ...local.read()];
    local.write(next);
    return { task, mode: "local" };
  }

  // PUBLIC_INTERFACE
  async function update(id, patch) {
    /** Update a task. patch supports {title?, completed?}. */
    const current = local.read();
    const idx = current.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error("Task not found.");

    const nextTask = {
      ...current[idx],
      ...patch,
      title:
        typeof patch.title === "string" ? patch.title : current[idx].title,
      updatedAt: new Date().toISOString(),
    };

    if (apiBase) {
      try {
        const data = await apiFetch(`/todos/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({
            title: nextTask.title,
            completed: Boolean(nextTask.completed),
          }),
        });

        const updated =
          normalizeTask(data) || normalizeTask(data?.item) || normalizeTask(data?.todo) || nextTask;

        const next = [...current];
        next[idx] = updated;
        local.write(next);
        return { task: updated, mode: "api" };
      } catch {
        // fallthrough to local
      }
    }

    const next = [...current];
    next[idx] = nextTask;
    local.write(next);
    return { task: nextTask, mode: "local" };
  }

  // PUBLIC_INTERFACE
  async function remove(id) {
    /** Delete a task in backend if possible; otherwise localStorage. */
    const current = local.read();

    if (apiBase) {
      try {
        await apiFetch(`/todos/${encodeURIComponent(id)}`, { method: "DELETE" });
        const next = current.filter((t) => t.id !== id);
        local.write(next);
        return { mode: "api" };
      } catch {
        // fallthrough to local
      }
    }

    const next = current.filter((t) => t.id !== id);
    local.write(next);
    return { mode: "local" };
  }

  return { load, create, update, remove, hasApiConfigured: Boolean(apiBase) };
}

// PUBLIC_INTERFACE
function App() {
  /** Main to-do application component: CRUD, filtering, and persistence with backend + local fallback. */
  const store = useMemo(() => createTodoStore(), []);
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("all"); // all | active | completed
  const [newTitle, setNewTitle] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  const [persistMode, setPersistMode] = useState(store.hasApiConfigured ? "api" : "local");
  const [error, setError] = useState("");

  const newTaskInputRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    // Load tasks on mount.
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError("");
      try {
        const { tasks: loaded, mode } = await store.load();
        if (cancelled) return;
        setTasks(sortTasks(loaded));
        setPersistMode(mode);
      } catch (e) {
        if (cancelled) return;
        setError(typeof e?.message === "string" ? e.message : "Failed to load tasks.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => {
    // Focus edit input when entering editing mode.
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const counts = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const active = total - completed;
    return { total, active, completed };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (filter === "active") return tasks.filter((t) => !t.completed);
    if (filter === "completed") return tasks.filter((t) => t.completed);
    return tasks;
  }, [tasks, filter]);

  function sortTasks(list) {
    // Put active tasks first; then by updatedAt/createdAt descending.
    const toTime = (t) => {
      const d = t.updatedAt || t.createdAt;
      const ms = d ? Date.parse(d) : 0;
      return Number.isFinite(ms) ? ms : 0;
    };
    return [...list].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return toTime(b) - toTime(a);
    });
  }

  async function handleAddTask(e) {
    e.preventDefault();
    setError("");

    const title = newTitle.trim();
    if (!title) {
      setError("Please enter a task.");
      return;
    }

    try {
      const { task, mode } = await store.create(title);
      setPersistMode(mode);
      setTasks((prev) => sortTasks([task, ...prev]));
      setNewTitle("");
      newTaskInputRef.current?.focus();
    } catch (err) {
      setError(typeof err?.message === "string" ? err.message : "Failed to add task.");
    }
  }

  async function handleToggleComplete(task) {
    setError("");
    try {
      const { task: updated, mode } = await store.update(task.id, {
        completed: !task.completed,
      });
      setPersistMode(mode);
      setTasks((prev) => sortTasks(prev.map((t) => (t.id === task.id ? updated : t))));
    } catch (err) {
      setError(typeof err?.message === "string" ? err.message : "Failed to update task.");
    }
  }

  function beginEdit(task) {
    setEditingId(task.id);
    setEditingTitle(task.title);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTitle("");
    setError("");
  }

  async function saveEdit(task) {
    setError("");
    const title = editingTitle.trim();
    if (!title) {
      setError("Task title cannot be empty.");
      return;
    }
    try {
      const { task: updated, mode } = await store.update(task.id, { title });
      setPersistMode(mode);
      setTasks((prev) => sortTasks(prev.map((t) => (t.id === task.id ? updated : t))));
      cancelEdit();
    } catch (err) {
      setError(typeof err?.message === "string" ? err.message : "Failed to save task.");
    }
  }

  async function handleDelete(task) {
    setError("");
    try {
      const { mode } = await store.remove(task.id);
      setPersistMode(mode);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (editingId === task.id) cancelEdit();
    } catch (err) {
      setError(typeof err?.message === "string" ? err.message : "Failed to delete task.");
    }
  }

  async function clearCompleted() {
    const completed = tasks.filter((t) => t.completed);
    if (completed.length === 0) return;

    setError("");
    // Best-effort sequential delete to keep logic simple and avoid partial UI desync.
    const ids = completed.map((t) => t.id);
    let mode = persistMode;

    try {
      for (const id of ids) {
        const res = await store.remove(id);
        mode = res.mode;
      }
      setPersistMode(mode);
      setTasks((prev) => prev.filter((t) => !t.completed));
    } catch (err) {
      setError(typeof err?.message === "string" ? err.message : "Failed to clear completed tasks.");
    }
  }

  function onEditKeyDown(e, task) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(task);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">
            <div className="brandMark" aria-hidden="true" />
            <div className="brandText">
              <h1 className="title">To‑Do</h1>
              <p className="subtitle">Clean, fast tasks with graceful persistence.</p>
            </div>
          </div>

          <div className="statusPills" aria-label="Persistence and stats">
            <span className={`pill ${persistMode === "api" ? "pillApi" : "pillLocal"}`}>
              {persistMode === "api" ? "Backend" : "Local"}
            </span>
            <span className="pill pillCount">{counts.active} active</span>
          </div>
        </div>
      </header>

      <main className="container">
        <section className="card">
          <form className="addRow" onSubmit={handleAddTask}>
            <label className="srOnly" htmlFor="newTask">
              Add a task
            </label>
            <input
              id="newTask"
              ref={newTaskInputRef}
              className="textInput"
              placeholder="Add a task…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoComplete="off"
              inputMode="text"
            />
            <button className="primaryButton" type="submit">
              Add
            </button>
          </form>

          <div className="toolbar">
            <div className="filters" role="tablist" aria-label="Task filters">
              <button
                type="button"
                className={`chip ${filter === "all" ? "chipActive" : ""}`}
                onClick={() => setFilter("all")}
                role="tab"
                aria-selected={filter === "all"}
              >
                All <span className="chipCount">{counts.total}</span>
              </button>
              <button
                type="button"
                className={`chip ${filter === "active" ? "chipActive" : ""}`}
                onClick={() => setFilter("active")}
                role="tab"
                aria-selected={filter === "active"}
              >
                Active <span className="chipCount">{counts.active}</span>
              </button>
              <button
                type="button"
                className={`chip ${filter === "completed" ? "chipActive" : ""}`}
                onClick={() => setFilter("completed")}
                role="tab"
                aria-selected={filter === "completed"}
              >
                Completed <span className="chipCount">{counts.completed}</span>
              </button>
            </div>

            <button
              type="button"
              className="ghostButton"
              onClick={clearCompleted}
              disabled={counts.completed === 0}
              title="Remove all completed tasks"
            >
              Clear completed
            </button>
          </div>

          {error ? (
            <div className="alert" role="alert">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="emptyState" aria-live="polite">
              Loading tasks…
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="emptyState" aria-live="polite">
              {filter === "completed"
                ? "No completed tasks yet."
                : filter === "active"
                  ? "No active tasks — nice."
                  : "No tasks yet. Add your first one above."}
            </div>
          ) : (
            <ul className="taskList" aria-label="Task list">
              {visibleTasks.map((task) => {
                const isEditing = editingId === task.id;

                return (
                  <li key={task.id} className={`taskItem ${task.completed ? "taskDone" : ""}`}>
                    <button
                      type="button"
                      className={`checkButton ${task.completed ? "checkOn" : ""}`}
                      onClick={() => handleToggleComplete(task)}
                      aria-label={task.completed ? "Mark as not completed" : "Mark as completed"}
                      title={task.completed ? "Mark as not completed" : "Mark as completed"}
                    >
                      <span className="checkIcon" aria-hidden="true">
                        ✓
                      </span>
                    </button>

                    <div className="taskContent">
                      {isEditing ? (
                        <>
                          <label className="srOnly" htmlFor={`edit-${task.id}`}>
                            Edit task
                          </label>
                          <input
                            id={`edit-${task.id}`}
                            ref={editInputRef}
                            className="editInput"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => onEditKeyDown(e, task)}
                            aria-describedby={`editHelp-${task.id}`}
                          />
                          <div id={`editHelp-${task.id}`} className="srOnly">
                            Press Enter to save, Escape to cancel.
                          </div>
                        </>
                      ) : (
                        <div className="taskTitle" title={task.title}>
                          {task.title}
                        </div>
                      )}
                    </div>

                    <div className="taskActions" aria-label="Task actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="iconButton iconPrimary"
                            onClick={() => saveEdit(task)}
                            aria-label="Save"
                            title="Save"
                          >
                            💾
                          </button>
                          <button
                            type="button"
                            className="iconButton"
                            onClick={cancelEdit}
                            aria-label="Cancel"
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="iconButton"
                            onClick={() => beginEdit(task)}
                            aria-label="Edit"
                            title="Edit"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="iconButton iconDanger"
                            onClick={() => handleDelete(task)}
                            aria-label="Delete"
                            title="Delete"
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="footer">
          <span>
            {persistMode === "api"
              ? "Synced with backend API."
              : store.hasApiConfigured
                ? "Backend unavailable — using local storage."
                : "No backend configured — using local storage."}
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;
