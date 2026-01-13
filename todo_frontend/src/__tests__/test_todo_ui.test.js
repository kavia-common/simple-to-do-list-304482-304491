import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

function seedLocalStorage(tasks) {
  window.localStorage.setItem("kavia.todo.tasks.v1", JSON.stringify(tasks));
}

function getTaskList() {
  return screen.getByRole("list", { name: /task list/i });
}

async function addTask(user, title) {
  const input = screen.getByLabelText(/add a task/i);
  await user.clear(input);
  await user.type(input, title);
  await user.click(screen.getByRole("button", { name: /^add$/i }));
}

describe("To-do UI - CRUD, filtering, validation, a11y", () => {
  test("empty state: shows prompt when no tasks exist (all filter)", async () => {
    render(<App />);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  test("validation: does not allow adding an empty task", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/please enter a task/i);
    expect(screen.queryByRole("list", { name: /task list/i })).not.toBeInTheDocument();
  });

  test("add task: adds a task and displays it in the list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTask(user, "Buy milk");

    const list = getTaskList();
    expect(within(list).getByText("Buy milk")).toBeInTheDocument();

    // Basic a11y: task action buttons exist and are labeled
    expect(within(list).getByRole("button", { name: /mark as completed/i })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  test("edit task: enter edit mode, change title, and save", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Old title", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    await user.click(within(list).getByRole("button", { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit task/i);
    await user.clear(editInput);
    await user.type(editInput, "New title");

    await user.click(within(list).getByRole("button", { name: /save/i }));

    expect(within(list).getByText("New title")).toBeInTheDocument();
    expect(screen.queryByLabelText(/edit task/i)).not.toBeInTheDocument();
  });

  test("edit task: cannot save empty title (shows validation error)", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Some title", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    await user.click(within(list).getByRole("button", { name: /edit/i }));

    const editInput = screen.getByLabelText(/edit task/i);
    await user.clear(editInput);

    // Save with empty title
    await user.click(within(list).getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be empty/i);
    // Still in edit mode
    expect(screen.getByLabelText(/edit task/i)).toBeInTheDocument();
  });

  test("delete task: removes it from the list and shows empty state", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Task to delete", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    expect(within(list).getByText("Task to delete")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /delete/i }));

    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /task list/i })).not.toBeInTheDocument();
  });

  test("complete/incomplete: toggles completion state and label updates", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "t1", title: "Toggle me", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    const toggleBtn = within(list).getByRole("button", { name: /mark as completed/i });

    await user.click(toggleBtn);

    // After completion, aria-label changes
    expect(within(list).getByRole("button", { name: /mark as not completed/i })).toBeInTheDocument();
  });

  test("filtering: active/completed/all views show correct tasks", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "a1", title: "Active A", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
      { id: "c1", title: "Completed C", completed: true, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    // All
    const list = await screen.findByRole("list", { name: /task list/i });
    expect(within(list).getByText("Active A")).toBeInTheDocument();
    expect(within(list).getByText("Completed C")).toBeInTheDocument();

    // Active filter
    await user.click(screen.getByRole("tab", { name: /active/i }));
    expect(within(getTaskList()).getByText("Active A")).toBeInTheDocument();
    expect(within(getTaskList()).queryByText("Completed C")).not.toBeInTheDocument();

    // Completed filter
    await user.click(screen.getByRole("tab", { name: /completed/i }));
    expect(within(getTaskList()).getByText("Completed C")).toBeInTheDocument();
    expect(within(getTaskList()).queryByText("Active A")).not.toBeInTheDocument();

    // Back to all
    await user.click(screen.getByRole("tab", { name: /all/i }));
    expect(within(getTaskList()).getByText("Active A")).toBeInTheDocument();
    expect(within(getTaskList()).getByText("Completed C")).toBeInTheDocument();
  });

  test("completed filter empty state: shows 'No completed tasks yet.'", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "a1", title: "Only active", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    await user.click(screen.getByRole("tab", { name: /completed/i }));
    expect(await screen.findByText(/no completed tasks yet/i)).toBeInTheDocument();
  });

  test("clear completed: disabled when none completed; enabled when some completed and clears them", async () => {
    const user = userEvent.setup();
    seedLocalStorage([
      { id: "a1", title: "Active", completed: false, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
      { id: "c1", title: "Done", completed: true, createdAt: "2020-01-01", updatedAt: "2020-01-01" },
    ]);

    render(<App />);

    // Initially enabled because there is a completed task.
    const clearBtn = await screen.findByRole("button", { name: /clear completed/i });
    expect(clearBtn).toBeEnabled();

    await user.click(clearBtn);

    // Completed should be removed from UI (filter is "all" by default).
    const list = await screen.findByRole("list", { name: /task list/i });
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).queryByText("Done")).not.toBeInTheDocument();
  });
});
