import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../../db.js";
import { studentsAddedMeanwhile } from "./student-reuse.js";

const fakeDb = (students: { id: string; mobile: string }[]) => ({
  candidate: { findMany: async ({ where }: { where: { mobile: { in: string[] } } }) => students.filter(({ mobile }) => where.mobile.in.includes(mobile)) },
}) as unknown as Db;

test("a student another import just created is reused by mobile; a shared mobile is left alone", async () => {
  const db = fakeDb([{ id: "s-1", mobile: "9000000001" }, { id: "s-2", mobile: "9000000002" }, { id: "s-3", mobile: "9000000002" }]);
  const reused = await studentsAddedMeanwhile(db, [
    { candidateCode: "U-NEW-1", mobile: "+91 90000 00001" },
    { candidateCode: "u-new-2", mobile: "9000000002" },
    { candidateCode: "u-new-3", mobile: "9000000003" },
    { candidateCode: "u-no-mobile", mobile: null },
  ]);
  assert.deepEqual([...reused], [["u-new-1", "s-1"]]);
});
