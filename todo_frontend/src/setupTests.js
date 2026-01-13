// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

/**
 * Global test defaults:
 * - Always start with clean localStorage
 * - Provide a deterministic fetch mock per-test (tests can override)
 * - Keep React env vars isolated between tests
 */
beforeEach(() => {
  window.localStorage.clear();

  // Default fetch mock: fail fast if a test forgets to set expectations.
  global.fetch = jest.fn(() => {
    throw new Error("fetch was called but not mocked for this test");
  });
});

afterEach(() => {
  jest.clearAllMocks();
});
