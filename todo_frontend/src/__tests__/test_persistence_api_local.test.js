import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

function setApiEnv(url) {
  process.env.REACT_APP_API_BASE = url;
  process.env.REACT_APP_BACKEND_URL = "";
}

function clearApiEnv() {
  delete process.env.REACT_APP_API_BASE;
  delete process.env.REACT_APP_BACKEND_URL;
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("Persistence behavior (backend API vs localStorage fallback)", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Keep env isolated between tests.
    process.env = { ...ORIGINAL_ENV };
    window.localStorage.clear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    clearApiEnv();
  });

  test("when backend URL env is present: loads from API and shows 'Backend' in UI", async () => {
    setApiEnv("https://example.test");

    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe("https://example.test/todos");
      expect(options.method).toBe("GET");
      return jsonResponse([{ id: "1", title: "From API", completed: false }]);
    });

    render(<App />);

    // Task appears
    expect(await screen.findByText("From API")).toBeInTheDocument();

    // Mode pill indicates Backend (scope to the status pill region to avoid matching footer text)
    const statusRegion = screen.getByLabelText(/persistence and stats/i);
    expect(within(statusRegion).getByText(/^Backend$/i)).toBeInTheDocument();

    // Also mirrored to localStorage
    const stored = JSON.parse(window.localStorage.getItem("kavia.todo.tasks.v1"));
    expect(stored).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "1", title: "From API", completed: false })])
    );
  });

  test("when backend URL env is present: adding task calls POST and updates UI (success path)", async () => {
    const user = userEvent.setup();
    setApiEnv("https://example.test");

    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === "https://example.test/todos" && options.method === "GET") {
        return jsonResponse([]); // initial load
      }
      if (String(url) === "https://example.test/todos" && options.method === "POST") {
        const body = JSON.parse(options.body);
        expect(body).toEqual({ title: "New API Task", completed: false });
        return jsonResponse({ id: "n1", title: "New API Task", completed: false });
      }
      throw new Error(`Unexpected fetch call: ${url} ${options.method}`);
    });

    render(<App />);

    // Wait for initial load to finish (empty state).
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/add a task/i), "New API Task");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText("New API Task")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/todos",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("when backend is unavailable: falls back to localStorage and shows fallback footer text", async () => {
    setApiEnv("https://example.test");

    // API load fails -> should fall back to localStorage.
    window.localStorage.setItem(
      "kavia.todo.tasks.v1",
      JSON.stringify([{ id: "l1", title: "From Local", completed: false }])
    );

    global.fetch = jest.fn(async () => {
      throw new Error("Network down");
    });

    render(<App />);

    expect(await screen.findByText("From Local")).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable — using local storage/i)).toBeInTheDocument();
  });

  test("when env missing: uses localStorage only and does not call fetch", async () => {
    const user = userEvent.setup();
    clearApiEnv();

    global.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called when API env missing");
    });

    render(<App />);

    // Add a task and ensure it appears
    await user.type(screen.getByLabelText(/add a task/i), "Local Only");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText("Local Only")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    // Ensure it persisted to localStorage
    const stored = JSON.parse(window.localStorage.getItem("kavia.todo.tasks.v1"));
    expect(stored[0]).toEqual(expect.objectContaining({ title: "Local Only", completed: false }));
    expect(screen.getByText(/no backend configured — using local storage/i)).toBeInTheDocument();
  });

  test("API update: toggling completion calls PUT and updates UI label", async () => {
    const user = userEvent.setup();
    setApiEnv("https://example.test");

    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === "https://example.test/todos" && options.method === "GET") {
        return jsonResponse([{ id: "t1", title: "Toggle via API", completed: false }]);
      }
      if (String(url) === "https://example.test/todos/t1" && options.method === "PUT") {
        const body = JSON.parse(options.body);
        expect(body).toEqual({ title: "Toggle via API", completed: true });
        return jsonResponse({ id: "t1", title: "Toggle via API", completed: true });
      }
      throw new Error(`Unexpected fetch call: ${url} ${options.method}`);
    });

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    const toggleBtn = within(list).getByRole("button", { name: /mark as completed/i });

    await user.click(toggleBtn);

    await waitFor(() => {
      expect(within(list).getByRole("button", { name: /mark as not completed/i })).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/todos/t1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  test("API delete: clicking delete calls DELETE and removes from UI", async () => {
    const user = userEvent.setup();
    setApiEnv("https://example.test");

    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === "https://example.test/todos" && options.method === "GET") {
        return jsonResponse([{ id: "d1", title: "Delete via API", completed: false }]);
      }
      if (String(url) === "https://example.test/todos/d1" && options.method === "DELETE") {
        return jsonResponse(null);
      }
      throw new Error(`Unexpected fetch call: ${url} ${options.method}`);
    });

    render(<App />);

    const list = await screen.findByRole("list", { name: /task list/i });
    expect(within(list).getByText("Delete via API")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /delete/i }));

    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/todos/d1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
