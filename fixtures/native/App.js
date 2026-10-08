import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  calculateOrder,
  createMeteredComplianceExample,
  createInvoiceDraft,
  createCreditNoteDraft,
} from "glocon/compliance";
import { auditNative } from "glocon/native";
import { formatCurrency, toMinorUnits, fromMinorUnits } from "glocon/currency";
import { convertLocalTime } from "glocon/time";
import { reportURL } from "./environment";

async function emit(kind, value) {
  await fetch(reportURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value }),
  });
}
const example = createMeteredComplianceExample("JP");
export default function App() {
  const dark = useColorScheme() === "dark";
  const palette = dark
    ? {
        background: "#18181b",
        text: "#fafafa",
        surface: "#27272a",
        border: "#a1a1aa",
      }
    : {
        background: "#ffffff",
        text: "#18181b",
        surface: "#f4f4f5",
        border: "#71717a",
      };
  const [status, setStatus] = useState("Ready");
  const [total, setTotal] = useState("");
  const [reference, setReference] = useState("metered-order");
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const controls = useRef({});
  const invoice = useRef();
  const credits = useRef([]);
  const names = {
    issue: "Record invoice",
    credit: "Credit portion",
    defect: "Show defect",
    broken: "",
  };
  const audit = useCallback(async () => {
    const viewport = Dimensions.get("window");
    const nodes = await Promise.all(
      Object.entries(controls.current)
        .filter(([, ref]) => ref)
        .map(
          ([testID, ref]) =>
            new Promise((resolve) =>
              ref.measureInWindow((x, y, width, height) =>
                resolve({
                  testID,
                  accessibilityRole: "button",
                  accessibleName: names[testID],
                  frame: { x, y, width, height },
                  visible: y >= 0 && y + height <= viewport.height,
                }),
              ),
            ),
        ),
    );
    await emit("layout", {
      theme: dark ? "dark" : "light",
      fontScale: viewport.fontScale,
      nodes,
      viewport: { width: viewport.width, height: viewport.height },
      report: auditNative(nodes, viewport, { targetSize: 48 }),
    });
  }, [dark, broken]);
  useEffect(() => {
    try {
      const quote = calculateOrder(example.config, example.order);
      if (quote.status !== "ready") throw Error(JSON.stringify(quote));
      emit("startup", {
        engine: quote.value.engine,
        gross: quote.value.gross,
        formatted: formatCurrency("9007199254740993.01", "USD"),
        roundtrip: fromMinorUnits(
          toMinorUnits("999999999999999999999999999999.99", "USD"),
          "USD",
        ),
        time: convertLocalTime("2026-11-01T01:30", {
          from: "America/New_York",
          to: "UTC",
          disambiguation: "later",
        }).instant,
        hermes: !!global.HermesInternal,
        properties: global.HermesInternal?.getRuntimeProperties(),
        reactNative: Platform.constants.reactNativeVersion,
      });
    } catch (error) {
      emit("fatal", String(error.message));
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => audit().catch((error) => emit("fatal", String(error.message))),
      300,
    );
    return () => clearTimeout(timer);
  }, [audit, status]);
  async function action(type) {
    if (busy) return;
    setBusy(true);
    setStatus("Working…");
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (type === "issue") {
        const result = createInvoiceDraft(
          example.config,
          { ...example.order, id: reference },
          example.details,
        );
        if (result.status !== "ready")
          throw Error(result.issues.map((issue) => issue.message).join(" "));
        invoice.current = result.value;
        setTotal(result.value.calculation.gross);
        setStatus("Invoice draft ready");
        await emit("invoice", {
          number: result.value.details.number,
          gross: result.value.calculation.gross,
          reference: result.value.calculation.snapshot.order.id,
        });
      } else {
        if (!invoice.current) throw Error("Record the invoice draft first.");
        const result = createCreditNoteDraft(
          invoice.current,
          {
            number: `CINV/2026/${credits.current.length + 1}`,
            date: example.order.date,
            reason: "Reviewed fractional return fixture",
            review: example.config.business.review,
            lines: [{ lineId: "item-1", quantity: "0.1" }],
          },
          credits.current,
        );
        if (result.status !== "ready")
          throw Error(result.issues.map((issue) => issue.message).join(" "));
        credits.current.push(result.value);
        setTotal(result.value.gross);
        setStatus("Credit draft ready");
        await emit("credit", {
          gross: result.value.gross,
          count: credits.current.length,
          reference: invoice.current.calculation.snapshot.order.id,
        });
      }
    } catch (error) {
      setStatus(String(error.message));
      await emit("action-error", String(error.message));
    } finally {
      setBusy(false);
    }
  }
  function button(id, onPress) {
    return (
      <Pressable
        key={id}
        ref={(ref) => {
          controls.current[id] = ref;
        }}
        testID={id}
        accessibilityRole="button"
        accessibilityLabel={names[id]}
        disabled={busy}
        accessibilityState={{ disabled: busy, busy }}
        onPress={onPress}
        onLayout={audit}
        style={[
          styles.button,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            opacity: busy ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[styles.buttonText, { color: palette.text }]}>
          {names[id]}
        </Text>
      </Pressable>
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.text }]}
      >
        Metered billing
      </Text>
      <Text style={[styles.body, { color: palette.text }]}>
        0.3 units at JPY 50 per unit
      </Text>
      <View>
        <Text
          nativeID="reference-label"
          style={[styles.body, { color: palette.text }]}
        >
          Order reference
        </Text>
        <TextInput
          testID="reference"
          accessibilityLabel="Order reference"
          value={reference}
          onChangeText={setReference}
          style={[
            styles.input,
            { color: palette.text, borderColor: palette.border },
          ]}
        />
      </View>
      {button("issue", () => action("issue"))}
      {button("credit", () => action("credit"))}
      <View>
        {button("defect", () => setBroken(true))}
        {broken && (
          <Pressable
            ref={(ref) => {
              controls.current.broken = ref;
            }}
            testID="broken"
            accessibilityRole="button"
            onLayout={audit}
            style={{
              position: "absolute",
              left: 12,
              top: 12,
              width: 8,
              height: 8,
              backgroundColor: palette.text,
            }}
          />
        )}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.body, { color: palette.text }]}
      >
        {status}
      </Text>
      <Text style={[styles.amount, { color: palette.text }]}>
        {total ? `JPY ${total}` : "No draft yet"}
      </Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, paddingTop: 40, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 24 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  amount: { fontSize: 24, fontWeight: "600" },
});
