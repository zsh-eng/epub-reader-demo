import { test, expect } from "bun:test";
import {
  hashPassword,
  verifyStoredPassword,
  LEGACY_PASSWORD_PREFIX,
} from "./password";

test("preserves legacy passwords without accepting wrong or malformed values", async () => {
  const hash =
    LEGACY_PASSWORD_PREFIX +
    "Xj+SO0CHAnpDOZyhr2+KAojZiIxA+ns2Oa3M8/uCxACqqWLH6PfCNTuEtuBfyUmt";
  expect(
    await verifyStoredPassword({ hash, password: "test-user-password" }),
  ).toBe(true);
  expect(await verifyStoredPassword({ hash, password: "incorrect" })).toBe(
    false,
  );
  expect(
    await verifyStoredPassword({
      hash: LEGACY_PASSWORD_PREFIX + "invalid",
      password: "test-user-password",
    }),
  ).toBe(false);
});
test("new passwords use the current hash format", async () => {
  const hash = await hashPassword("new-password-example");
  expect(hash.startsWith(LEGACY_PASSWORD_PREFIX)).toBe(false);
  expect(
    await verifyStoredPassword({ hash, password: "new-password-example" }),
  ).toBe(true);
  expect(await verifyStoredPassword({ hash, password: "incorrect" })).toBe(
    false,
  );
});
