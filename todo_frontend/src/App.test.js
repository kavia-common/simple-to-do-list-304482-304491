import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App - smoke/regression", () => {
  test("regression: renders app title", () => {
    render(<App />);
    // Title uses a non-breaking hyphen in the source ("To‑Do")
    expect(screen.getByRole("heading", { name: /to/i })).toBeInTheDocument();
    expect(screen.getByText(/to‑do/i)).toBeInTheDocument();
  });

  test("structure sanity: renders main layout regions and key controls", () => {
    const { container } = render(<App />);

    // Header/top bar exists
    expect(container.querySelector("header.topbar")).toBeInTheDocument();

    // Add task input is properly labeled via <label srOnly>
    expect(screen.getByLabelText(/add a task/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add$/i })).toBeInTheDocument();

    // Filter tabs exist with a tablist role
    expect(screen.getByRole("tablist", { name: /task filters/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /completed/i })).toBeInTheDocument();

    // Footer exists
    expect(container.querySelector("footer.footer")).toBeInTheDocument();
  });

  test("snapshot-ish: container renders stable outer shell", () => {
    const { container } = render(<App />);
    // Snapshot only for outer shell to avoid brittleness on dynamic counts/timestamps.
    expect(container.querySelector(".appShell")).toMatchSnapshot();
  });
});
