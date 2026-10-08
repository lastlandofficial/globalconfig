import assert from "node:assert/strict";
import { test } from "node:test";
import { pixelLauncherCloseControl } from "../scripts/native-shell-ui.mjs";

// Actual UI Automator nodes from CI run 37841764430; outer layout wrappers omitted.
const title = `<node index="0" text="Pixel Launcher isn't responding" resource-id="android:id/alertTitle" class="android.widget.TextView" package="android" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[133,1068][947,1131]" />`;
const close = `<node index="0" text="Close app" resource-id="android:id/aerr_close" class="android.widget.Button" package="android" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[70,1170][1010,1296]" />`;
const wait = `<node index="1" text="Wait" resource-id="android:id/aerr_wait" class="android.widget.Button" package="android" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[70,1296][1010,1422]" />`;
const hierarchy = (alert = title, button = close) =>
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${alert}${button}${wait}</hierarchy>`;

test("native startup recovery selects the captured Pixel Launcher Close app control", () => {
  assert.equal(pixelLauncherCloseControl(hierarchy()), close);
});

test("native startup recovery never closes Expo Go or application ANR dialogs", () => {
  for (const application of [
    "Expo Go",
    "Glocon native verification",
    "Settings",
  ])
    assert.equal(
      pixelLauncherCloseControl(
        hierarchy(title.replace("Pixel Launcher", application)),
      ),
      undefined,
      application,
    );
});

test("native startup recovery requires the Android system alert title", () => {
  for (const altered of [
    title.replace('package="android"', 'package="host.exp.exponent"'),
    title.replace("android:id/alertTitle", "example:id/alertTitle"),
    title.replace("isn't responding", "has stopped"),
  ])
    assert.equal(pixelLauncherCloseControl(hierarchy(altered)), undefined);
});

test("native startup recovery rejects controls with the wrong package, resource or enabled state", () => {
  for (const altered of [
    close.replace('package="android"', 'package="host.exp.exponent"'),
    close.replace("android:id/aerr_close", "example:id/aerr_close"),
    close.replace("android:id/aerr_close", "android:id/aerr_wait"),
    close.replace('enabled="true"', 'enabled="false"'),
    close.replace('text="Close app"', 'text="Wait"'),
  ])
    assert.equal(
      pixelLauncherCloseControl(hierarchy(title, altered)),
      undefined,
    );
});

test("native startup recovery requires both the launcher alert and its Close app control", () => {
  assert.equal(pixelLauncherCloseControl(hierarchy("")), undefined);
  assert.equal(pixelLauncherCloseControl(hierarchy(title, "")), undefined);
  assert.equal(pixelLauncherCloseControl(""), undefined);
});
