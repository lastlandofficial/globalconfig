"use client";
import { useEffect, useRef, useState } from "react";
export default function ComplianceCheckout() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState("idle");
  const [result, setResult] = useState(null);
  const [invoice, setInvoice] = useState("");
  const pending = useRef(null);
  useEffect(() => {
    setReady(true);
  }, []);
  async function submit(operation, retry = false) {
    if (!retry)
      pending.current = {
        operation,
        key: crypto.randomUUID(),
        ...(operation === "credit" ? { originalNumber: invoice } : {}),
      };
    setState("loading");
    try {
      const response = await fetch("/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.current),
      });
      if (!response.ok) throw Error("Request failed");
      const data = await response.json();
      if (pending.current.operation === "invoice") setInvoice(data.number);
      setResult(data);
      setState("success");
    } catch {
      setState("error");
    }
  }
  return (
    <main>
      <h1>Checkout and invoice example</h1>
      <p>
        Fictional Japanese tax example: two items, JPY 1,000 each, reviewed demo
        rate 10%.
      </p>
      <button
        id="quote"
        disabled={!ready || state === "loading"}
        onClick={() => submit("quote")}
      >
        Calculate order
      </button>{" "}
      <button
        id="issue"
        disabled={!ready || state === "loading"}
        onClick={() => submit("invoice")}
      >
        Record invoice
      </button>{" "}
      <button
        id="credit"
        disabled={!invoice || state === "loading"}
        onClick={() => submit("credit")}
      >
        Credit one item
      </button>
      {state === "error" ? (
        <div>
          <p role="alert">
            Could not complete the request. Retry uses the same request key.
          </p>
          <button id="finance-retry" onClick={() => submit(null, true)}>
            Try again
          </button>
        </div>
      ) : null}
      <p id="finance-status" role="status">
        {state === "loading"
          ? "Working…"
          : state === "success"
            ? result.message
            : ""}
      </p>
      {result ? (
        <p>
          Total: <strong id="finance-total">{result.total}</strong> JPY{" "}
          {result.number ? `· ${result.number}` : ""}
        </p>
      ) : null}
      <p>
        Local test example. Recorded financial credits still need statutory
        document review.
      </p>
    </main>
  );
}
