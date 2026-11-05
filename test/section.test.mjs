import test from "node:test";
import assert from "node:assert/strict";
import { SECTION_GRADES, gradeCode, gradeLabel, parseSection, composeSection } from "../shared/section.js";
import { normalize } from "../server/store.js";

test("the shared parser reads every stored section format", () => {
  assert.deepEqual(parseSection("Grade 3 - Sec A"), { grade: "3", sectionName: "A" });
  assert.deepEqual(parseSection("Grade 6 - Sec Sampaguita"), { grade: "6", sectionName: "Sampaguita" });
  assert.deepEqual(parseSection("Kinder - Sec M"), { grade: "K", sectionName: "M" });
  assert.deepEqual(parseSection("Kindergarten - Sec M"), { grade: "K", sectionName: "M" });
  assert.deepEqual(parseSection("  Grade 4 - Sec B  "), { grade: "4", sectionName: "B" }, "whitespace is trimmed");
  // A bare section name is kept but carries no grade.
  assert.deepEqual(parseSection("A"), { grade: "", sectionName: "A" });
  // Grade 7 does not exist here and the usual shape is unknown: no guessing.
  assert.deepEqual(parseSection("Grade 7 - Sec A"), { grade: "", sectionName: "" });
  assert.deepEqual(parseSection(""), { grade: "", sectionName: "" });
  assert.deepEqual(parseSection(null), { grade: "", sectionName: "" });
});

test("grade codes and labels map one to one", () => {
  assert.equal(gradeCode("Kindergarten"), "K");
  assert.equal(gradeCode("Kinder"), "K");
  assert.equal(gradeCode("Grade 4"), "4");
  assert.equal(gradeCode("Grade 40"), null);
  assert.equal(gradeLabel("K"), "Kindergarten");
  assert.equal(gradeLabel("5"), "Grade 5");
  assert.equal(gradeLabel("nope"), "");
  assert.equal(SECTION_GRADES.length, 7, "Kindergarten + Grade 1–6");
});

test("composeSection round-trips through parseSection for every grade", () => {
  for (const label of SECTION_GRADES) {
    const code = gradeCode(label);
    const composed = composeSection(code, "A");
    const expected = code === "K" ? "Kinder - Sec A" : `${label} - Sec A`;
    assert.equal(composed, expected);
    assert.deepEqual(parseSection(composed), { grade: code, sectionName: "A" });
  }
  assert.equal(composeSection("", "A"), "A", "no grade means the bare section name");
  assert.equal(composeSection("3", ""), "Grade 3", "no section name keeps just the grade");
});

test("normalize backfills grade and sectionName on existing roster rows and accounts", () => {
  // A data file written before the structured fields existed.
  const d = normalize({
    roster: [
      { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Rm 204", gps: "14.3, 121.1", status: "active" },
      { id: "t2", name: "Mr. Cruz", section: "Legacy free text", room: "Rm 210", gps: "14.3, 121.1", status: "active" },
    ],
    incidents: [],
    accounts: [
      { id: "a1", role: "parent", section: "Kinder - Sec M" },
      { id: "a2", role: "teacher", section: "Grade 5 - Sec X" },
      { id: "a3", role: "responder", section: null },
      { id: "a4", role: "parent", section: "Legacy free text" },
    ],
  });

  assert.deepEqual([d.roster[0].grade, d.roster[0].sectionName], ["3", "A"]);
  assert.equal(d.roster[0].registry, 30, "the other backfill still runs");
  assert.deepEqual([d.roster[1].grade, d.roster[1].sectionName], ["", "Legacy free text"]);
  assert.deepEqual([d.accounts[0].grade, d.accounts[0].sectionName], ["K", "M"]);
  assert.deepEqual([d.accounts[1].grade, d.accounts[1].sectionName], ["5", "X"]);
  assert.deepEqual([d.accounts[2].grade, d.accounts[2].sectionName], ["", ""], "no section, no parts");
  assert.deepEqual([d.accounts[3].grade, d.accounts[3].sectionName], ["", "Legacy free text"]);

  // Running it again is idempotent — the fields are derived, never hand-edited.
  const again = normalize(structuredClone(d));
  assert.deepEqual([again.roster[0].grade, again.roster[0].sectionName], ["3", "A"]);
});
