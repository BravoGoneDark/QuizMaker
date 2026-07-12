import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";
import heroQuestion from "../assets/hero-question.avif";

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

  // Presentational-only tallies for the header; doesn't touch row data
  // or the validation logic above.
  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  const warningCount = rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length;
  const readyCount = rows.length - errorCount - warningCount;

  return (
    <div className="h-screen overflow-hidden bg-[#17140F] text-[#F6F1E6] font-sans flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#AB932B]/15">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-1">Quiz Master</p>
          <h1 className="font-serif text-2xl">Upload Questions</h1>
        </div>
        {rows.length > 0 && (
          <p className="text-xs text-[#F6F1E6]/50">
            {readyCount} ready · {warningCount} warning{warningCount === 1 ? "" : "s"} ·{" "}
            {errorCount} error{errorCount === 1 ? "" : "s"}
          </p>
        )}
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-[1fr_1.4fr] gap-5 p-5">
        {/* LEFT: hero panel doubling as the setup form */}
        <section className="relative rounded-2xl overflow-hidden border border-[#AB932B]/15">
          <img src={heroQuestion} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17140F] via-[#17140F]/75 to-[#17140F]/40" />

          <div className="relative h-full flex flex-col justify-between p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-[#AB932B]/70 mb-1">New Quiz</p>
              <p className="font-serif text-3xl">Set up &amp; upload</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-[0.1em] text-[#F6F1E6]/60 mb-1.5">
                  Quiz name
                </label>
                <input
                  type="text"
                  value={quizName}
                  onChange={(e) => setQuizName(e.target.value)}
                  placeholder="e.g. Wealth Team Weekly Quiz - July"
                  className="w-full bg-[#17140F]/70 backdrop-blur border border-[#AB932B]/25 rounded-lg px-3 py-2.5 text-sm text-[#F6F1E6] placeholder:text-[#F6F1E6]/30 focus:outline-none focus:border-[#AB932B]/70"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-[0.1em] text-[#F6F1E6]/60 mb-1.5">
                  Timer (seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  value={timerSeconds}
                  onChange={(e) => setTimerSeconds(e.target.value)}
                  placeholder="e.g. 30"
                  className="w-full bg-[#17140F]/70 backdrop-blur border border-[#AB932B]/25 rounded-lg px-3 py-2.5 text-sm text-[#F6F1E6] placeholder:text-[#F6F1E6]/30 focus:outline-none focus:border-[#AB932B]/70"
                />
                <p className="text-[11px] text-[#F6F1E6]/40 mt-1.5">
                  Initial value — can be changed later before the live session.
                </p>
              </div>

              <div>
                <label
                  htmlFor="questionFile"
                  className="flex items-center justify-between gap-3 border border-dashed border-[#AB932B]/40 rounded-lg px-3 py-3 cursor-pointer bg-[#17140F]/50 backdrop-blur hover:border-[#AB932B]/70 transition-colors"
                >
                  <span className="text-sm text-[#F6F1E6]/80 truncate">
                    {fileName || "Choose .xlsx file"}
                  </span>
                  <span className="text-xs uppercase tracking-[0.1em] text-[#AB932B] shrink-0">
                    Browse
                  </span>
                </label>
                <input
                  id="questionFile"
                  type="file"
                  accept=".xlsx"
                  onChange={handleFile}
                  className="sr-only"
                />
                {parseError && <p className="text-xs text-[#c98789] mt-2">{parseError}</p>}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: validation preview + confirm */}
        <section className="min-h-0 flex flex-col rounded-2xl border border-[#AB932B]/15 bg-[#1E1B16] overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">
            {rows.length === 0 ? (
              <div className="h-full flex items-center justify-center px-8 text-center">
                <p className="text-sm text-[#F6F1E6]/40">
                  Select a .xlsx file on the left to preview parsed questions here.
                </p>
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-[#1E1B16] z-10">
                  <tr className="text-left text-xs uppercase tracking-[0.1em] text-[#AB932B]/60">
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Q#</th>
                    <th className="px-3 py-3 font-medium">Question Text</th>
                    <th className="px-3 py-3 font-medium">Marks</th>
                    <th className="px-3 py-3 font-medium">Correct</th>
                    <th className="px-3 py-3 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rowStatus =
                      r.errors.length > 0 ? "error" : r.warnings.length > 0 ? "warning" : "ok";
                    const borderColor =
                      rowStatus === "error"
                        ? "border-l-[#925254]"
                        : rowStatus === "warning"
                        ? "border-l-[#AB932B]"
                        : "border-l-transparent";
                    const labelColor =
                      rowStatus === "error"
                        ? "text-[#c98789]"
                        : rowStatus === "warning"
                        ? "text-[#AB932B]"
                        : "text-[#F6F1E6]/40";
                    const label = rowStatus === "error" ? "Error" : rowStatus === "warning" ? "Warning" : "Ready";
                    return (
                      <tr
                        key={i}
                        className={`border-t border-t-[#F6F1E6]/5 border-l-4 ${borderColor} hover:bg-[#17140F]/40`}
                      >
                        <td className={`px-6 py-2.5 font-medium ${labelColor}`}>{label}</td>
                        <td className="px-3 py-2.5 text-[#F6F1E6]/70">{r["Question No"]}</td>
                        <td className="px-3 py-2.5">{r["Question Text"]}</td>
                        <td className="px-3 py-2.5 text-[#F6F1E6]/70">{r["Marks*"]}</td>
                        <td className="px-3 py-2.5 text-[#F6F1E6]/70">{r["CorrectAnswer*"]}</td>
                        <td className="px-3 py-2.5 text-xs text-[#F6F1E6]/50">
                          {[...r.errors, ...r.warnings].join("; ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="shrink-0 border-t border-[#AB932B]/15 p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              {status === "success" && (
                <p className="text-sm text-[#AB932B]">
                  Quiz created (id: {newQuizId}). All {rows.length} questions inserted.
                </p>
              )}
              {status === "error" && (
                <p className="text-sm text-[#c98789]">
                  Upload failed, nothing was saved: {uploadError}
                </p>
              )}
            </div>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="shrink-0 rounded-xl bg-[#AB932B] text-[#17140F] font-medium px-6 py-3 text-sm uppercase tracking-[0.15em] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#c2a832] transition-colors"
            >
              {status === "uploading" ? "Uploading…" : "Confirm upload"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}