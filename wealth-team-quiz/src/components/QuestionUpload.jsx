import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";

// Exact headers your template uses. Asterisks are literal characters
// in the header text, not markdown emphasis.
const EXPECTED_HEADERS = [
  "Question No",
  "Product / Topic",
  "Marks*",
  "Question Text",
  "AnswerOption1",
  "AnswerOption2",
  "AnswerOption3",
  "AnswerOption4",
  "CorrectAnswer*",
  "Quiz Category",
];

// Fields where we look for stray "Correct Answer" text contamination
const OPTION_FIELDS = ["AnswerOption1", "AnswerOption2", "AnswerOption3", "AnswerOption4"];

function trim(v) {
  return typeof v === "string" ? v.trim() : v;
}

function validateRow(row) {
  const errors = [];
  const warnings = [];

  const marks = Number(row["Marks*"]);
  if (!Number.isFinite(marks) || marks <= 0) {
    errors.push("Marks* must be a positive number");
  }

  const correct = String(row["CorrectAnswer*"]).trim();
  if (!["1", "2", "3", "4"].includes(correct)) {
    errors.push("CorrectAnswer* must be 1, 2, 3, or 4");
  }

  if (!row["Question Text"] || String(row["Question Text"]).trim() === "") {
    errors.push("Question Text is required");
  }

  for (const field of OPTION_FIELDS) {
    const val = String(row[field] ?? "");
    if (/correct\s*answer/i.test(val)) {
      warnings.push(`${field} appears to contain stray "Correct Answer" text`);
    }
    if (val.trim() === "") {
      errors.push(`${field} is required`);
    }
  }

  return { errors, warnings };
}

export default function QuestionUpload() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]); // parsed + validated rows
  const [parseError, setParseError] = useState("");

  const [quizName, setQuizName] = useState("");
  const [timerSeconds, setTimerSeconds] = useState("");

  const [status, setStatus] = useState("idle"); // idle | uploading | success | error
  const [uploadError, setUploadError] = useState("");
  const [newQuizId, setNewQuizId] = useState(null);

  const hasBlockingErrors = rows.length === 0 || rows.some((r) => r.errors.length > 0);
  const timerValid = Number.isInteger(Number(timerSeconds)) && Number(timerSeconds) > 0;
  const canConfirm =
    !hasBlockingErrors && quizName.trim() !== "" && timerValid && status !== "uploading";

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError("");
    setRows([]);
    setStatus("idle");
    setUploadError("");

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (json.length === 0) {
          setParseError("The file appears to be empty.");
          return;
        }

        // Validate headers match exactly (order doesn't matter, presence does)
        const actualHeaders = Object.keys(json[0]);
        const missing = EXPECTED_HEADERS.filter((h) => !actualHeaders.includes(h));
        if (missing.length > 0) {
          setParseError(`Missing expected column(s): ${missing.join(", ")}`);
          return;
        }

        const cleaned = json.map((raw) => {
          const row = {};
          for (const key of EXPECTED_HEADERS) {
            row[key] = trim(raw[key]);
          }
          const { errors, warnings } = validateRow(row);
          return { ...row, errors, warnings };
        });

        setRows(cleaned);
      } catch (err) {
        setParseError("Could not parse this file. Is it a valid .xlsx?");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleConfirm() {
    if (!canConfirm) return;

    setStatus("uploading");
    setUploadError("");

    const questionsPayload = rows.map((r) => ({
      question_no: Number(r["Question No"]),
      product_topic: r["Product / Topic"] === "" ? null : r["Product / Topic"],
      question_text: r["Question Text"],
      option_a: r["AnswerOption1"],
      option_b: r["AnswerOption2"],
      option_c: r["AnswerOption3"],
      option_d: r["AnswerOption4"],
      correct_option: String(r["CorrectAnswer*"]),
      marks: Number(r["Marks*"]),
      quiz_category: r["Quiz Category"] === "" ? null : r["Quiz Category"],
    }));

    const { data, error } = await supabase.rpc("create_quiz_with_questions", {
      quiz_name: quizName.trim(),
      quiz_time_limit_seconds: Number(timerSeconds),
      quiz_logo_url: null,
      questions_json: questionsPayload,
    });

    if (error) {
      // Because the SQL function runs as one transaction, a failure
      // here means NOTHING was written -- no orphaned quiz row, no
      // orphaned questions. Safe to just let the Quiz Master retry.
      setStatus("error");
      setUploadError(error.message);
      return;
    }

    setNewQuizId(data);
    setStatus("success");
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">Upload Quiz Questions</h1>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Quiz Name</label>
        <input
          type="text"
          value={quizName}
          onChange={(e) => setQuizName(e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. Wealth Team Weekly Quiz - July"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Timer (seconds) -- initial value, can be changed later before the live session
        </label>
        <input
          type="number"
          min="1"
          value={timerSeconds}
          onChange={(e) => setTimerSeconds(e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. 30"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Questions File (.xlsx)</label>
        <input type="file" accept=".xlsx" onChange={handleFile} />
        {fileName && <p className="text-sm text-gray-500">Selected: {fileName}</p>}
        {parseError && <p className="text-sm text-red-600">{parseError}</p>}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Q#</th>
                <th className="p-2 text-left">Question Text</th>
                <th className="p-2 text-left">Marks</th>
                <th className="p-2 text-left">Correct</th>
                <th className="p-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rowStatus = r.errors.length > 0 ? "error" : r.warnings.length > 0 ? "warning" : "ok";
                const rowClass =
                  rowStatus === "error"
                    ? "bg-red-50"
                    : rowStatus === "warning"
                    ? "bg-yellow-50"
                    : "bg-green-50";
                return (
                  <tr key={i} className={rowClass}>
                    <td className="p-2 font-medium capitalize">{rowStatus}</td>
                    <td className="p-2">{r["Question No"]}</td>
                    <td className="p-2">{r["Question Text"]}</td>
                    <td className="p-2">{r["Marks*"]}</td>
                    <td className="p-2">{r["CorrectAnswer*"]}</td>
                    <td className="p-2 text-xs">
                      {[...r.errors, ...r.warnings].join("; ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={!canConfirm}
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {status === "uploading" ? "Uploading..." : "Confirm Upload"}
      </button>

      {status === "success" && (
        <p className="text-green-700 text-sm">
          Quiz created successfully (id: {newQuizId}). All {rows.length} questions inserted.
        </p>
      )}
      {status === "error" && (
        <p className="text-red-600 text-sm">
          Upload failed, nothing was saved: {uploadError}
        </p>
      )}
    </div>
  );
}