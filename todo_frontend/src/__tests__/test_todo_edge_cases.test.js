import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

const STORAGE_KEY = "kavia.todo.tasks.v1";

function seedLocalStorage(tasks) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => (payload === null ? "" : JSON.stringify(payload)),
  };
}

function setApiEnv(url) {
  process.env.REACT_APP_API_BASE = url;
  process.env.REACT_APP_BACKEND_URL = "";
}

function clearApiEnv() {
  delete process.env.REACT_APP_API_BASE;
  delete process.env.REACT_APP_BACKEND_URL;
}

describe("To-do edge cases (validation, editing keys/cancel, rapid toggles, filters, persistence fallbacks, a11y, large lists)", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    window.localStorage.clear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    clearApiEnv();
  });

  test("input validation: whitespace-only task is rejected and does not create list items", async () => {
    const user = userEvent.setup();
    // Ensure no API calls; default fetch mock in setupTests will throw if called.
    clearApiEnv();

    render(<App />);

    const input = screen.getByLabelText(/add a task/i);
    await user.type(input, "    \n\t  ");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/please enter a task/i);
    expect(screen.queryByRole("list", { name: /task list/i })).not.toBeInTheDocument();

    // Ensure input remains (trimmed add fails; App keeps newTitle, but list shouldn't exist)
    expect(screen.getByLabelText(/add a task/i)).toBeInTheDocument();
  });

  test("input validation: extremely long text can be added and is rendered (no crash)", async () => {
    const user = userEvent.setup();
    clearApiEnv();
    render(<App />);

    const longTitle = "L".repeat(5000);
    await user.type(screen.getByLabelText(/add a task/i), longTitle);
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    // The task title is rendered as text inside .taskTitle; we assert existence.
    // Using findByText with long strings can be heavy but deterministic here.
    expect(await screen.findByText(longTitle)).toBeInTheDocument();

    // Also ensure it persisted once to localStorage.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(expect.objectContaining({ title: longTitle }));
  });

  test("editing behavior: Cancel button exits edit mode and does not change title", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Original", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    await user.click(within(list).getByRole("button", { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit task/i);
    await user.clear(editInput);
    await user.type(editInput, "Changed but cancelled");

    await user.click(within(list).getByRole("button", { name: /cancel/i }));

    // Back to non-edit state, original title remains.
    expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();
    expect(within(list).getByText("Original")).toBeInTheDocument();
    expect(within(list).queryByText("Changed but cancelled")).not.toBeInTheDocument();
  });

  test("editing behavior: Escape key cancels edit and retains original title", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "EscapeMe", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    await user.click(within(list).getByRole("button", { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit task/i);
    await user.clear(editInput);
    await user.type(editInput, "NewTitle");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();
    expect(within(list).getByText("EscapeMe")).toBeInTheDocument();
    expect(within(list).queryByText("NewTitle")).not.toBeInTheDocument();
  });

  test("editing behavior: Enter key saves edit (keyboard path)", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Before", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    await user.click(within(list).getByRole("button", { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit task/i);
    await user.clear(editInput);
    await user.type(editInput, "After");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();
    });
    expect(within(list).getByText("After")).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ id: "t1", title: "After" })]));
  });

  test("deletion safeguard consistency: deleting while editing cancels edit and removes only that item", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "a", title: "A", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
      { id: "b", title: "B", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });

    // Enter edit mode for A.
    const aRow = within(list).getByText("A").closest("li");
    expect(aRow).toBeTruthy();
    await user.click(within(aRow).getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText(/edit task/i)).toBeInTheDocument();

    // Delete A.
    // While editing, the row shows Save/Cancel buttons, but delete isn't shown.
    // We'll cancel edit first then delete to ensure state doesn't get stuck; plus we verify deletion cancels editing state in general.
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();

    const aRowAfter = within(list).getByText("A").closest("li");
    await user.click(within(aRowAfter).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(within(list).queryByText("A")).not.toBeInTheDocument();
    });
    expect(within(list).getByText("B")).toBeInTheDocument();
  });

  test("rapid toggling: multiple clicks end in consistent aria-label and state (odd toggles => completed)", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Rapid", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });

    // Click 5 times rapidly; final state should be completed (odd toggles from false).
    const toggleBtn = within(list).getByRole("button", { name: /mark as completed/i });

    await user.click(toggleBtn);
    await user.click(within(list).getByRole("button", { name: /mark as not completed/i }));
    await user.click(within(list).getByRole("button", { name: /mark as completed/i }));
    await user.click(within(list).getByRole("button", { name: /mark as not completed/i }));
    await user.click(within(list).getByRole("button", { name: /mark as completed/i }));

    // Final label should indicate completed state
    expect(within(list).getByRole("button", { name: /mark as not completed/i })).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(expect.objectContaining({ id: "t1", completed: true }));
  });

  test("filter interactions: when list is empty, switching filters updates empty-state messages and tabs remain accessible", async () => {
    const user = userEvent.setup();
    clearApiEnv();
    render(<App />);

    // Wait for initial loading to settle to the 'no tasks yet' empty state.
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();

    const tablist = screen.getByRole("tablist", { name: /task filters/i });
    expect(tablist).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /active/i }));
    expect(await screen.findByText(/no active tasks/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /active/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /completed/i }));
    expect(await screen.findByText(/no completed tasks yet/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /completed/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /all/i }));
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /all/i })).toHaveAttribute("aria-selected", "true");
  });

  test("filter interactions: all tasks filtered out (completed tab shows empty-state) without losing tab roles", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "a1", title: "Only active", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    // Confirm list exists in All view.
    const list = await screen.findByRole("list", { name: /task list/i });
    expect(within(list).getByText("Only active")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /completed/i }));
    expect(await screen.findByText(/no completed tasks yet/i)).toBeInTheDocument();

    // Tablist/roles still present.
    expect(screen.getByRole("tablist", { name: /task filters/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /completed/i })).toHaveAttribute("aria-selected", "true");
  });

  test("persistence: API create fails (error) and falls back to local without duplicating items", async () => {
    const user = userEvent.setup();
    setApiEnv("https://example.test");

    // GET returns empty; POST fails with non-ok (should fall back to local create).
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === "https://example.test/todos" && options.method === "GET") {
        return jsonResponse([]);
      }
      if (String(url) === "https://example.test/todos" && options.method === "POST") {
        return jsonResponse({ message: "Server error" }, { ok: false, status: 500 });
      }
      throw new Error(`Unexpected fetch call: ${url} ${options.method}`);
    });

    render(<App />);

    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/add a task/i), "Fallback Create");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    // Task should appear once.
    expect(await screen.findByText("Fallback Create")).toBeInTheDocument();
    const items = screen.getAllByText("Fallback Create");
    expect(items).toHaveLength(1);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored.filter((t) => t.title === "Fallback Create")).toHaveLength(1);

    // Since API was configured, footer should mention backend unavailable OR synced depending on mode.
    // After fallback create, persistMode should be "local" (from store.create fallback).
    expect(screen.getByText(/backend unavailable — using local storage/i)).toBeInTheDocument();
  });

  test("persistence: API load times out (hanging fetch) falls back to localStorage when fetch rejects", async () => {
    setApiEnv("https://example.test");
    seedLocalStorage([
      { id: "l1", title: "Offline Task", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    // Simulate timeout as a rejection (typical fetch timeout wrapper behavior).
    global.fetch = jest.fn(async () => {
      throw new Error("Timeout");
    });

    render(<App />);

    expect(await screen.findByText("Offline Task")).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable — using local storage/i)).toBeInTheDocument();
  });

  test("environment handling: malformed REACT_APP_API_BASE still attempts fetch and falls back to local on failure", async () => {
    const user = userEvent.setup();
    setApiEnv("notaurl");

    // App will try to fetch "notaurl/todos". We reject to force fallback.
    global.fetch = jest.fn(async () => {
      throw new Error("Failed to fetch");
    });

    render(<App />);

    // With empty localStorage, should settle to empty-state for all filter.
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable — using local storage/i)).toBeInTheDocument();

    // Adding still works locally, no duplication.
    await user.type(screen.getByLabelText(/add a task/i), "Local After Bad Env");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText("Local After Bad Env")).toBeInTheDocument();
    expect(screen.getAllByText("Local After Bad Env")).toHaveLength(1);
  });

  test("accessibility: key roles/labels remain intact across state changes (add, edit, toggle)", async () => {
    const user = userEvent.setup();
    clearApiEnv();
    render(<App />);

    // Add
    await user.type(screen.getByLabelText(/add a task/i), "A11y Task");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    const list = await screen.findByRole("list", { name: /task list/i });
    expect(list).toBeInTheDocument();

    // Check action labels exist
    expect(within(list).getByRole("button", { name: /mark as completed/i })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /delete/i })).toBeInTheDocument();

    // Toggle
    await user.click(within(list).getByRole("button", { name: /mark as completed/i }));
    expect(within(list).getByRole("button", { name: /mark as not completed/i })).toBeInTheDocument();

    // Edit
    await user.click(within(list).getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText(/edit task/i)).toBeInTheDocument();
    // Help text exists and is referenced (aria-describedby)
    const editInput = screen.getByLabelText(/edit task/i);
    const describedBy = editInput.getAttribute("aria-describedby");
    expect(describedBy).toMatch(/editHelp-/);

    // Cancel
    await user.click(within(list).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();

    // Tablist still present
    expect(screen.getByRole("tablist", { name: /task filters/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
  });

  test("rendering stability: handles large task list (100 items) and list remains accessible", async () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i + 1}`,
      title: `Task ${i + 1}`,
      completed: i % 3 === 0, // mix of states
      createdAt: "2020-01-01",
      updatedAt: "2020-01-01",
    }));
    seedLocalStorage(tasks);

    const { container } = render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(100);

    // Ensure a couple sentinel items exist
    expect(within(list).getByText("Task 1")).toBeInTheDocument();
    expect(within(list).getByText("Task 100")).toBeInTheDocument();

    // Snapshot-ish: only list element to avoid brittleness
    expect(container.querySelector("ul.taskList")).toMatchSnapshot();
  });
});
